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
# Without a sensor provider (a Brick reused in another App), /live says so with a 200, and the page
# stays in sample mode.
NO_SENSOR = {"available": False, "configured": False, "source": "live", "error": "No live sensor is configured."}


def start_webview(runtime_url, host, port, sensor_provider=None):
    routes = {"GET": {r: runtime_url + r for r in GET_ROUTES},
              "POST": {r: runtime_url + r for r in POST_ROUTES}}

    def live_reading():
        return sensor_provider.snapshot() if sensor_provider else dict(NO_SENSOR)

    class Handler(BaseHTTPRequestHandler):
        timeout = 30  # a client that stops sending does not hold a thread forever

        def reply(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def json_reply(self, status, data):
            return self.reply(status, json.dumps(data).encode())

        def forward(self):
            # Live readings are served here, by the App's Python code, which talks to the board's
            # microcontroller. The QVAC service in its container never reads the sensor itself.
            if self.command == "GET" and self.path == "/live":
                reading = live_reading()
                ok = reading.get("available") or reading.get("configured") is False
                return self.json_reply(200 if ok else 503, reading)
            target = routes.get(self.command, {}).get(self.path)
            if target is None:
                return self.reply(404, b'{"error":"Route not found."}')
            body = None
            if self.command == "POST":
                # JSON only: a form or text/plain POST from another website cannot reach the model
                # without a CORS preflight, which this server does not answer.
                if self.headers.get_content_type() != "application/json":
                    return self.reply(415, b'{"error":"Send JSON with Content-Type: application/json."}')
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    return self.reply(400, b'{"error":"Invalid request size."}')
                if not 0 < length <= 8192:
                    return self.reply(413, b'{"error":"Request is empty or too large."}')
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body)
                except (ValueError, RecursionError):
                    return self.json_reply(400, {"error": "Send a JSON object."})
                if not isinstance(payload, dict):
                    return self.json_reply(400, {"error": "Send a JSON object."})
                # A live request explains the sensor's own snapshot. Numbers sent by the browser
                # are ignored, so a page can never pass its own values off as measurements.
                if payload.get("source") == "live":
                    reading = live_reading()
                    if not reading.get("available"):
                        return self.json_reply(503, reading)
                    body = json.dumps(reading).encode()
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
