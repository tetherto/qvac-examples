// Styles, prompt ideas and the kiosk word filter. Shared by the server only.

// Each style is a suffix appended to what the visitor typed.
export const STYLES = {
  none: '',
  photo: 'photorealistic, natural light, sharp focus, 35mm photo',
  watercolor: 'watercolor painting, soft washes, paper texture',
  anime: 'anime illustration, clean line art, vibrant colors',
  pixel: 'pixel art, 16-bit video game style, crisp pixels',
  clay: 'claymation, handmade clay figures, soft studio light'
}

// One click fills the field, so nobody stares at an empty box.
export const IDEAS = [
  'a red fox reading a book in a cozy library',
  'a lighthouse on a floating island above the clouds',
  'a robot barista making coffee in a tiny cafe',
  'an astronaut cat planting flowers on the moon',
  'a hot air balloon shaped like a whale over snowy mountains',
  'a city of glass towers growing out of a jungle at sunrise'
]

export function styled (prompt, style) {
  const suffix = STYLES[style] || ''
  return suffix ? `${prompt}, ${suffix}` : prompt
}

// The model has no safety filter of its own, and a booth screen is public. This is a short list,
// not a guarantee: it stops the obvious requests from strangers at a stand.
const BLOCK = [
  'nude', 'naked', 'nsfw', 'porn', 'sex', 'sexy', 'erotic', 'explicit', 'topless', 'lingerie',
  'gore', 'gory', 'corpse', 'decapitated', 'beheaded', 'murder', 'suicide', 'self-harm',
  'nazi', 'swastika', 'kkk', 'terrorist', 'hentai', 'fetish', 'bdsm', 'onlyfans'
]
const escapeRe = (w) => w.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&')
const BLOCK_RE = new RegExp(`\\b(?:${BLOCK.map(escapeRe).join('|')})\\b`, 'i')

export function blocked (prompt) {
  return BLOCK_RE.test(prompt)
}
