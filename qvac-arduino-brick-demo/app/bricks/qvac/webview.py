import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


# The web view is reachable from the local network, so it forwards a fixed list of routes and
# nothing else. The URL sent to the runtime is built from these constants, never from the raw
# request path: a request line such as "GET @other.host/x" would otherwise turn the runtime
# address into a username and send the request to another host.
GET_ROUTES = (
    "/",
    "/health",
    "/style.css",
    "/app.js",
    "/assets/geist-latin-wght-normal.woff2",
    "/assets/geist-mono-latin-wght-normal.woff2",
    "/assets/built-with-qvac-light-mode-landscape-transparent.svg",
)
POST_ROUTES = ("/sensor",)


def start_webview(runtime_url, host, port):
    routes = {"GET": {r: runtime_url + r for r in GET_ROUTES},
              "POST": {r: runtime_url + r for r in POST_ROUTES}}

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def forward(self):
            target = routes.get(self.command, {}).get(self.path)
            if target is None:
                return self.reply(404, b'{"error":"Route not found."}')
            body = None
            if self.command == "POST":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    return self.reply(400, b'{"error":"Invalid request size."}')
                if not 0 < length <= 8192:
                    return self.reply(413, b'{"error":"Request is empty or too large."}')
                body = self.rfile.read(length)
            request = Request(target, data=body, method=self.command,
                              headers={"Content-Type": "application/json"})
            try:
                with urlopen(request, timeout=180) as response:
                    self.reply(response.status, response.read(), response.headers.get_content_type())
            except HTTPError as error:
                self.reply(error.code, error.read(), error.headers.get_content_type())
            except (URLError, TimeoutError):
                self.reply(503, json.dumps({"error": "Local QVAC is not ready. Try again shortly."}).encode())

        do_GET = forward
        do_POST = forward

    server = ThreadingHTTPServer((host, port), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server
