"""POST /api/qa —— 法务问答"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
import _core  # noqa: E402


def handle(body, ip):
    q = str(body.get("question") or "").strip()[:500]
    if not q:
        raise _core.ApiError(400, "empty", "请输入问题")
    history = []
    for t in (body.get("history") or [])[-6:]:
        if isinstance(t, dict) and t.get("role") in ("user", "assistant") and t.get("content"):
            history.append({"role": t["role"], "content": str(t["content"])[:3000]})
    _core.consume(ip)
    if os.environ.get("MOCK") == "1":
        return "（本地示例回答，未调用模型）原则上不可以，普通化妆品不得宣称美白 [C008]，另一条无法核实的引用 [C999]。"
    messages = [{"role": "system", "content": _core.QA_RULES}] + history + [
        {"role": "user", "content": _core.qa_context(q) + "\n\n【问题】" + q}]
    return _core.call_model(messages, json_mode=False)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 200_000:
                raise _core.ApiError(413, "too_large", "问题太长了")
            body = json.loads(self.rfile.read(n) or b"{}")
            ip = (self.headers.get("x-forwarded-for") or self.client_address[0]).split(",")[0].strip()
            self._send(200, {"ok": True, "answer": handle(body, ip)})
        except _core.ApiError as e:
            self._send(e.status, {"ok": False, "code": e.code, "message": e.message})
        except Exception:
            self._send(500, {"ok": False, "code": "server", "message": "服务器出错了，请稍后再试"})

    def _send(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
