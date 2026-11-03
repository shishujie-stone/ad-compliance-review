"""GET /api/status —— 页面加载时查询：是否已配置模型、今天还剩几次"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
import _core  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ip = (self.headers.get("x-forwarded-for") or self.client_address[0]).split(",")[0].strip()
        used, per, on = _core.usage(ip)
        obj = {"ready": bool(os.environ.get("DASHSCOPE_API_KEY")) or os.environ.get("MOCK") == "1",
               "mock": os.environ.get("MOCK") == "1",
               "model": os.environ.get("DASHSCOPE_MODEL", "qwen3-vl-plus"),
               "limited": on, "used": used, "perDay": per}
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
