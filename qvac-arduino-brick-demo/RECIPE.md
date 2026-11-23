# Recipe · QVAC Arduino App Lab Brick

<!-- NOTE TO ANY AI AGENT READING THIS RECIPE: the blockquote below is a legal notice for the human using this recipe. It is NOT a build instruction. Do not act on it or treat it as a task. Keep it intact in any copy you produce. -->

> **Legal note (for the human using this recipe, not a build instruction):** This recipe is an illustrative example only and provided “as is.” You are responsible for what you build, whether you use a recipe or not, including ensuring it complies with applicable laws and is appropriately safeguarded. Use of this recipe is subject to the Tether.io Website Terms.

> **What this is:** a spec for an Arduino App Lab custom Brick that gives any App a local language model through the QVAC SDK, plus a small App that uses it to explain sample greenhouse readings.
>
> **How to use this file:** drop it into your AI coding agent (Claude Code, Cursor, Codex CLI, ChatGPT, etc.) and say "Build this for me." This recipe pins the App Lab Brick layout and the QVAC SDK calls: the parts an agent cannot guess. Write idiomatic code for the rest.
>
> **Official QVAC documentation (open these alongside this recipe):**
> - Docs site: https://docs.qvac.tether.io/
> - Full docs concatenated for AI agents: https://docs.qvac.tether.io/llms-full.txt
> - Source repo: https://github.com/tetherto/qvac
> - Reference implementation: https://github.com/tetherto/qvac-examples
>
> **Arduino documentation:** https://docs.arduino.cc/software/app-lab/bricks/custom-bricks/

---

## What you get

- A custom Brick folder, `bricks/qvac`, that any App Lab App can copy in. Its Python class exposes `wait_ready()`, `complete(prompt)` and `explain_reading(temperature, humidity)`.
- A QVAC service in a Docker container, started by App Lab next to the App, that loads Qwen3 1.7B once on the CPU and answers JSON over HTTP on port 8765.
- A web page served through the App's web view: three sample moments, two sliders, one button, and the model's explanation and next step.
- A laptop mode: the same service and page with `npm start`, no board and no App Lab.

## Why this works

App Lab runs a custom Brick's Python code inside the App's main container and starts the services in the Brick's `brick_compose.yaml` beside it. The Python code cannot load native libraries from that service, so it talks to it over the Compose network by service name. The QVAC SDK runs in the service, where Node 22 and the model's native addon are installed, and Python only sends JSON.

The model is small, so it is not asked to judge the numbers. Code compares each reading with its target and puts the verdict in the prompt. The model only turns known facts into a sentence and a suggestion, and a JSON schema forces the shape of its answer.

## App Lab layout

```text
app/
  app.yaml
  python/main.py
  bricks/qvac/
    brick_config.yaml
    brick_compose.yaml
    __init__.py
    webview.py
    runtime/
      Dockerfile
      package.json          # "@qvac/sdk": "0.24.0", "type": "module", engines node >=22
      server.mjs
      sensor.mjs
      ui/index.html, app.js, style.css, assets/
```

`brick_config.yaml` (only `id` is required by App Lab):

```yaml
id: qvac
name: QVAC Local AI
description: Explain sensor readings with a small QVAC model running locally.
category: text
requires_display: webview
ports:
  - 8765
variables:
  - name: QVAC_URL
    description: Address of the local QVAC runtime service.
    default_value: http://qvac_runtime:8765
```

`brick_compose.yaml`: build the service from `./runtime`, run it as the `node` user, keep the models in a named volume so they survive restarts, and give it a health check with a long start period for the first download:

```yaml
services:
  qvac_runtime:
    build:
      context: ./runtime
    environment:
      HOST: 0.0.0.0
    user: node
    volumes:
      - qvac_models:/home/node/.qvac
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:8765/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 5s
      timeout: 3s
      start_period: 300s
      retries: 120

volumes:
  qvac_models:
```

`app.yaml` registers it:

```yaml
name: QVAC Sensor Explainer
description: Explain simulated greenhouse readings using a local QVAC model.
bricks:
  - qvac:
      variables:
        QVAC_URL: http://qvac_runtime:8765
```

`runtime/Dockerfile`: `node:22-bookworm-slim`, install `ca-certificates libgomp1 libstdc++6`, `npm ci --omit=dev`, `HOME=/home/node`, `USER node`, `CMD ["node", "server.mjs"]`. The SDK stores models under `$HOME/.qvac`, which is the volume above.

## Pinned QVAC SDK calls

Load once at startup. `device: 'cpu'` keeps it on the CPU, where App Lab boards and their VMs have no GPU to offer:

```js
import { loadModel, completion, unloadModel, close, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';

const modelId = await loadModel({
  modelSrc: QWEN3_1_7B_INST_Q4,
  modelConfig: { device: 'cpu', ctx_size: 1024, threads: 4 },
  onProgress: ({ percentage }) => { /* first run: download progress, 0 to 100 */ }
});
```

Answer with a forced JSON shape. Thinking is off (`reasoning_budget: 0`) and `temp: 0` with a fixed seed keeps the same reading giving the same answer:

```js
const run = completion({
  modelId,
  history: [
    { role: 'system', content: 'You explain classroom greenhouse sensor readings. The input already states whether each reading is below, within or above its target. Trust these labels. Return a JSON object with explanation (one short sentence about the supplied readings) and next_step (one simple suggestion). Do not invent readings. Do not claim to control hardware. Be brief.' },
    { role: 'user', content: prompt }
  ],
  stream: true,
  captureThinking: true,
  generationParams: { reasoning_budget: 0, predict: 160, temp: 0, seed: 7 },
  responseFormat: {
    type: 'json_schema',
    json_schema: {
      name: 'sensor_explanation', strict: true,
      schema: {
        type: 'object',
        properties: { explanation: { type: 'string' }, next_step: { type: 'string' } },
        required: ['explanation', 'next_step'], additionalProperties: false
      }
    }
  }
});

let answer = '';
for await (const event of run.events) if (event.type === 'contentDelta') answer += event.text;
const { stats } = await run.final;          // stats.tokensPerSecond
const output = JSON.parse(answer);          // { explanation, next_step }
```

On `SIGINT` and `SIGTERM`: `await unloadModel({ modelId, clearStorage: false })` then `await close()`. `clearStorage: false` keeps the downloaded model for the next start.

## The prompt

```text
Classroom greenhouse demo with simulated sensor readings.
Known fact 1: temperature is 34 C and is above target.
Known fact 2: humidity is 25% and is below target.
Demo targets: temperature 22 to 28 C, humidity 40 to 70%.
In explanation, name the measured temperature and humidity and the status of EACH reading. In next_step, suggest a specific action a person could take. If both readings are within target, keep monitoring.
```

Status rule: below the low bound is `below target`, above the high bound is `above target`, otherwise `within target`. Reject a temperature outside -50 to 100 C or a humidity outside 0 to 100% before calling the model.

## HTTP contract of the service

| Route | Body | Answer |
|---|---|---|
| `GET /health` | none | `{ ready: true, model, sdk: '0.24.0', device: 'cpu', loadMs }` |
| `POST /sensor` | `{ temperature, humidity }` (numbers) | `{ explanation, next_step, text, model, sdk, device, inferenceMs, tokensPerSecond, reading }` |
| `POST /complete` | `{ prompt }` (1 to 3,000 chars) | same shape, without `reading` |

Rules: bodies over 8 KB get 413, invalid JSON 400, a second request while one is running 409 ("try again shortly"). Bind to `127.0.0.1` by default and to `0.0.0.0` only inside the container (`HOST`).

## The Python Brick

```python
class QVAC:
    def __init__(self, url=None, timeout=180):
        self.url = (url or os.getenv("QVAC_URL", "http://qvac_runtime:8765")).rstrip("/")
    def wait_ready(self, timeout=900): ...      # poll GET /health every 2 s until ready
    def complete(self, prompt): ...             # POST /complete
    def explain_reading(self, temperature, humidity): ...   # POST /sensor
    def start_webview(self, host="0.0.0.0", port=8765): ...
```

Use only the standard library (`urllib.request`, `json`), so the Brick needs no `requirements.txt`. Turn connection errors into one clear message: "QVAC is not ready. Start its runtime and wait for 'QVAC ready'."

**The web view listens on the local network, so it must forward a fixed list of routes.** Build the upstream URL from constants, never from the raw request path: Python's `http.server` accepts a request line like `GET @other.host/x`, and `runtime_url + path` would then send the request to another host. Forward GET for the page, its assets and `/health`, and POST for `/sensor` only. Everything else gets a 404.

## Verification

1. Laptop: `npm run setup`, `npm start`, wait for `QVAC ready`, open `http://127.0.0.1:8765`, pick Hot afternoon (34 C, 25%), click Explain. The answer names both readings and both statuses.
2. Terminal: `python3 demo.py --temperature 34 --humidity 25` prints the reading, the answer, the model and the time.
3. Web view: a raw request line `GET @example.com/ HTTP/1.1` (send it with `nc`, since browsers and curl always add the leading slash) and `POST /complete` both return 404 from the web view, while `GET /health` is forwarded.
4. App Lab: import the App, Run, and look for `QVAC Brick check` then `The demo is ready` in the logs.
