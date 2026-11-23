const byId = id => document.getElementById(id);
const presets = { morning: [25, 55, 'A calm morning'], hot: [34, 25, 'A hot afternoon'], cool: [18, 80, 'A cool evening'] };
const temperature = byId('temperature');
const humidity = byId('humidity');
const button = byId('explain');
let ready = false;
let busy = false;
let revision = 0;

function updateStatus(element, value, low, high) {
  element.textContent = value < low ? 'Below target' : value > high ? 'Above target' : 'Within target';
  element.classList.toggle('attention', value < low || value > high);
}

// Write the number as text and the unit as its own span, so no input value is ever parsed as HTML.
function showValue(id, value, unit) {
  const unitSpan = document.createElement('span');
  unitSpan.textContent = unit;
  byId(id).replaceChildren(String(value), unitSpan);
}

function refresh() {
  revision++;
  showValue('temperature-value', temperature.value, '°C');
  showValue('humidity-value', humidity.value, '%');
  updateStatus(byId('temperature-status'), +temperature.value, 22, 28);
  updateStatus(byId('humidity-status'), +humidity.value, 40, 70);
  byId('answer-result').hidden = true;
  byId('empty-answer').hidden = false;
  byId('error').hidden = true;
  byId('empty-answer').innerHTML = 'Your next step starts with a reading.<br><span>Ask QVAC to explain these conditions.</span>';
}

document.querySelectorAll('.preset').forEach(preset => preset.addEventListener('click', () => {
  const key = preset.dataset.preset;
  [temperature.value, humidity.value] = presets[key];
  byId('scene-name').textContent = presets[key][2];
  document.querySelector('.garden').dataset.scene = key;
  document.querySelectorAll('.preset').forEach(p => {
    p.classList.toggle('active', p === preset);
    p.setAttribute('aria-pressed', String(p === preset));
  });
  refresh();
}));

[temperature, humidity].forEach(input => input.addEventListener('input', () => {
  document.querySelectorAll('.preset').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
  byId('scene-name').textContent = 'Your own conditions';
  refresh();
}));

button.addEventListener('click', async () => {
  if (!ready || busy) return;
  busy = true;
  const requestRevision = revision;
  button.disabled = true;
  byId('button-text').textContent = 'QVAC is thinking locally';
  byId('answer-section').setAttribute('aria-busy', 'true');
  byId('error').hidden = true;
  try {
    const response = await fetch('/sensor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temperature: +temperature.value, humidity: +humidity.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The local model could not answer. Try again.');
    if (requestRevision !== revision) return;
    byId('explanation').textContent = result.explanation;
    byId('next-step').textContent = result.next_step;
    byId('answer-meta').textContent = `Qwen3 1.7B · QVAC SDK ${result.sdk} · CPU · ${(result.inferenceMs / 1000).toFixed(2)} s on this computer`;
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
    button.disabled = !ready;
    byId('button-text').textContent = 'Explain these readings';
    byId('answer-section').setAttribute('aria-busy', 'false');
  }
});

async function connect() {
  try {
    const response = await fetch('/health');
    const health = await response.json();
    if (!response.ok || !health.ready) throw new Error('not ready');
    ready = true;
    byId('connection').classList.add('ready');
    byId('connection-text').textContent = 'Local QVAC ready';
    button.disabled = busy;
    byId('button-text').textContent = 'Explain these readings';
  } catch {
    ready = false;
    byId('connection').classList.remove('ready');
    byId('connection-text').textContent = 'Waiting for local QVAC';
    button.disabled = true;
    setTimeout(connect, 3000);
  }
}
connect();
