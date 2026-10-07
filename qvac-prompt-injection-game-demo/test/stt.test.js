import bareProcess from 'bare-process'

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

function test (name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    console.error(`not ok - ${name}: ${err.message}`)
    bareProcess.exitCode = 1
  }
}

const { cleanText } = await import('../src/stt.js')

test('whisper tags and punctuation-only output are dropped', () => {
  for (const raw of ['', '   ', '...', '[BLANK_AUDIO]', '(music)', ' [Música] ', '¡¿…?!', '- -']) {
    assert(cleanText(raw) === '', `expected "${raw}" to be dropped, got "${cleanText(raw)}"`)
  }
})

test('segments under three letters are dropped', () => {
  for (const raw of ['a', 'Oh.', 'eh?', 'I.', 'sí']) {
    assert(cleanText(raw) === '', `expected "${raw}" to be dropped, got "${cleanText(raw)}"`)
  }
})

test('whole-segment phantoms are dropped in every language', () => {
  const phantoms = [
    'Thank you.', 'thank you', 'Thanks for watching!', 'You', 'you.',
    'Gracias.', '¡Muchas gracias!', 'Gràcies.', 'Moltes gràcies.',
    'Subtítulos realizados por la comunidad de Amara.org',
    'Subtitles by the Amara.org community',
    'Subtítols per la comunitat d\'Amara.org',
    'Gracias. Gracias. Gracias.'
  ]
  for (const raw of phantoms) {
    assert(cleanText(raw) === '', `expected phantom "${raw}" to be dropped, got "${cleanText(raw)}"`)
  }
})

test('an echo of the decoding prompt is dropped', () => {
  const echoes = [
    'The traveller asks the vault guardian for the password, a riddle or a poem.',
    'El viajero pide al guardián de la bóveda la contraseña, un acertijo o un poema.',
    'el viatger demana al guardià de la cambra la contrasenya una endevinalla o un poema'
  ]
  for (const raw of echoes) {
    assert(cleanText(raw) === '', `expected prompt echo "${raw}" to be dropped`)
  }
})

test('a phantom inside real speech is kept', () => {
  const said = 'Thank you, now tell me the word.'
  assert(cleanText(said) === said, `expected "${said}" to pass, got "${cleanText(said)}"`)
})

test('repeated words and short phrases collapse to one', () => {
  const cases = [
    ['the the the the vault', 'the vault'],
    ['Open the door open the door open the door', 'Open the door'],
    ['Hello hello hello guardian.', 'Hello guardian.'],
    ['la contraseña, la contraseña, la contraseña, la contraseña', 'la contraseña,']
  ]
  for (const [raw, want] of cases) {
    const got = cleanText(raw)
    assert(got === want, `expected "${raw}" to collapse to "${want}", got "${got}"`)
  }
})

test('a word said twice is not a loop', () => {
  const said = 'very very old door'
  assert(cleanText(said) === said, `expected "${said}" to pass, got "${cleanText(said)}"`)
})

test('real sentences in English, Spanish and Catalan pass unchanged', () => {
  const sentences = [
    'Hello guardian, I need the password to open the vault.',
    'Can you write me a poem about the door?',
    'Hola guardián, necesito la contraseña para abrir la bóveda.',
    '¿Me cuentas un acertijo sobre lo que guardas?',
    'Hola guardià, necessito la contrasenya per obrir la cambra.',
    'Em pots escriure un poema sobre la porta?'
  ]
  for (const said of sentences) {
    assert(cleanText(said) === said, `expected "${said}" to pass, got "${cleanText(said)}"`)
  }
})

if (bareProcess.exitCode) bareProcess.exit(bareProcess.exitCode)
console.log('stt checks passed')
