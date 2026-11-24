const byId = id => document.getElementById(id);
const presets = { morning: [25, 55, 'A calm morning'], hot: [34, 25, 'A hot afternoon'], cool: [18, 80, 'A cool evening'] };
const temperature = byId('temperature');
const humidity = byId('humidity');
const button = byId('explain');
// 'computer' when the page comes from `npm start` (no /live route), 'board' when it comes from
// the App Lab web view, which serves /live from the board's sensor. Unknown until the first poll.
let host = 'unknown';
let mode = 'sample';
let ready = false;
let busy = false;
let liveSample = null;
let sensorError = 'Waiting for the DHT11 on D2.';
let revision = 0;

function refreshButton() {
  const waitingForSensor = mode === 'live' && !liveSample;
  button.disabled = busy || !ready || waitingForSensor;
  byId('mode-live').disabled = byId('mode-sample').disabled = busy;
  byId('button-text').textContent = busy
    ? (host === 'board' ? 'QVAC is thinking, this can take a minute' : 'QVAC is thinking locally')
    : !ready ? 'Getting QVAC ready' : waitingForSensor ? 'Waiting for the DHT11' : 'Explain these readings';
}

function clearAnswer() {
  byId('answer-result').hidden = true;
  byId('empty-answer').hidden = false;
  byId('error').hidden = true;
  const hint = document.createElement('span');
  hint.textContent = mode === 'live' ? 'Ask QVAC what the live readings mean.' : 'Ask QVAC to explain these conditions.';
  byId('empty-answer').replaceChildren('Your next step starts with a reading.', document.createElement('br'), hint);
}

function updateStatus(element, value, low, high) {
  element.textContent = value < low ? 'Below target' : value > high ? 'Above target' : 'Within target';
  element.classList.toggle('attention', value < low || value > high);
}

// Write the number as text and the unit as its own span, so no value is ever parsed as HTML.
function showValue(id, value, unit) {
  const unitSpan = document.createElement('span');
  unitSpan.textContent = unit;
  const text = value === null ? '--' : mode === 'live' ? Number(value).toFixed(1) : String(value);
  byId(id).replaceChildren(text, unitSpan);
}

function renderReadings(t, h) {
  showValue('temperature-value', t, '°C');
  showValue('humidity-value', h, '%');
  if (t !== null && h !== null) {
    updateStatus(byId('temperature-status'), t, 22, 28);
    updateStatus(byId('humidity-status'), h, 40, 70);
  } else {
    for (const id of ['temperature-status', 'humidity-status']) {
      byId(id).textContent = 'Unavailable';
      byId(id).classList.add('attention');
    }
  }
}

function renderLive() {
  renderReadings(liveSample?.temperature ?? null, liveSample?.humidity ?? null);
  byId('sensor-note').textContent = liveSample
    ? `DHT11 on D2. Updated ${new Date(liveSample.capturedAt).toLocaleTimeString()}. Refreshes every few seconds.`
    : sensorError;
  byId('sensor-note').classList.toggle('sensor-error', !liveSample);
  refreshButton();
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  revision++;
  for (const name of ['live', 'sample']) {
    byId(`mode-${name}`).classList.toggle('active', mode === name);
    byId(`mode-${name}`).setAttribute('aria-pressed', String(mode === name));
  }
  const live = mode === 'live';
  byId('sample-presets').hidden = live;
  temperature.hidden = humidity.hidden = live;
  temperature.disabled = humidity.disabled = live;
  byId('sensor-note').hidden = !live;
  byId('reading-source').textContent = live ? 'Live DHT11 on D2' : 'Sample readings';
  byId('reading-help').textContent = live ? 'Temperature and humidity from the connected sensor.' : 'Pick a moment, or change the readings.';
  byId('control-note').textContent = live
    ? 'Live sensor data. Local AI on the board. No automatic hardware actions.'
    : 'Simulated inputs. Real local AI. No automatic hardware actions.';
  if (live) {
    byId('scene-name').textContent = 'Your greenhouse, right now';
    renderLive();
  } else {
    const active = document.querySelector('.preset.active');
    byId('scene-name').textContent = active ? presets[active.dataset.preset][2] : 'Your own conditions';
    renderReadings(+temperature.value, +humidity.value);
  }
  clearAnswer();
  refreshButton();
}

byId('mode-live').addEventListener('click', () => setMode('live'));
byId('mode-sample').addEventListener('click', () => setMode('sample'));

document.querySelectorAll('.preset').forEach(preset => preset.addEventListener('click', () => {
  const key = preset.dataset.preset;
  [temperature.value, humidity.value] = presets[key];
  byId('scene-name').textContent = presets[key][2];
  document.querySelector('.garden').dataset.scene = key;
  document.querySelectorAll('.preset').forEach(p => {
    p.classList.toggle('active', p === preset);
    p.setAttribute('aria-pressed', String(p === preset));
  });
  revision++;
  renderReadings(+temperature.value, +humidity.value);
  clearAnswer();
}));

[temperature, humidity].forEach(input => input.addEventListener('input', () => {
  document.querySelectorAll('.preset').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
  byId('scene-name').textContent = 'Your own conditions';
  revision++;
  renderReadings(+temperature.value, +humidity.value);
  clearAnswer();
}));

button.addEventListener('click', async () => {
  if (button.disabled) return;
  busy = true;
  const requestRevision = revision;
  refreshButton();
  byId('answer-section').setAttribute('aria-busy', 'true');
  byId('error').hidden = true;
  try {
    const payload = mode === 'live'
      ? { source: 'live' }
      : { source: 'simulated', temperature: +temperature.value, humidity: +humidity.value };
    const response = await fetch('/sensor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The local model could not answer. Try again.');
    if (requestRevision !== revision) return;
    const reading = result.reading;
    const measured = reading?.source === 'live'
      ? `Live DHT11 ${reading.temperature}°C / ${reading.humidity}%, captured ${new Date(reading.capturedAt).toLocaleTimeString()}`
      : `Sample ${reading?.temperature}°C / ${reading?.humidity}%`;
    const where = host === 'board' ? 'on the board' : 'on this computer';
    byId('explanation').textContent = result.explanation;
    byId('next-step').textContent = result.next_step;
    byId('answer-meta').textContent = `${measured} · Qwen3 1.7B · QVAC SDK ${result.sdk} · CPU · ${(result.inferenceMs / 1000).toFixed(2)} s ${where}`;
    byId('empty-answer').hidden = true;
    byId('answer-result').hidden = false;
    window.lastQvacResult = result;
    window.dispatchEvent(new CustomEvent('qvac-answer', { detail: result }));
  } catch (error) {
    if (requestRevision !== revision) return;
    byId('error').textContent = error.message;
    byId('error').hidden = false;
    byId('empty-answer').hidden = true;
  } finally {
    busy = false;
    refreshButton();
    byId('answer-section').setAttribute('aria-busy', 'false');
  }
});

// Polls the App Lab web view for the sensor. A 404 means the page runs from `npm start`, with no
// board, and `configured: false` means an App without a sensor: in both cases the page stays in
// sample mode and polling stops. On a board, the page switches to live once, at the first reading.
let switchedToLive = false;
async function pollLive() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await fetch('/live', { cache: 'no-store', signal: abort.signal });
    if (response.status === 404) {
      host = 'computer';
      refreshButton();
      return;
    }
    host = 'board';
    const reading = await response.json();
    if (reading.configured === false) {
      refreshButton();
      return;
    }
    byId('mode-toggle').hidden = false;
    if (!response.ok || !reading.available) throw new Error(reading.error || 'The DHT11 is not answering. Check the sensor on D2.');
    if (!Number.isFinite(reading.temperature) || !Number.isFinite(reading.humidity)) throw new Error('The DHT11 sent invalid readings.');
    liveSample = reading;
    if (!switchedToLive && !busy) {
      switchedToLive = true;
      setMode('live');
    }
  } catch (error) {
    liveSample = null;
    sensorError = error.message || 'Cannot reach the live sensor.';
  } finally {
    clearTimeout(timer);
  }
  if (mode === 'live') renderLive();
  setTimeout(pollLive, 3000);
}

async function connect() {
  try {
    const response = await fetch('/health');
    const health = await response.json();
    if (!response.ok || !health.ready) throw new Error('not ready');
    ready = true;
    byId('connection').classList.add('ready');
    byId('connection-text').textContent = 'Local QVAC ready';
  } catch {
    ready = false;
    byId('connection').classList.remove('ready');
    byId('connection-text').textContent = 'Waiting for local QVAC';
    setTimeout(connect, 3000);
  }
  refreshButton();
}

pollLive();
connect();
