"""POST /api/review —— 审核一条素材（文案 / 图片 / 视频画面）"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
import _core  # noqa: E402

DATA_URL = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")


def handle(body, ip):
    industry = body.get("industry") if body.get("industry") in ("美妆", "食品", "汽车") else "美妆"
    text = str(body.get("text") or "").strip()[:2000]
    images = [i for i in (body.get("images") or []) if isinstance(i, str) and DATA_URL.match(i)][:8]
    video = body.get("video") if isinstance(body.get("video"), dict) else None
    if video:
        video = {"transcript": str(video.get("transcript") or "").strip()[:3000]}
    if not text and not images and not (video and video["transcript"]):
        raise _core.ApiError(400, "empty", "请填写文案，或上传图片 / 视频")
    _core.consume(ip)
    if os.environ.get("MOCK") == "1":
        import time
        time.sleep(2.5)  # 本地示例模式下模拟模型耗时，便于查看等待动效
        return _core.normalize(_core.mock_review(text))
    prompt = _core.review_prompt(industry, text, len(images), video)
    content = [{"type": "text", "text": prompt}] + [{"type": "image_url", "image_url": {"url": u}} for u in images]
    out = _core.call_model([{"role": "user", "content": content}], json_mode=True)
    return _core.normalize(_core.parse_json(out))


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > _core.MAX_BODY:
                raise _core.ApiError(413, "too_large", "上传的内容太大，请压缩图片或减少视频画面")
            body = json.loads(self.rfile.read(n) or b"{}")
            ip = (self.headers.get("x-forwarded-for") or self.client_address[0]).split(",")[0].strip()
            self._send(200, {"ok": True, "result": handle(body, ip)})
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
