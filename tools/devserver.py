"""Static server for local review.

python3 -m http.server sends no Cache-Control at all, only Last-Modified, so
Chrome applies heuristic freshness and serves CSS from cache without ever
revalidating. That makes edits invisible in the browser until a hard reload,
which is the trap that once hid three stylesheet changes. This sends no-store
so what you see is always what is on disk.
"""
import http.server, socketserver, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4321
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', port), Handler) as httpd:
        print(f'serving on http://localhost:{port} with caching disabled')
        httpd.serve_forever()
