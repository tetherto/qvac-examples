// Light basemap drawn from OpenStreetMap data shipped with the demo (map.json), no tiles.
// One MapView per canvas; the basemap paths are built once and shared.
const KY = 111320
const MAP_STYLE = {
  land: '#F4F3EF', park: '#CDEBD2', water: '#A9D3F2', building: '#E8E5DF', buildingLine: '#D9D5CC', rail: '#C4C0B8',
  roads: { // real width in metres, minimum px, fill, casing
    service: [5, 0.8, '#FFFFFF', null],
    pedestrian: [7, 1.2, '#FBFAF8', '#DEDAD2'],
    minor: [9, 1.6, '#FFFFFF', '#D8D4CC'],
    secondary: [14, 2.6, '#FFFFFF', '#CFCAC0'],
    major: [20, 3.6, '#FDE7A4', '#E8C46A'],
  },
  text: '#5F6368', halo: '#FFFFFF',
  coverage: 'rgba(26, 115, 232, 0.38)', pin: '#00AF92', you: '#1A73E8', truth: '#202124',
}
const mapReduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

function buildBase (m) {
  const addLine = (p, r, close) => {
    p.moveTo(r[0], r[1])
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1])
    if (close) p.closePath()
  }
  const poly = rings => { const p = new Path2D(); for (const pl of rings) for (const r of pl) addLine(p, r, true); return p }
  const lines = arr => { const p = new Path2D(); for (const l of arr) addLine(p, l, false); return p }
  const roads = {}
  for (const k of Object.keys(MAP_STYLE.roads)) roads[k] = lines(m.roads[k] || [])
  const rank = { major: 0, secondary: 1, pedestrian: 2, minor: 3 }
  const labels = m.labels.filter(l => l.kind in rank).sort((a, b) => rank[a.kind] - rank[b.kind] || b.len - a.len)
  // Water and parks overlap each other (a river polygon plus its riverbank), so each feature is
  // its own path: one evenodd fill over all of them would cut holes where two overlap.
  const each = features => features.map(f => poly([f]))
  return { origin: m.origin, water: each(m.water), park: each(m.park), building: poly(m.building), rail: lines(m.rail), roads, labels }
}

function boundsOf (pts, padM) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity
  for (const [lat, lon] of pts) { a = Math.min(a, lat); b = Math.max(b, lat); c = Math.min(c, lon); d = Math.max(d, lon) }
  const pl = padM / KY, po = padM / (KY * Math.cos(a * Math.PI / 180))
  return { s: a - pl, n: b + pl, w: c - po, e: d + po }
}

function metres (a, b) {
  const dlat = (a[0] - b[0]) * KY
  const dlon = (a[1] - b[1]) * KY * Math.cos(a[0] * Math.PI / 180)
  return Math.hypot(dlat, dlon)
}

function fmtDistance (m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

const labelWidths = new Map()

class MapView {
  constructor (canvas, { onTap } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.base = null
    this.view = null
    this.anim = null
    this.overlay = null // (mapView, w, h) => void, drawn in CSS pixels after the basemap
    this.onTap = onTap
    this.home = null // points the default view fits
    new ResizeObserver(() => { if (this.home && !this.view) this.reset(); else this.draw() }).observe(canvas)
    this.bindInput()
  }

  setBase (base, homePoints) { this.base = base; this.home = homePoints; this.reset() }

  size () { return [this.canvas.clientWidth, this.canvas.clientHeight] }

  fitView (pts, padM) {
    const [w, h] = this.size()
    if (!w || !h) return null
    const bb = boundsOf(pts, padM)
    const k = Math.cos(((bb.s + bb.n) / 2) * Math.PI / 180)
    const scale = Math.min(w / ((bb.e - bb.w) * k), h / (bb.n - bb.s))
    return { cx: (bb.w + bb.e) / 2, cy: (bb.s + bb.n) / 2, scale, k }
  }

  reset () { this.view = this.fitView(this.home, 60); this.draw() }

  project (lat, lon) {
    const [w, h] = this.size(), v = this.view
    return [w / 2 + (lon - v.cx) * v.k * v.scale, h / 2 - (lat - v.cy) * v.scale]
  }

  unproject (x, y) {
    const [w, h] = this.size(), v = this.view
    return [v.cy - (y - h / 2) / v.scale, v.cx + (x - w / 2) / (v.k * v.scale)]
  }

  flyTo (pts, padM) {
    const target = this.fitView(pts, padM)
    if (!target) return
    if (mapReduceMotion || !this.view) { this.view = target; return this.draw() }
    const from = { ...this.view }
    const t0 = performance.now(), dur = 1100
    cancelAnimationFrame(this.anim)
    const step = now => {
      const t = Math.min(1, (now - t0) / dur)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      this.view = {
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
        scale: Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * e),
        k: target.k,
      }
      this.draw()
      if (t < 1) this.anim = requestAnimationFrame(step)
    }
    this.anim = requestAnimationFrame(step)
  }

  draw () {
    if (!this.base || !this.view) return
    const [w, h] = this.size()
    if (!w || !h) return
    const ctx = this.ctx, dpr = devicePixelRatio || 1
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = MAP_STYLE.land; ctx.fillRect(0, 0, w, h)
    const t = this.drawBase(w, h, dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (this.overlay) this.overlay(this, w, h, t.s, 'under-labels')
    this.drawLabels(w, h, dpr, t)
    if (this.overlay) this.overlay(this, w, h, t.s, 'top')
  }

  drawBase (w, h, dpr) {
    const ctx = this.ctx, v = this.view, base = this.base
    const s = v.scale / KY // px per metre
    const [lat0, lon0] = base.origin
    const mx = (v.cx - lon0) * KY * Math.cos(lat0 * Math.PI / 180)
    const my = (v.cy - lat0) * KY
    ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (w / 2 - mx * s), dpr * (h / 2 + my * s))
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.fillStyle = MAP_STYLE.park; for (const p of base.park) ctx.fill(p, 'evenodd')
    ctx.fillStyle = MAP_STYLE.water; for (const p of base.water) ctx.fill(p, 'evenodd')
    ctx.lineWidth = 1.2 / s; ctx.strokeStyle = MAP_STYLE.rail; ctx.stroke(base.rail)
    ctx.fillStyle = MAP_STYLE.building; ctx.fill(base.building)
    if (s > 0.5) { ctx.lineWidth = 0.8 / s; ctx.strokeStyle = MAP_STYLE.buildingLine; ctx.stroke(base.building) }
    const order = ['service', 'pedestrian', 'minor', 'secondary', 'major']
    const widths = {}
    for (const k of order) { const [m, min] = MAP_STYLE.roads[k]; widths[k] = Math.max(min, m * s) }
    if (s < 0.25) widths.service = 0
    for (const k of order) {
      const casing = MAP_STYLE.roads[k][3]
      if (!casing || !widths[k]) continue
      ctx.lineWidth = (widths[k] + 2) / s; ctx.strokeStyle = casing; ctx.stroke(base.roads[k])
    }
    for (const k of order) {
      if (!widths[k]) continue
      ctx.lineWidth = widths[k] / s; ctx.strokeStyle = MAP_STYLE.roads[k][2]; ctx.stroke(base.roads[k])
    }
    return { s, mx, my }
  }

  drawLabels (w, h, dpr, { s, mx, my }) {
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.font = '500 11px Geist, system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const placed = []
    const minorOk = s > 0.45, secondaryOk = s > 0.2
    let count = 0
    for (const l of this.base.labels) {
      if (count > 70) break
      if (l.kind === 'minor' || l.kind === 'pedestrian') { if (!minorOk) continue } else if (l.kind === 'secondary' && !secondaryOk) continue
      if (l.len * s < 60) continue
      let tw = labelWidths.get(l.name)
      if (tw === undefined) { tw = ctx.measureText(l.name).width; labelWidths.set(l.name, tw) }
      if (tw + 16 > l.len * s) continue
      // point and direction halfway along the line, in screen pixels
      const pts = l.line
      let half = l.len / 2, x = 0, y = 0, ang = 0
      for (let i = 0; i < pts.length - 2; i += 2) {
        const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1]
        const seg = Math.hypot(dx, dy)
        if (half <= seg || i >= pts.length - 4) {
          const f = seg ? Math.min(1, half / seg) : 0
          x = pts[i] + dx * f; y = pts[i + 1] + dy * f; ang = Math.atan2(-dy, dx)
          break
        }
        half -= seg
      }
      const sx = w / 2 + (x - mx) * s, sy = h / 2 - (y - my) * s
      if (sx < 0 || sy < 0 || sx > w || sy > h) continue
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI
      const hw = (Math.abs(Math.cos(ang)) * tw + Math.abs(Math.sin(ang)) * 12) / 2 + 4
      const hh = (Math.abs(Math.sin(ang)) * tw + Math.abs(Math.cos(ang)) * 12) / 2 + 4
      if (placed.some(b => Math.abs(b.x - sx) < b.hw + hw && Math.abs(b.y - sy) < b.hh + hh)) continue
      placed.push({ x: sx, y: sy, hw, hh })
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang)
      ctx.lineWidth = 3; ctx.strokeStyle = MAP_STYLE.halo; ctx.strokeText(l.name, 0, 0)
      ctx.fillStyle = MAP_STYLE.text; ctx.fillText(l.name, 0, 0)
      ctx.restore()
      count++
    }
  }

  // ---- shared marks ----
  pin (x, y, color) {
    const ctx = this.ctx
    ctx.save(); ctx.translate(x, y)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-3, -8, -11, -14, -11, -23)
    ctx.arc(0, -23, 11, Math.PI, 0)
    ctx.bezierCurveTo(11, -14, 3, -8, 0, 0)
    ctx.closePath()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2
    ctx.fillStyle = color; ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#FFFFFF'; ctx.stroke()
    ctx.beginPath(); ctx.arc(0, -23, 4, 0, 7); ctx.fillStyle = '#FFFFFF'; ctx.fill()
    ctx.restore()
  }

  ring (x, y) {
    const ctx = this.ctx
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fillStyle = '#FFFFFF'; ctx.fill()
    ctx.lineWidth = 3; ctx.strokeStyle = MAP_STYLE.truth; ctx.stroke()
  }

  dashed (a, b, color) {
    const ctx = this.ctx
    ctx.save(); ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = color
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore()
  }

  coverage (points, s) {
    const ctx = this.ctx, [w, h] = this.size()
    const r = Math.max(1.4, Math.min(3, s * 2.2))
    ctx.fillStyle = MAP_STYLE.coverage
    for (const [lat, lon] of points) {
      const [x, y] = this.project(lat, lon)
      if (x < -3 || y < -3 || x > w + 3 || y > h + 3) continue
      ctx.fillRect(x - r / 2, y - r / 2, r, r)
    }
  }

  // ---- input: drag to pan, wheel to zoom around the cursor, a click without a drag is a tap ----
  bindInput () {
    const c = this.canvas
    let drag = null
    c.addEventListener('pointerdown', e => {
      if (!this.view) return
      drag = { x: e.clientX, y: e.clientY, v: { ...this.view }, moved: false }
      try { c.setPointerCapture(e.pointerId) } catch {}
    })
    c.addEventListener('pointermove', e => {
      if (!drag) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true
      c.classList.add('dragging')
      cancelAnimationFrame(this.anim)
      this.view = { ...drag.v, cx: drag.v.cx - dx / (drag.v.k * drag.v.scale), cy: drag.v.cy + dy / drag.v.scale }
      this.draw()
    })
    const end = e => {
      if (drag && !drag.moved && e.type === 'pointerup' && this.onTap) {
        const r = c.getBoundingClientRect()
        this.onTap(this.unproject(e.clientX - r.left, e.clientY - r.top))
      }
      drag = null; c.classList.remove('dragging')
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('wheel', e => {
      if (!this.view) return
      e.preventDefault()
      cancelAnimationFrame(this.anim)
      const r = c.getBoundingClientRect()
      const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2
      const f = Math.exp(-e.deltaY * 0.0015)
      const v = this.view
      const scale = Math.min(Math.max(v.scale * f, 8000), 900000)
      const lon = v.cx + ox / (v.k * v.scale), lat = v.cy - oy / v.scale
      this.view = { ...v, scale, cx: lon - ox / (v.k * scale), cy: lat + oy / scale }
      this.draw()
    }, { passive: false })
  }
}
