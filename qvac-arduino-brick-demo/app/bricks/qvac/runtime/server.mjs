import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { sensorFacts, sensorPrompt } from './sensor.mjs';
import { loadModel, completion, unloadModel, close, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';

const model = QWEN3_1_7B_INST_Q4;

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8765);
const started = performance.now();
console.log(`Loading ${model.name} on CPU. The first run downloads the model.`);
const modelId = await loadModel({
  modelSrc: model,
  modelConfig: { device: 'cpu', ctx_size: 1024, threads: 4 },
  onProgress: ({ percentage }) => {
    if (percentage != null) process.stdout.write(`\rModel download: ${Math.round(percentage)}%   `);
  }
});
const loadMs = Math.round(performance.now() - started);
let busy = false;

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/assets/built-with-qvac-light-mode-landscape-transparent.svg': ['assets/built-with-qvac-light-mode-landscape-transparent.svg', 'image/svg+xml'],
    '/assets/geist-latin-wght-normal.woff2': ['assets/geist-latin-wght-normal.woff2', 'font/woff2'],
    '/assets/geist-mono-latin-wght-normal.woff2': ['assets/geist-mono-latin-wght-normal.woff2', 'font/woff2']
  };
  if (req.method === 'GET' && files[req.url]) {
    const [path, type] = files[req.url];
    try {
      const content = await readFile(new URL(`./ui/${path}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      return res.end(content);
    } catch {
      return send(res, 500, { error: 'An app asset is missing.' });
    }
  }
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ready: true, model: model.name, sdk: '0.24.0', device: 'cpu', loadMs });
  }
  if (req.method !== 'POST' || !['/complete', '/sensor'].includes(req.url)) return send(res, 404, { error: 'Route not found.' });
  if (busy) return send(res, 409, { error: 'QVAC is answering another request. Try again shortly.' });
  let body = '';
  let ownsModel = false;
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) return send(res, 413, { error: 'Request is too large.' });
    }
    let data;
    try { data = JSON.parse(body); }
    catch { return send(res, 400, { error: 'Send a JSON object with a prompt string.' }); }
    let reading;
    if (req.url === '/sensor') {
      try { reading = sensorFacts(data?.temperature, data?.humidity); }
      catch (error) { return send(res, 400, { error: error.message }); }
      data = { prompt: sensorPrompt(reading) };
    }
    if (!data || typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 3000) {
      return send(res, 400, { error: 'prompt must contain between 1 and 3000 characters.' });
    }
    if (busy) return send(res, 409, { error: 'QVAC is answering another request. Try again shortly.' });
    busy = true;
    ownsModel = true;
    const t0 = performance.now();
    const run = completion({
      modelId,
      history: [
        { role: 'system', content: 'You explain classroom greenhouse sensor readings. The input already states whether each reading is below, within or above its target. Trust these labels. Return a JSON object with explanation (one short sentence about the supplied readings) and next_step (one simple suggestion). Do not invent readings. Do not claim to control hardware. Be brief.' },
        { role: 'user', content: data.prompt }
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
    const { stats } = await run.final;
    if (!answer.trim()) throw new Error('The model returned no answer.');
    const output = JSON.parse(answer);
    send(res, 200, {
      text: `${output.explanation} ${output.next_step}`, ...output, model: model.name,
      sdk: '0.24.0', device: 'cpu',
      inferenceMs: Math.round(performance.now() - t0),
      tokensPerSecond: stats?.tokensPerSecond ?? null,
      ...(reading ? { reading } : {})
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: 'Local inference failed. Check the QVAC terminal.' });
  } finally {
    if (ownsModel) busy = false;
  }
});

server.listen(port, host, () => console.log(`\nQVAC ready at http://${host}:${port} (${loadMs} ms load).`));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await unloadModel({ modelId, clearStorage: false });
  await close();
}
process.on('SIGINT', () => stop().catch(console.error));
process.on('SIGTERM', () => stop().catch(console.error));
