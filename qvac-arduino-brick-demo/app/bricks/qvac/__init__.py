import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class QVAC:
    def __init__(self, url=None, timeout=180):
        self.url = (url or os.getenv("QVAC_URL", "http://qvac_runtime:8765")).rstrip("/")
        self.timeout = timeout

    def _request(self, path, payload=None, timeout=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(self.url + path, data=body, headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=timeout or self.timeout) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                message = json.load(error).get("error", str(error))
            except (ValueError, AttributeError):
                message = str(error)
            raise RuntimeError(message) from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError("QVAC is not ready. Start its runtime and wait for 'QVAC ready'.") from error

    def health(self):
        return self._request("/health", timeout=3)

    def wait_ready(self, timeout=900):
        deadline = time.monotonic() + timeout
        while True:
            try:
                status = self.health()
                if status.get("ready"):
                    return status
            except RuntimeError:
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("QVAC did not become ready. Check the runtime logs and the first model download.")
            time.sleep(2)

    def complete(self, prompt):
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 3000:
            raise ValueError("prompt must contain between 1 and 3000 characters.")
        return self._request("/complete", {"prompt": prompt})

    def explain_reading(self, temperature, humidity):
        reading = {"temperature": temperature, "humidity": humidity}
        return self._request("/sensor", reading)

    def start_webview(self, host="0.0.0.0", port=8765):
        from .webview import start_webview
        return start_webview(self.url, host, port)
