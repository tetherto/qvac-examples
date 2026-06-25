// QVAC Realtime - mini-games. Pure client-side canvas; the INPUT (fingertips, head
// position) comes from the QVAC ONNX hand-pose + person detector. 100% on-device.
//
// app.js calls QGames.<game>.frame(ctx, view, input) every animation frame:
//   view  = { w, h, offX, offY, dispW, dispH }            // displayed video rect in the overlay
//   input = { now, dt, hands:[{x,y}], head:{x,y,w}|null }  // px in full-overlay coords (mirrored)
// Each game owns a wait -> play -> over state machine, 30s rounds, and draws everything.
// High scores (name + score) persist in localStorage; app.js shows a name-entry overlay
// when frame() returns { needName: true }, then calls game.submitName(name).
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);
  // AI Slash icons: QVAC / on-device-AI / privacy themed (🍐 = the Pear runtime). Edit freely.
  const ICONS = ["🤖", "🍐", "🔒", "🛡️", "📱"];
  const ROUND_MS = 30000;
  const secsLeft = (ms) => Math.max(0, Math.ceil(ms / 1000));

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // ---- high scores (localStorage) ----
  function loadHS(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
  function topHS(key) { return loadHS(key).slice().sort((a, b) => b.score - a.score).slice(0, 5); }
  function qualifies(key, score) { if (score <= 0) return false; const t = topHS(key); return t.length < 5 || score > t[t.length - 1].score; }
  function submitHS(key, name, score) {
    const a = loadHS(key);
    a.push({ name: (name || "Player").slice(0, 12), score });
    localStorage.setItem(key, JSON.stringify(a.sort((x, y) => y.score - x.score).slice(0, 5)));
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Head Stack blocks cycle the QVAC/Holepunch ecosystem: QVAC (inline-SVG mark) + Keet,
  // Pears, WDK (local PNG wordmarks in public/vendor/logos). All local, no network.
  const qvacImg = new Image(); qvacImg.src = "/vendor/logos/qvac.svg"; // full QVAC wordmark (not just the Q mark)
  const keetImg = new Image(); keetImg.src = "/vendor/logos/keet.png";
  const pearsImg = new Image(); pearsImg.src = "/vendor/logos/pears.png";
  const wdkImg = new Image(); wdkImg.src = "/vendor/logos/wdk.png";
  const BLOCK_LOGOS = [qvacImg, keetImg, pearsImg, wdkImg]; // 0 = QVAC wordmark
  function fitImg(ctx, img, x, y, w, h, pad) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const mw = w - pad * 2, mh = h - pad * 2, ar = img.naturalWidth / img.naturalHeight;
    let dw = mw, dh = dw / ar; if (dh > mh) { dh = mh; dw = dh * ar; }
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  const BLOCK_BG = ["#0e2a25", "#18293a", "#161616", "#141414"]; // QVAC teal / Keet blue / Pears dark / WDK black (match each logo's brand bg)
  function drawBlock(ctx, x, y, w, h, idx) {
    const kind = ((idx % 4) + 4) % 4;   // 0 QVAC, 1 Keet, 2 Pears, 3 WDK
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = BLOCK_BG[kind];
    ctx.fill();
    fitImg(ctx, BLOCK_LOGOS[kind], x, y, w, h, Math.max(2, h * 0.18));
  }
  // a label on a dark rounded chip (readable over a bright/busy webcam feed)
  function chip(ctx, text, x, y, align, color) {
    ctx.save(); ctx.font = "700 20px Geist, sans-serif"; ctx.textBaseline = "top"; ctx.textAlign = "left";
    const w = ctx.measureText(text).width;
    const bx = align === "right" ? (x - w - 20) : x;
    ctx.fillStyle = "rgba(8,10,9,.55)"; roundRect(ctx, bx, y - 4, w + 20, 30, 8); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(text, bx + 10, y);
    ctx.restore();
  }
  // One overlay pass: optional screen dim + score/time chips + center title/sub + leaderboard.
  // The dim + chips keep all text readable over the camera image (the high score was invisible before).
  function drawScreen(ctx, view, o) {
    const W = view.w, H = view.h, pad = 16;
    ctx.save();
    if (o.dim) { ctx.fillStyle = `rgba(8,10,9,${o.dim})`; ctx.fillRect(0, 0, W, H); }
    chip(ctx, `${o.label || "Score"}: ${o.score}`, pad, pad, "left", "#16e3c1");
    chip(ctx, `⏱ ${o.time}`, W - pad, pad, "right", "#fff");
    // stack title -> sub -> leaderboard sequentially so nothing overlaps (the stage is short, 16:9)
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let cy = H * 0.2;
    if (o.center) {
      ctx.fillStyle = "#fff"; ctx.font = "800 32px Geist, sans-serif"; ctx.fillText(o.center, W / 2, cy); cy += 42;
      if (o.sub) { ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.font = "600 16px Geist, sans-serif"; ctx.fillText(o.sub, W / 2, cy); cy += 30; }
    }
    if (o.leaderboard) {
      const t = topHS(o.leaderboard);
      if (t.length) {
        cy += 12;
        ctx.fillStyle = "#16e3c1"; ctx.font = "700 14px Geist, sans-serif"; ctx.fillText("TOP SCORES", W / 2, cy); cy += 24;
        ctx.font = "700 18px Geist, sans-serif";
        for (let i = 0; i < t.length; i++) { ctx.fillStyle = i === 0 ? "#16e3c1" : "#fff"; ctx.fillText(`${i + 1}.  ${t[i].name}  ·  ${t[i].score}`, W / 2, cy); cy += 25; }
      }
    }
    // persistent right-side leaderboard (always visible in the mode, every phase)
    if (o.rightboard) {
      const t = topHS(o.rightboard);
      const pw = Math.min(220, W * 0.36), x0 = W - pw - 8, y0 = 62, ip = 10;
      const rows = Math.min(t.length, 5);
      const ph = ip * 2 + 20 + (rows ? 6 + rows * 22 : 18);
      ctx.fillStyle = "rgba(8,10,9,.5)"; roundRect(ctx, x0, y0, pw, ph, 10); ctx.fill();
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillStyle = "#16e3c1"; ctx.font = "700 12px Geist, sans-serif"; ctx.fillText("TOP SCORES", x0 + ip, y0 + ip);
      if (!rows) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "600 13px Geist, sans-serif"; ctx.fillText("no scores yet", x0 + ip, y0 + ip + 24); }
      else { ctx.font = "700 15px Geist, sans-serif"; for (let i = 0; i < rows; i++) { ctx.fillStyle = i === 0 ? "#16e3c1" : "#fff"; ctx.fillText(`${i + 1}. ${t[i].name}  ${t[i].score}`, x0 + ip, y0 + ip + 26 + i * 22); } }
    }
    ctx.restore();
  }

  // ======================= AI SLASH =======================
  const HS_FRUIT = "qvac_hs_fruit";
  const fruit = {
    s: null,
    start() { this.s = { phase: "wait", score: 0, fruits: [], halves: [], splashes: [], trails: new Map(), tEnd: 0, nextSpawn: 0, overAt: 0, final: 0, needName: false, named: false }; },
    begin(now) { const s = this.s; s.phase = "play"; s.score = 0; s.fruits = []; s.halves = []; s.splashes = []; s.tEnd = now + ROUND_MS; s.nextSpawn = now; s.needName = false; s.named = false; },
    submitName(name) { if (this.s) { submitHS(HS_FRUIT, name, this.s.final); this.s.named = true; this.s.needName = false; } },
    frame(ctx, view, input) {
      if (!this.s) this.start();
      const s = this.s, now = input.now, W = view.dispW, H = view.dispH, X = view.offX, Y = view.offY;
      const R = Math.min(W, H) * 0.095;            // bigger fruits (easier to hit)
      const hasHand = input.hands.length > 0;

      if (s.phase === "wait" && hasHand) this.begin(now);
      else if (s.phase === "play" && now >= s.tEnd) { s.phase = "over"; s.final = s.score; s.needName = qualifies(HS_FRUIT, s.final); s.named = false; s.overAt = now; }
      else if (s.phase === "over" && now - s.overAt > 1200 && hasHand && (s.named || !s.needName)) this.begin(now);

      const dt = Math.min(50, input.dt) / 1000;
      const g = H * 0.6;                            // gentler gravity -> more time to cut

      if (s.phase === "play" && now >= s.nextSpawn) {
        s.nextSpawn = now + rand(450, 850);
        s.fruits.push({ x: rand(0.15, 0.85) * W, y: -R, vx: rand(-30, 30), vy: rand(10, 35), r: R, e: ICONS[(Math.random() * ICONS.length) | 0], rot: 0, vr: rand(-2, 2), sliced: false, life: 0 });
      }
      for (const f of s.fruits) { f.vy += g * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; }

      // blade trails + forgiving "touch to cut" -> a sliced fruit splits into two flying halves
      input.hands.forEach((h, i) => {
        const tr = s.trails.get(i) || [];
        const prev = tr.length ? tr[tr.length - 1] : null;
        const cx = h.x - X, cy = h.y - Y;
        tr.push({ x: cx, y: cy, t: now }); while (tr.length > 16) tr.shift(); s.trails.set(i, tr);
        if (s.phase === "play") {
          const ax = prev ? prev.x : cx, ay = prev ? prev.y : cy;
          for (const f of s.fruits) {
            if (f.sliced || distToSeg(f.x, f.y, ax, ay, cx, cy) >= f.r * 1.2) continue;
            f.sliced = true; s.score++;
            s.splashes.push({ x: f.x, y: f.y, r: f.r, hue: rand(0, 360), life: 340, max: 340 });
            for (const side of [-1, 1]) s.halves.push({ e: f.e, x: f.x, y: f.y, r: f.r, side, vx: f.vx + side * rand(60, 150), vy: f.vy - rand(10, 70), rot: f.rot, vr: side * rand(2, 7), life: 750, max: 750 });
          }
        }
      });
      for (const [id, tr] of s.trails) { while (tr.length && now - tr[0].t > 220) tr.shift(); if (!tr.length) s.trails.delete(id); }

      for (const hf of s.halves) { hf.vy += g * dt; hf.x += hf.vx * dt; hf.y += hf.vy * dt; hf.rot += hf.vr * dt; hf.life -= input.dt; }
      s.fruits = s.fruits.filter((f) => !f.sliced && f.y - f.r < H + 60);
      s.halves = s.halves.filter((hf) => hf.life > 0 && hf.y - hf.r < H + 90);
      s.splashes = s.splashes.filter((p) => (p.life -= input.dt) > 0);

      ctx.save(); ctx.translate(X, Y);
      for (const p of s.splashes) { const a = p.life / p.max; ctx.globalAlpha = a; ctx.fillStyle = `hsl(${p.hue},85%,62%)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.5 - a), 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const f of s.fruits) { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.font = `${f.r * 2}px serif`; ctx.fillText(f.e, 0, 0); ctx.restore(); }
      // sliced halves: clip the emoji to its left / right half so it reads as cut in two
      for (const hf of s.halves) {
        ctx.save(); ctx.globalAlpha = Math.max(0, hf.life / hf.max); ctx.translate(hf.x, hf.y); ctx.rotate(hf.rot);
        ctx.beginPath();
        if (hf.side < 0) ctx.rect(-hf.r - 2, -hf.r - 2, hf.r + 2, hf.r * 2 + 4);
        else ctx.rect(0, -hf.r - 2, hf.r + 2, hf.r * 2 + 4);
        ctx.clip();
        ctx.font = `${hf.r * 2}px serif`; ctx.fillText(hf.e, hf.side * 2, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1; ctx.lineCap = "round"; ctx.strokeStyle = "#16e3c1";
      for (const [, tr] of s.trails) { for (let j = 1; j < tr.length; j++) { ctx.globalAlpha = (j / tr.length) * 0.9; ctx.lineWidth = (j / tr.length) * 12; ctx.beginPath(); ctx.moveTo(tr[j - 1].x, tr[j - 1].y); ctx.lineTo(tr[j].x, tr[j].y); ctx.stroke(); } }
      ctx.globalAlpha = 1; ctx.restore();

      drawScreen(ctx, view, {
        score: s.phase === "over" ? s.final : s.score, time: s.phase === "play" ? secsLeft(s.tEnd - now) : 30,
        dim: s.phase === "over" ? 0.6 : s.phase === "wait" ? 0.32 : 0,
        center: s.phase === "wait" ? "✋ Raise your hand to slice" : s.phase === "over" ? `Time! You sliced ${s.final}` : null,
        sub: s.phase === "over" ? (s.needName && !s.named ? "new high score! enter your name" : "raise your hand to play again") : null,
      });
      return { score: s.score, phase: s.phase, needName: s.needName && !s.named };
    },
  };

  // ======================= HEAD STACK =======================
  const HS_HEAD = "qvac_hs_head";
  const head = {
    s: null,
    start() { this.s = { phase: "wait", blocks: [], debris: [], falling: null, height: 0, maxH: 0, tEnd: 0, nextDrop: 0, readyT: 0, overAt: 0, final: 0, needName: false, named: false }; },
    begin(now) { const s = this.s; s.phase = "play"; s.blocks = []; s.debris = []; s.height = 0; s.maxH = 0; s.falling = null; s.tEnd = now + ROUND_MS; s.nextDrop = now + 800; s.needName = false; s.named = false; },
    submitName(name) { if (this.s) { submitHS(HS_HEAD, name, this.s.final); this.s.named = true; this.s.needName = false; } },
    frame(ctx, view, input) {
      if (!this.s) this.start();
      const s = this.s, now = input.now, W = view.dispW, H = view.dispH, X = view.offX, Y = view.offY;
      const hp = input.head;
      const dt = Math.min(50, input.dt) / 1000;
      const BW = Math.min(W, H) * 0.15, BH = BW * 0.52;
      const zone = { x: W / 2, y: H * 0.74, r: Math.min(W, H) * 0.15 };
      const hx = hp ? hp.x - X : null, hy = hp ? hp.y - Y : null;
      const hw = BW * 1.3;   // FIXED platform width, matched to the catch zone (~the block-on-block stability margin)
      const inZone = hp && Math.hypot(hx - zone.x, hy - zone.y) < zone.r;

      if (s.phase === "wait") { s.readyT = inZone ? s.readyT + input.dt : 0; if (s.readyT > 800) this.begin(now); }
      else if (s.phase === "play" && now >= s.tEnd) { s.phase = "over"; s.final = s.maxH; s.needName = qualifies(HS_HEAD, s.final); s.named = false; s.overAt = now; }
      else if (s.phase === "over" && now - s.overAt > 1200 && inZone && (s.named || !s.needName)) this.begin(now);

      const g = H * 0.9;
      const baseY = hp ? hy : H * 0.74;
      const stackTopY = baseY - s.blocks.length * BH;
      const stackX = hp ? hx : W / 2;
      const supportX = s.blocks.length ? (stackX + s.blocks[s.blocks.length - 1].dx) : stackX;

      if (s.phase === "play" && !s.falling && now >= s.nextDrop) s.falling = { x: rand(0.25, 0.75) * W, y: -BH, vy: H * 0.22 };
      if (s.falling) {
        s.falling.y += s.falling.vy * dt;
        if (s.falling.y + BH >= stackTopY) {
          const dx = s.falling.x - supportX;
          if (Math.abs(dx) < BW * 0.65) {                    // must land mostly ON the support (center within ~0.65 block); a block held by a tiny corner tips off
            s.blocks.push({ dx: s.falling.x - stackX });     // rest where it landed -> a natural lean
            s.height = s.blocks.length; if (s.height > s.maxH) s.maxH = s.height;
          } else {                                           // too much overhang -> it tips off as debris (no game over)
            s.debris.push({ x: s.falling.x, y: stackTopY, vx: (dx > 0 ? 1 : -1) * rand(30, 90), vy: -rand(0, 40), rot: 0, vr: rand(-6, 6) });
          }
          s.falling = null; s.nextDrop = now + rand(900, 1400);
        }
      }
      // realistic collapse: a block leaning too far past the base topples off as debris; the
      // round keeps running (timer only) and your best height already counts.
      while (s.phase === "play" && s.blocks.length && Math.abs(s.blocks[s.blocks.length - 1].dx) > BW * 1.8) {
        const b = s.blocks.pop(); const lvl = s.blocks.length;
        s.debris.push({ x: stackX + b.dx, y: baseY - (lvl + 1) * BH, vx: (b.dx > 0 ? 1 : -1) * rand(40, 100), vy: -rand(0, 30), rot: 0, vr: rand(-7, 7) });
        s.height = s.blocks.length;
      }
      for (const d of s.debris) { d.vy += g * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt; }
      s.debris = s.debris.filter((d) => d.y < H + BH * 3);

      ctx.save(); ctx.translate(X, Y);
      if (s.phase === "wait" || s.phase === "over") {
        ctx.lineWidth = 3; ctx.setLineDash([9, 7]); ctx.strokeStyle = inZone ? "#16e3c1" : "rgba(255,255,255,.65)";
        ctx.beginPath(); ctx.arc(zone.x, zone.y, zone.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      }
      if (hp && s.phase === "play") { ctx.fillStyle = "rgba(22,227,193,.30)"; ctx.fillRect(hx - hw / 2, baseY - 7, hw, 9); }
      for (let i = 0; i < s.blocks.length; i++) drawBlock(ctx, stackX + s.blocks[i].dx - BW / 2, baseY - (i + 1) * BH, BW - 3, BH - 3, i);
      if (s.falling) drawBlock(ctx, s.falling.x - BW / 2, s.falling.y, BW - 3, BH - 3, s.blocks.length); // next block shows its logo
      for (const d of s.debris) { ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot); ctx.fillStyle = "rgba(210,210,210,.82)"; ctx.fillRect(-BW / 2, -BH / 2, BW - 3, BH - 3); ctx.restore(); }
      ctx.restore();

      drawScreen(ctx, view, {
        label: "Tower", score: s.phase === "over" ? s.final : s.height, time: s.phase === "play" ? secsLeft(s.tEnd - now) : 30,
        dim: s.phase === "over" ? 0.6 : s.phase === "wait" ? 0.32 : 0,
        center: s.phase === "wait" ? "🧍 Put your head in the circle" : s.phase === "over" ? `Time! Tower of ${s.final}` : null,
        sub: s.phase === "wait" ? (inZone ? "hold still..." : "move so the circle is on your head") : s.phase === "over" ? (s.needName && !s.named ? "new high score! enter your name" : "get back in the circle to retry") : null,
      });
      return { score: s.height, phase: s.phase, needName: s.needName && !s.named };
    },
  };

  window.QGames = { fruit, head, resetAll() { fruit.start(); head.start(); } };
})();
