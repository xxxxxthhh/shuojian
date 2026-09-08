#!/usr/bin/env python3
# T4 呈现层的截图/像素统计接收端。只在 dev 用，游戏本身不依赖它。
# 用法: python3 dev/qa_server.py [端口]   （根目录 = 仓库根）
# 提供：静态文件服务（给 headless Chrome 加载 index/dev 页面）
#       POST /save  {name, png:dataURL, stats:{...}} → 写 _spec/qa/<name>.png，累计 stats
#       POST /done  → 把累计的 stats 写成 _spec/qa/_stats.json，作为驱动脚本的收工信号
import sys, os, json, base64
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QA = os.path.join(ROOT, '_spec', 'qa')
RESULTS = []

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def _cors(self):
        # 不许缓存：Chrome 复用 user-data-dir，缓存住旧的 js 会让你对着上一版调半天
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST,GET,OPTIONS')

    def end_headers(self):
        self._cors()
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b'{}'
        try:
            d = json.loads(body.decode('utf-8'))
        except Exception as e:
            self.send_response(400); self.end_headers(); return
        os.makedirs(QA, exist_ok=True)
        if self.path.startswith('/save'):
            png = d.get('png') or ''
            if png.startswith('data:image/png;base64,'):
                with open(os.path.join(QA, d['name'] + '.png'), 'wb') as f:
                    f.write(base64.b64decode(png.split(',', 1)[1]))
            if d.get('stats') is not None:
                RESULTS.append(d['stats'])
            print('saved', d.get('name'), json.dumps(d.get('stats'), ensure_ascii=False))
        elif self.path.startswith('/done'):
            with open(os.path.join(QA, '_stats.json'), 'w') as f:
                json.dump({'rows': RESULTS, 'extra': d}, f, ensure_ascii=False, indent=1)
            print('DONE', len(RESULTS), 'rows')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":1}')

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
