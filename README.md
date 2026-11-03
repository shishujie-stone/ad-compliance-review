# 合不合规我一看就知道 · 种草素材广告法审核

给美妆、食品品牌内容运营用的广告合规审核工具：上传种草**文案、图片或视频**，AI 按《广告法》逐句找出风险，给出法条依据、修改建议和相似处罚案例；AI 拿不准的自动**转人工复核**，由审核人点"通过 / 不通过"做最终决定。另有广告法**法务问答**和**规则库**。

## 功能

| 工作区 | 说明 |
|---|---|
| 提交审核 | 文案 / 图片 / 视频（浏览器内截取 6 个画面 + 口播文字）三种素材；违规片段高亮，逐条给出类型、法条、理由、可替换的写法和相似处罚案例 |
| 人工复核 | 按转人工规则进入队列：AI 判违规但风险为中低、图片和视频素材、含边界表述（个人体验、注册证、数据来源等）、带货引导未标"广告"、法条依据存疑 |
| 审核记录 | 全部记录、统计"人工推翻 AI"次数、导出 CSV |
| 法务问答 | 依据《广告法》全文、法规要点、补充规则和案例库作答 |
| 规则库 | 法规要点 27 条、合规判定补充规则 8 段、处罚案例 33 例、《广告法》全文 74 条 |

**防编造**：AI 只能输出案例编号，页面去案例库核对后才显示当事人、处罚结果和官方来源链接，查不到的编号直接丢弃。

## 技术

- 前端：原生 HTML / CSS / JavaScript（`public/`），审核记录保存在访客自己的浏览器（localStorage）
- 后端：Vercel Python 函数（`api/`），调用阿里百炼通义千问 `qwen3-vl-plus`（OpenAI 兼容接口）
- 次数限制：Upstash Redis 计数，每个访客每天 10 次、整站每天 300 次（可配置）
- 知识库：`data/kb.json`（法规、案例、补充规则、《广告法》全文、审核提示词、问答人设）

## 部署到 Vercel

1. 在 Vercel 导入这个 GitHub 仓库，Framework Preset 选 **Other**，其余保持默认
2. 在 **Settings → Environment Variables** 添加：

| 变量 | 说明 |
|---|---|
| `DASHSCOPE_API_KEY` | 阿里百炼 API Key（必填） |
| `DASHSCOPE_BASE_URL` | 默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`；业务空间 Key（`sk-ws-` 开头）填该空间自己的地址 |
| `DASHSCOPE_MODEL` | 默认 `qwen3-vl-plus` |
| `LIMIT_PER_IP` / `LIMIT_TOTAL` | 每人每天 / 整站每天的调用上限，默认 10 / 300 |

3. 次数限制：在 Vercel 的 **Storage / Marketplace** 添加 **Upstash Redis**（免费额度够用），并连接到本项目，会自动注入 `KV_REST_API_URL` 和 `KV_REST_API_TOKEN`。不添加则不限制次数
4. 重新部署（Deployments → Redeploy）

API Key 只存在 Vercel 的环境变量里，不会出现在页面代码中。建议同时在百炼控制台设置消费提醒。

## 本地预览

```bash
python3 dev_server.py
```

打开 http://127.0.0.1:8000 。默认是示例模式，不调用模型；要真实调用，先在终端设置 `DASHSCOPE_API_KEY`，再运行 `MOCK=0 python3 dev_server.py`。

## 声明

审核和问答结果为 AI 风险提示，不构成法律意见。处罚案例来自市场监管总局、最高人民检察院公开通报，"推定条款"为依据违规内容推定，需以官方文本为准。
