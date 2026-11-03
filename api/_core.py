"""审核与问答的公共逻辑：知识库、提示词、调用通义千问、次数限制、结果校验。

环境变量（在 Vercel 项目设置 → Environment Variables 中填写，不要写进代码）：
  DASHSCOPE_API_KEY    阿里百炼 API Key（必填）
  DASHSCOPE_BASE_URL   接口地址，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
                       业务空间 Key（sk-ws- 开头）要填该空间自己的地址
  DASHSCOPE_MODEL      模型，默认 qwen3-vl-plus
  KV_REST_API_URL / KV_REST_API_TOKEN（或 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）
                       次数限制用的 Upstash Redis；不配置则不限制次数
  LIMIT_PER_IP         每个访客每天的调用上限，默认 10
  LIMIT_TOTAL          整站每天的调用上限，默认 300
  MOCK                 设为 1 时不调用模型，返回示例结果（本地调试用）
"""
import datetime
import hashlib
import json
import os
import re
import socket
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB = json.load(open(os.path.join(ROOT, "data", "kb.json"), encoding="utf-8"))
CASE_IDS = {c["id"] for c in KB["cases"]}
TYPES = {"T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"}
MAX_BODY = 4 * 1024 * 1024
SHOP = re.compile(r"链接|下单|立减|购买|入手|优惠|券|橱窗|小黄车")


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------- 知识库文本 ----------

def laws_text():
    return "\n".join(f"{l['id']}｜{l['layer']}｜{l['law']} {l['art']}｜{l['point']}｜典型违规词：{l['words']}"
                     + (f"｜罚则：{l['penalty']}" if l["penalty"] else "") for l in KB["laws"])


def cases_text():
    return "\n".join(f"{c['id']}｜{c['ind']}｜{c['party']}｜{c['product']}｜{c['words']}｜{c['type']}｜{c['penalty']}" for c in KB["cases"])


REVIEW_RULES = re.sub(r"9\. 相似案例只能从【参考处罚案例】中选[^\n]*",
                      "9. 相似案例只能从【参考处罚案例】中选，只输出案例编号（如 C008），不得编造；没有相关案例就输出空数组。",
                      KB["reviewPrompt"].split("## 输出要求")[0]) + """
## 补充的合规边界
- 数据、调研或检测结果已标明出处、时间和样本量的，不算 T5，也不因"未写测试方法"判违规。
- 已标明保健食品批准文号（蓝帽子、国食健注/国食健备）并用"有助于……"等规范表述宣称批准功能、标明"本品不能代替药物"的，不算违规。
"""

REVIEW_OUTPUT = """
## 输出要求
只输出一个 JSON 对象，不要输出其他文字：
{"is_violation": true或false, "risk_level": "高/中/低/无", "image_text": "图片或视频画面中识别到的文字和宣称元素，没有则为空字符串", "violations": [{"text": "违规片段（照抄素材原文或画面文字）", "type": "T1到T8之一", "law": "《广告法》第9条第3项", "reason": "一句话理由", "suggestion": "可直接替换的合规写法"}], "similar_cases": ["C008"], "summary": "一句话总评"}"""


def review_prompt(industry, text, n_images, video):
    pre = []
    blob = (text or "") + (video.get("transcript", "") if video else "")
    if SHOP.search(blob) and not re.search(r"广告|品牌合作|合作推广", blob):
        pre.append('含带货引导（链接/下单/立减等）但未标明"广告"，请核实是否属于T7广告未标识')
    if video:
        media = (f"\n【视频】随附 {n_images} 张按时间顺序截取的视频画面"
                 + (f"；口播或字幕：{video.get('transcript')}" if video.get("transcript") else "；未提供口播文字")
                 + "。请读出画面中的文字和宣称元素，连同口播一并审核。")
    elif n_images:
        media = "\n【图片】见随附图片：先读出图中全部文字，并列出画面中的宣称元素（奖杯、徽章、医生形象、对比图等），再一并审核。"
    else:
        media = "\n【图片】（无图片）"
    return (REVIEW_RULES + "\n【参考法规】\n" + laws_text() + "\n\n【合规判定补充规则】\n" + "\n\n".join(KB["sup"])
            + "\n\n【参考处罚案例】\n" + cases_text()
            + f"\n\n【待审素材】\n【行业】{industry}\n【文案】{text or '（无文案）'}" + media
            + (("\n【规则预检】" + "；".join(pre)) if pre else "") + REVIEW_OUTPUT)


QA_RULES = KB["persona"].replace("知识库内部编号（如 C008、L017）", "知识库内部编号（如 L017；案例只用 [C008] 这样的标记，页面会自动换成当事人和来源）")
QA_RULES = re.sub(r'- 只能引用"广宣处罚案例库"本次检索到的案例[\s\S]*?- 检索不到',
                  '- 只能引用【处罚案例库】中的案例。提到某个案例时，在该案例后写上它的编号标记，格式为 [C008]；页面会自动把编号换成当事人、处罚结果和来源链接，所以不用写来源链接，也不要写"某公司"这类泛称。\n- 检索不到',
                  QA_RULES)
QA_RULES = re.sub(r"2\. 素材审核：[^\n]*\n", "", QA_RULES) + "\n\n# 资料使用\n- 只依据每轮附上的【资料】作答；资料里没有的法规、文件、文号、案号和数额一律不写。\n- 用简短的段落和列表回答，不要使用表格。"


def grams(s):
    s = re.sub(r"[\s，。、；：？！“”\"（）()《》]", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def top_full(q, n=8):
    g = grams(q)
    art = re.search(r"第[一二三四五六七八九十百]+条", q)
    scored = []
    for i, c in enumerate(KB["full"]):
        s = len(g & grams(c)) + (20 if art and art.group() in c else 0)
        scored.append((s, i))
    return [KB["full"][i] for _, i in sorted(scored, reverse=True)[:n]]


def qa_context(q):
    return ("【资料】\n《广告法》相关条文：\n" + "\n\n".join(top_full(q)) + "\n\n法规要点：\n" + laws_text()
            + "\n\n合规判定补充规则：\n" + "\n\n".join(KB["sup"])
            + "\n\n处罚案例库（编号｜行业｜当事人｜产品｜违规表述｜类型｜处罚结果）：\n" + cases_text())


# ---------- 次数限制 ----------

def _kv():
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    tok = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    return (url.rstrip("/"), tok) if url and tok else (None, None)


def _kv_call(cmds):
    url, tok = _kv()
    req = urllib.request.Request(url + "/pipeline", data=json.dumps(cmds).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read())


def limits():
    return int(os.environ.get("LIMIT_PER_IP", "10")), int(os.environ.get("LIMIT_TOTAL", "300"))


def _keys(ip):
    day = datetime.datetime.utcnow().strftime("%Y%m%d")
    who = hashlib.sha256(ip.encode()).hexdigest()[:16]  # 只存 IP 的哈希
    return f"acr:{day}:ip:{who}", f"acr:{day}:total"


def usage(ip):
    """返回 (已用, 每人上限, 是否启用)；不消耗次数"""
    per, _ = limits()
    if not _kv()[0]:
        return 0, per, False
    try:
        k_ip, _ = _keys(ip)
        res = _kv_call([["GET", k_ip]])
        return int(res[0].get("result") or 0), per, True
    except Exception:
        return 0, per, True


def consume(ip):
    """计一次调用；超限时抛出 429"""
    if not _kv()[0]:
        return
    per, total = limits()
    k_ip, k_all = _keys(ip)
    try:
        res = _kv_call([["INCR", k_ip], ["EXPIRE", k_ip, 90000], ["INCR", k_all], ["EXPIRE", k_all, 90000]])
        n_ip, n_all = int(res[0]["result"]), int(res[2]["result"])
    except Exception:
        return  # 计数服务异常时不阻断演示
    if n_ip > per:
        raise ApiError(429, "limit_ip", f"今天的演示次数已用完（每人每天 {per} 次），明天再来试试")
    if n_all > total:
        raise ApiError(429, "limit_total", "今天全站的演示次数已用完，明天再来试试")


# ---------- 调用模型 ----------

_getaddrinfo = socket.getaddrinfo


def _ipv4_first(*args, **kwargs):
    # 部分 Serverless 实例没有 IPv6 出口，解析到 IPv6 地址时会报 Errno 99，这里优先用 IPv4
    res = _getaddrinfo(*args, **kwargs)
    return [r for r in res if r[0] == socket.AF_INET] or res


socket.getaddrinfo = _ipv4_first


def call_model(messages, json_mode):
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not key:
        raise ApiError(503, "no_key", "站点还没有配置模型 API Key")
    base = os.environ.get("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
    body = {"model": os.environ.get("DASHSCOPE_MODEL", "qwen3-vl-plus"), "messages": messages,
            "temperature": 0.1, "max_tokens": 4000}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=55) as r:
                data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise ApiError(502, "upstream", f"模型服务返回错误（{e.code}）：{detail}")
        except urllib.error.URLError:
            if attempt:
                raise ApiError(502, "upstream", "连不上模型服务，请稍后再试")
            time.sleep(1)  # 网络抖动时重试一次
        except Exception:
            raise ApiError(502, "upstream", "模型服务暂时不可用，请稍后再试")
    return data["choices"][0]["message"]["content"] or ""


def parse_json(text):
    text = re.sub(r"^```(json)?|```$", "", text.strip()).strip()
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group())
            except ValueError:
                pass
    raise ApiError(502, "bad_output", "模型返回的结果格式不完整，请再试一次")


def normalize(o):
    """只保留页面需要的字段，并丢掉案例库里不存在的案例编号（防编造）"""
    o = o if isinstance(o, dict) else {}
    vios = []
    for v in o.get("violations") or []:
        if not isinstance(v, dict):
            continue
        vios.append({"text": str(v.get("text", ""))[:300], "type": v.get("type") if v.get("type") in TYPES else "",
                     "law": str(v.get("law") or "依据待人工确认")[:200], "reason": str(v.get("reason", ""))[:400],
                     "suggestion": str(v.get("suggestion", ""))[:400]})
    cases = []
    for c in o.get("similar_cases") or []:
        m = re.search(r"C\d{3}", str(c))
        if m and m.group() in CASE_IDS and m.group() not in cases:
            cases.append(m.group())
    is_v = o.get("is_violation") is True or (o.get("is_violation") is not False and bool(vios))
    risk = o.get("risk_level") if o.get("risk_level") in ("高", "中", "低", "无") else ("中" if is_v else "无")
    return {"is_violation": is_v, "risk": risk, "image_text": str(o.get("image_text", ""))[:600], "violations": vios,
            "cases": cases[:3], "summary": str(o.get("summary", ""))[:300], "incomplete": "is_violation" not in o}


def mock_review(text):
    hit = [w for w in ("全网最好用", "第一", "祛痘", "无效退款", "抗癌") if w in (text or "")]
    vios = [{"text": w, "type": "T1" if w in ("全网最好用", "第一") else "T2", "law": "《广告法》第9条第3项",
             "reason": "（本地示例结果）", "suggestion": "改为可验证的客观描述"} for w in hit]
    return {"is_violation": bool(vios), "risk_level": "高" if vios else "无", "image_text": "",
            "violations": vios, "similar_cases": ["C008", "C999"], "summary": "本地示例结果，未调用模型"}
