"""本地预览：python3 dev_server.py，然后打开 http://127.0.0.1:8000

默认 MOCK=1，不调用模型、返回示例结果；要真实调用，先在终端里设置
DASHSCOPE_API_KEY（和 DASHSCOPE_BASE_URL），再运行 MOCK=0 python3 dev_server.py。
线上由 Vercel 运行 api/ 下的同一批文件，这个脚本只用于本地。
"""
import importlib.util
import os
import types
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("MOCK", "1")


def api_class(name):
    path = os.path.join(ROOT, "api", name + ".py")
    if not os.path.exists(path) or name.startswith("_"):
        return None
    spec = importlib.util.spec_from_file_location("api_" + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.handler


class Dev(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(ROOT, "public"), **kw)

    def _api(self, method):
        name = self.path.split("?")[0][len("/api/"):].strip("/")
        cls = api_class(name)
        fn = cls and getattr(cls, method, None)
        if not fn:
            self.send_error(404)
            return
        if hasattr(cls, "_send"):
            self._send = types.MethodType(cls._send, self)
        fn(self)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("do_GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("do_POST")
        self.send_error(405)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"http://127.0.0.1:{port}  （MOCK={os.environ['MOCK']}）")
    ThreadingHTTPServer(("127.0.0.1", port), Dev).serve_forever()
