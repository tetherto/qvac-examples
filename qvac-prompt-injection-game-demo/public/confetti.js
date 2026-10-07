// Confetti burst. No dependencies — the CSP allows only same-origin scripts,
// and one CSS keyframe does the animating so there is no rAF loop to own.
const CONFETTI_COLORS = ['#16e3c1', '#0fb89c', '#ffffff', '#8ef0dd', '#c8fff4']
const CONFETTI_COUNT = 90
const CONFETTI_MS = 2600

function reducedMotion () {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function burstConfetti () {
  const box = document.getElementById('confetti')
  if (!box || reducedMotion()) return
  clearTimeout(burstConfetti._clear)
  box.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const bit = document.createElement('i')
    bit.className = 'confetti-bit'
    bit.style.setProperty('--left', (Math.random() * 100).toFixed(2) + '%')
    bit.style.setProperty('--x', (Math.random() * 220 - 110).toFixed(0) + 'px')
    bit.style.setProperty('--r', (Math.random() * 1080 - 540).toFixed(0) + 'deg')
    bit.style.setProperty('--d', (Math.random() * 0.5).toFixed(2) + 's')
    bit.style.setProperty('--t', (1.6 + Math.random() * 0.9).toFixed(2) + 's')
    bit.style.setProperty('--c', CONFETTI_COLORS[i % CONFETTI_COLORS.length])
    bit.style.setProperty('--w', (5 + Math.round(Math.random() * 5)) + 'px')
    bit.style.setProperty('--h', (9 + Math.round(Math.random() * 7)) + 'px')
    frag.appendChild(bit)
  }
  box.appendChild(frag)
  burstConfetti._clear = setTimeout(clearConfetti, CONFETTI_MS)
}

function clearConfetti () {
  const box = document.getElementById('confetti')
  if (box) box.innerHTML = ''
}
