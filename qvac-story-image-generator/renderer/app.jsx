/* ============================================================
   QVAC Story Image Generator — application root + state

   A five-screen flow: welcome → photo → choose story → generating
   → storybook. Everything is React state; no routing, no login.

   Two things are genuinely local AI / local compute:
     1. The model download + load is driven by the real @qvac/sdk
        progress events forwarded from the main process (the overlay).
     2. The five story captions are written on-device by the local
        Qwen3 model (IPC → main → completion()). The chosen story +
        character are the ONLY things the model sees.

   The child's photo never crosses the IPC bridge. It is read here
   with FileReader and composited into the SVG artwork (story-art.js)
   entirely in this renderer, so it never leaves the process.
   ============================================================ */
const { useState } = React;

const SPEED = { Cozy: 850, Quick: 450, Instant: 160 };
const GEN_PACE = SPEED.Cozy; // pace of the per-scene "painting" animation

// ---- Small hover helper (the design used a `style-hover` attribute) ----
function HoverEl({ tag = "button", style, hoverStyle, children, ...rest }) {
  const [hov, setHov] = useState(false);
  const Tag = tag;
  return (
    <Tag
      {...rest}
      style={{ ...style, ...(hov && !rest.disabled ? hoverStyle : null) }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {children}
    </Tag>
  );
}

// Inline SVG/markup box (mirrors the design's dangerouslySetInnerHTML usage).
function Svg({ html, style }) {
  return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---- On-device face auto-crop ----------------------------------------
// The uploaded photo is framed to just the face and zoomed so it fills the
// character's head — otherwise a wide portrait leaves the face tiny and it
// reads as a photo dropped into a circle. This runs entirely in the renderer
// on a <canvas> (no model, no library, no network); the photo never leaves
// this process. We find the face by its skin-coloured pixels, weighted toward
// the centre (the app asks for a front-facing photo), then crop a padded
// square around that region and re-scale it to a fixed size.
function isSkin(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return r > 60 && g > 30 && b > 15 && r > g && r >= b && (mx - mn) > 10 &&
    (r - g) >= 8 && (r - g) < 80 && (r - b) < 140; // redder than green, but not saturated-red clothing
}

function centerSquare(img, W, H) {
  // Fallback: central square, biased slightly up (faces sit above centre).
  const side = Math.round(Math.min(W, H) * 0.9);
  const x0 = Math.round((W - side) / 2);
  const y0 = Math.max(0, Math.round((H - side) / 2 - H * 0.06));
  return drawCrop(img, x0, y0, side);
}

function drawCrop(img, x0, y0, side) {
  const OUT = 512;
  const c = document.createElement("canvas");
  c.width = OUT; c.height = OUT;
  const g = c.getContext("2d");
  g.drawImage(img, x0, y0, side, side, 0, 0, OUT, OUT);
  return c.toDataURL("image/jpeg", 0.92);
}

// Returns a Promise for a square, face-framed data URL. Always resolves
// (falls back to a centred crop, then the original) so a photo never fails.
function faceCropDataURL(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.naturalWidth, H = img.naturalHeight;
        const scale = Math.min(1, 220 / Math.max(W, H));
        const sw = Math.max(1, Math.round(W * scale)), sh = Math.max(1, Math.round(H * scale));
        const c = document.createElement("canvas");
        c.width = sw; c.height = sh;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, sw, sh);
        const d = g.getImageData(0, 0, sw, sh).data;
        const cxp = sw / 2, cyp = sh / 2, rad = Math.max(sw, sh);
        // Pass 1: weighted centroid of skin pixels (favouring the centre).
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const i = (y * sw + x) * 4;
            if (!isSkin(d[i], d[i + 1], d[i + 2])) continue;
            const dx = (x - cxp) / rad, dy = (y - cyp) / rad;
            const w = Math.exp(-(dx * dx + dy * dy) * 4);
            sx += x * w; sy += y * w; n += w;
          }
        }
        if (n < 8) return resolve(centerSquare(img, W, H));
        let cx = sx / n, cy = sy / n;
        // Pass 2: refine within a radius of the centroid so a far-off warm blob
        // (a torso, a hand, furniture) can't drag the crop off the face.
        const D = 0.34 * Math.min(sw, sh);
        let tx = 0, ty = 0, txx = 0, tyy = 0, m = 0;
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const i = (y * sw + x) * 4;
            if (!isSkin(d[i], d[i + 1], d[i + 2])) continue;
            const ex = x - cx, ey = y - cy;
            if (ex * ex + ey * ey > D * D) continue;
            const dx = (x - cxp) / rad, dy = (y - cyp) / rad;
            const w = Math.exp(-(dx * dx + dy * dy) * 4);
            tx += x * w; ty += y * w; txx += x * x * w; tyy += y * y * w; m += w;
          }
        }
        if (m < 8) return resolve(centerSquare(img, W, H));
        cx = tx / m; cy = ty / m;
        const stdX = Math.sqrt(Math.max(0, txx / m - cx * cx));
        const stdY = Math.sqrt(Math.max(0, tyy / m - cy * cy));
        const spread = Math.max(stdX, stdY);
        const minH = 0.16 * Math.min(sw, sh), maxH = 0.6 * Math.min(sw, sh);
        let half = Math.min(maxH, Math.max(minH, spread * 2.4)) * 1.18; // slight pad for hair/chin
        // back to source pixels; keep a true square that fits the image
        let side = Math.min(Math.round(half * 2 / scale), W, H);
        const fx = cx / scale, fy = (cy - half * 0.12) / scale; // bias up for forehead
        const x0 = Math.max(0, Math.min(Math.round(fx - side / 2), W - side));
        const y0 = Math.max(0, Math.min(Math.round(fy - side / 2), H - side));
        resolve(drawCrop(img, x0, y0, side));
      } catch (e) {
        resolve(dataUrl); // decoding/canvas failure → use original untouched
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

const ICON = {
  lock: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  spark: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 5.3 3.5c.4.3.8.2 1.1-.1l.4-.4c.4-.4.5-.9.3-1.3z" />
    </svg>
  ),
  back: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  camera: (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#16E3C1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" /><circle cx="12" cy="13" r="3" />
    </svg>
  ),
  chevDown: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  ),
  chevLeft: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
  ),
  chevRight: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
  ),
};

class App extends React.Component {
  constructor(props) {
    super(props);
    const bridge = window.QVAC_BRIDGE;
    this.state = {
      screen: "welcome",
      modelStatus: bridge
        ? { state: "loading", progress: 0, label: "Starting the story AI…" }
        : { state: "error", progress: 0, label: "Local model unavailable" },
      downloading: false,
      photo: null,
      facePhoto: null,
      photoName: "",
      expandedStory: null,
      selectedStory: null,
      selectedChar: null,
      genStep: 0,
      captions: null,
      currentSlide: 0,
    };
    this._cache = {};
    this._cc = {};
    this._ac = {};
    this._step = 0;
    this._captionsReady = false;
  }

  componentDidMount() {
    const bridge = window.QVAC_BRIDGE;
    if (bridge) {
      bridge.onModelProgress((status) => this.handleModelStatus(status));
      bridge.getModelStatus().then((s) => s && this.handleModelStatus(s)).catch(() => {});
    }
    this._key = (e) => {
      if (this.state.screen !== "result") return;
      if (e.key === "ArrowRight") this.next();
      else if (e.key === "ArrowLeft") this.prev();
    };
    window.addEventListener("keydown", this._key);
  }
  componentWillUnmount() {
    window.removeEventListener("keydown", this._key);
    clearInterval(this._gen);
    clearTimeout(this._t2);
  }

  handleModelStatus = (status) => {
    this.setState((prev) => {
      const patch = { modelStatus: status };
      // If the user is waiting on the download overlay, advance once the
      // model is ready (or has errored — we fall back to offline captions).
      if (prev.downloading && (status.state === "ready" || status.state === "error")) {
        patch.downloading = false;
        patch.screen = "photo";
      }
      return patch;
    });
  };

  start = () => {
    const s = this.state.modelStatus.state;
    if (s === "ready" || s === "error") this.setState({ screen: "photo" });
    else this.setState({ downloading: true });
  };

  fileRef = (el) => { this._file = el; };
  pickPhoto = () => { if (this._file) this._file.click(); };
  onPhotoChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      // Show the original right away as the preview; then, on-device, frame it
      // to just the face so it fills the character's head in the artwork.
      this.setState({ photo: rd.result, facePhoto: null, photoName: f.name });
      faceCropDataURL(rd.result).then((cropped) => {
        // Ignore if the user has already picked a different photo since.
        if (this.state.photo === rd.result) this.setState({ facePhoto: cropped });
      });
    };
    rd.readAsDataURL(f); // stays in the renderer; never sent across IPC
  };

  back = () => {
    const s = this.state.screen;
    if (s === "photo") this.setState({ screen: "welcome" });
    else if (s === "story") this.setState({ screen: "photo" });
  };
  toStory = () => { if (this.state.photo) this.setState({ screen: "story" }); };

  toggleStory = (k) => {
    this.setState((s) =>
      s.expandedStory === k
        ? { expandedStory: null }
        : { expandedStory: k, selectedStory: null, selectedChar: null }
    );
  };
  selectChar = (k, ci) => this.setState({ selectedStory: k, selectedChar: ci });

  create = () => {
    if (this.state.selectedChar == null) return;
    const story = STORIES.find((s) => s.key === this.state.selectedStory);
    const charName = story.chars[this.state.selectedChar];

    this._captionsReady = false;
    this._step = 1;
    this.setState({ screen: "generating", genStep: 1, captions: null });

    // Visual pacing: "paint" one scene at a time.
    clearInterval(this._gen);
    this._gen = setInterval(() => {
      this.setState((s) => {
        const n = s.genStep + 1;
        if (n >= 5) {
          clearInterval(this._gen);
          this._step = 5;
          this._maybeFinish();
          return { genStep: 5 };
        }
        this._step = n;
        return { genStep: n };
      });
    }, GEN_PACE);

    // Real work: the local model writes the five captions on-device.
    const bridge = window.QVAC_BRIDGE;
    const job = bridge && bridge.generateCaptions
      ? bridge.generateCaptions(story.name, charName)
      : Promise.reject(new Error("Local model unavailable"));

    job
      .then((caps) => this.setState({ captions: caps }))
      .catch((err) => {
        console.warn("[QVAC] caption generation failed — using offline story:", err.message);
        this.setState({ captions: story.captions });
      })
      .finally(() => {
        this._captionsReady = true;
        this._maybeFinish();
      });
  };

  _maybeFinish = () => {
    if (this._captionsReady && this._step >= 5) {
      clearTimeout(this._t2);
      this._t2 = setTimeout(() => this.setState({ screen: "result", currentSlide: 0 }), 460);
    }
  };

  next = () => this.setState((s) => ({ currentSlide: Math.min(4, s.currentSlide + 1) }));
  prev = () => this.setState((s) => ({ currentSlide: Math.max(0, s.currentSlide - 1) }));
  go = (i) => this.setState({ currentSlide: i });

  startOver = () =>
    this.setState({
      screen: "photo", expandedStory: null, selectedStory: null, selectedChar: null,
      genStep: 0, captions: null, currentSlide: 0,
    });

  // ---- Cached SVG markup (stable strings → no DOM churn) ----
  _art(key, i, photo, ci) {
    const ck = key + "|" + i + "|" + (photo ? photo.length : 0) + "|" + (ci || 0);
    if (!this._cache[ck]) this._cache[ck] = sceneSVG(key, i, photo, ci);
    return this._cache[ck];
  }
  _cover(key) {
    if (!this._cc[key]) this._cc[key] = sceneSVG(key, 0, null, 0);
    return this._cc[key];
  }
  _avatar(key, ci) {
    const k = key + ci;
    if (!this._ac[k]) this._ac[k] = charAvatar(key, ci);
    return this._ac[k];
  }
  _welcome() {
    if (!this._wel) this._wel = welcomeArt();
    return this._wel;
  }

  render() {
    const st = this.state;
    const story = STORIES.find((s) => s.key === st.selectedStory) || STORIES[0];
    const accent = st.selectedStory ? story.accent : "#16E3C1";
    const ci = st.selectedChar || 0;
    const captions = st.captions && st.captions.length === 5 ? st.captions : story.captions;

    // Sidebar step indicator
    const order = ["Add a photo", "Choose a story", "Create", "Storybook"];
    const map = { welcome: -1, photo: 0, story: 1, generating: 2, result: 3 };
    const a = map[st.screen];

    const cur = st.currentSlide;
    const dlPct = Math.round(st.modelStatus.progress || 0);

    return (
      <div style={{ display: "flex", height: "100vh", width: "100%", background: "#171817", color: "#ECF1EE", fontFamily: "var(--font-body)", fontWeight: 300, overflow: "hidden", position: "relative" }}>
        {/* ---------------- Sidebar ---------------- */}
        <aside style={{ width: 280, flex: "none", background: "#000", borderRight: "1px solid #1d2422", display: "flex", flexDirection: "column", padding: "26px 22px" }}>
          <img src="assets/qvac-logo.svg" alt="qvac" style={{ height: 17, width: "auto", opacity: 0.95 }} />
          <div style={{ fontFamily: "var(--font-display)", fontSize: 12, letterSpacing: 2, color: "#5f6b66", textTransform: "uppercase", margin: "12px 0 32px" }}>Story Studio</div>

          {order.map((label, i) => {
            const done = i < a, curStep = i === a;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 0" }}>
                <div style={{ width: 27, height: 27, borderRadius: 999, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13, border: "1px solid " + ((curStep || done) ? "#16E3C1" : "#30504B"), background: done ? "#16E3C1" : "transparent", color: done ? "#0a0c0b" : (curStep ? "#16E3C1" : "#5f6b66"), transition: "all .3s var(--ease)" }}>{done ? "✓" : String(i + 1)}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: curStep ? "#ECF1EE" : (done ? "#cfd8d4" : "#5f6b66"), transition: "all .3s var(--ease)" }}>{label}</div>
              </div>
            );
          })}

          <div style={{ flex: 1 }} />

          <div style={{ border: "1px solid #243a36", borderRadius: 8, padding: 15, background: "linear-gradient(180deg,rgba(22,227,193,0.05),transparent)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "#16E3C1", animation: "dotpulse 2.2s var(--ease) infinite" }} />
              <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color: "#16E3C1", letterSpacing: 0.5 }}>On-device</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#A0B2AC", fontSize: 12.5, marginBottom: 7 }}>{ICON.lock}Private &amp; encrypted</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, color: "#A0B2AC", fontSize: 12.5 }}>{ICON.spark}Works fully offline</div>
          </div>
        </aside>

        {/* ---------------- Main ---------------- */}
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <header style={{ height: 62, flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 30px", borderBottom: "1px solid #1d2422" }}>
            <div>
              {(st.screen === "photo" || st.screen === "story") && (
                <HoverEl onClick={this.back}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", border: "1px solid #30504B", color: "#ECF1EE", fontFamily: "var(--font-display)", fontSize: 14, padding: "8px 14px", borderRadius: 8, cursor: "pointer", transition: "all .3s var(--ease)" }}
                  hoverStyle={{ borderColor: "#16E3C1", color: "#16E3C1" }}>
                  {ICON.back}Back
                </HoverEl>
              )}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid #243a36", borderRadius: 999, padding: "6px 14px", color: "#16E3C1", fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: 0.5 }}>{ICON.spark}Offline</div>
          </header>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}>
            {st.screen === "welcome" && this.renderWelcome()}
            {st.screen === "photo" && this.renderPhoto()}
            {st.screen === "story" && this.renderStory(story)}
            {st.screen === "generating" && this.renderGenerating(story, ci)}
            {st.screen === "result" && this.renderResult(story, accent, ci, captions, cur)}
          </div>
        </main>

        {/* ---------------- Download overlay ---------------- */}
        {st.downloading && (
          <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, animation: "fadeUp .3s var(--ease)" }}>
            <div style={{ width: "min(440px,100%)", border: "1px solid #243a36", borderRadius: 16, background: "#0c0e0d", padding: 34, textAlign: "center" }}>
              <div style={{ position: "relative", width: 80, height: 80, margin: "0 auto 22px" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 999, background: "radial-gradient(circle,rgba(22,227,193,0.25),transparent 70%)" }} />
                <div style={{ position: "absolute", inset: 6, border: "2px dashed #16E3C1", borderRadius: 999, opacity: 0.5, animation: "spinSlow 7s linear infinite" }} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#16E3C1" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16l-1.9-5.1L4.5 9l5.6-1.4z" /></svg>
                </div>
              </div>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, color: "#16E3C1", margin: "0 0 4px" }}>Getting your story magic ready…</h3>
              <div style={{ height: 8, borderRadius: 999, background: "#1a2220", overflow: "hidden", margin: "20px 0 12px" }}>
                <div style={{ height: "100%", width: dlPct + "%", background: "#16E3C1", transition: "width .12s linear" }} />
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "#ECF1EE", marginBottom: 14 }}>{st.modelStatus.label || dlPct + "%"}</div>
              <p style={{ color: "#A0B2AC", fontSize: 15, margin: "0 0 6px", textWrap: "pretty" }}>Downloading the AI — after this, you're fully offline.</p>
              <div style={{ color: "#5f6b66", fontSize: 13 }}>This happens just once.</div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // ---------------- Screen: welcome ----------------
  renderWelcome() {
    return (
      <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: 3, color: "#16E3C1", textTransform: "uppercase", marginBottom: 6 }}>QVAC</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 46, lineHeight: 1.08, color: "#16E3C1", margin: "0 0 12px" }}>Story Image Generator</h1>
        <p style={{ fontFamily: "var(--font-body)", fontWeight: 300, fontSize: 20, color: "#ECF1EE", maxWidth: 480, margin: "0 0 8px" }}>Turn your child into the hero of a magical story.</p>
        <Svg html={this._welcome()} style={{ width: "min(440px,68%)", margin: "8px 0 26px" }} />
        <HoverEl onClick={this.start}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, letterSpacing: 0.8, padding: "15px 48px", borderRadius: 8, border: "none", background: "#16E3C1", color: "#0a0c0b", cursor: "pointer", transition: "all .3s var(--ease)" }}
          hoverStyle={{ background: "#00AF92" }}>Start</HoverEl>
        <div style={{ marginTop: 22, display: "inline-flex", alignItems: "center", gap: 8, color: "#A0B2AC", fontSize: 14 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          Everything happens on your device. Your photos stay private.
        </div>
      </div>
    );
  }

  // ---------------- Screen: photo ----------------
  renderPhoto() {
    const st = this.state;
    const canCont = !!st.photo;
    return (
      <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "46px 40px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 34, color: "#16E3C1", margin: "0 0 8px", textAlign: "center" }}>Add a photo of your child</h2>
        <p style={{ color: "#A0B2AC", fontSize: 16, margin: "0 0 34px", textAlign: "center" }}>A clear, front-facing face photo works best.</p>

        <input type="file" accept="image/*" ref={this.fileRef} onChange={this.onPhotoChange} className="sig-hidden-file" />

        {st.photo ? (
          <div style={{ width: "min(420px,90%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 5", borderRadius: 18, overflow: "hidden", border: "1px solid #243a36" }}>
              <img src={st.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="your child" />
              <div style={{ position: "absolute", left: 14, bottom: 14, display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(10,12,11,0.78)", border: "1px solid #16E3C1", color: "#16E3C1", borderRadius: 999, padding: "7px 14px", fontFamily: "var(--font-display)", fontSize: 14, backdropFilter: "blur(4px)" }}>{ICON.check}Looks great!</div>
            </div>
            <button onClick={this.pickPhoto} style={{ marginTop: 14, background: "transparent", border: "none", color: "#A0B2AC", fontFamily: "var(--font-display)", fontSize: 14, textDecoration: "underline", cursor: "pointer" }}>Choose a different photo</button>
          </div>
        ) : (
          <HoverEl onClick={this.pickPhoto}
            style={{ width: "min(420px,90%)", aspectRatio: "4 / 5", borderRadius: 18, border: "2px dashed #30504B", background: "rgba(22,227,193,0.02)", color: "#ECF1EE", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, cursor: "pointer", transition: "all .3s var(--ease)" }}
            hoverStyle={{ borderColor: "#16E3C1", background: "rgba(22,227,193,0.05)" }}>
            {ICON.camera}
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "#ECF1EE" }}>Tap to choose a photo</span>
          </HoverEl>
        )}

        <button onClick={this.toStory} disabled={!canCont}
          style={{ marginTop: 32, display: "inline-flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, letterSpacing: 0.8, padding: "15px 46px", borderRadius: 8, border: "none", background: canCont ? "#16E3C1" : "#1a2220", color: canCont ? "#0a0c0b" : "#5f6b66", cursor: canCont ? "pointer" : "not-allowed", transition: "all .3s var(--ease)" }}>Continue</button>
        <div style={{ marginTop: "auto", paddingTop: 28, color: "#5f6b66", fontSize: 13, textAlign: "center" }}>This photo stays on your device — it's never uploaded.</div>
      </div>
    );
  }

  // ---------------- Screen: choose story ----------------
  renderStory() {
    const st = this.state;
    const canCreate = st.selectedChar != null;
    const sel = STORIES.find((s) => s.key === st.selectedStory) || STORIES[0];
    return (
      <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "44px 40px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 34, color: "#16E3C1", margin: "0 0 8px", textAlign: "center" }}>Choose a story</h2>
        <p style={{ color: "#A0B2AC", fontSize: 16, margin: "0 0 28px", textAlign: "center" }}>Pick a tale, then choose who your child becomes.</p>
        <div style={{ width: "min(720px,100%)", display: "flex", flexDirection: "column", gap: 16 }}>
          {STORIES.map((s) => {
            const expanded = st.expandedStory === s.key;
            const cardBorder = (expanded || st.selectedStory === s.key) ? s.accent : "#30504B";
            return (
              <div key={s.key} style={{ border: "1px solid " + cardBorder, borderRadius: 16, overflow: "hidden", background: "#101312", transition: "all .3s var(--ease)" }}>
                <button onClick={() => this.toggleStory(s.key)} style={{ width: "100%", display: "flex", alignItems: "stretch", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit", padding: 0 }}>
                  <div style={{ width: 160, flex: "none", position: "relative", overflow: "hidden" }}><Svg html={this._cover(s.key)} style={{ position: "absolute", inset: 0 }} /></div>
                  <div style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, color: s.accent }}>{s.name}</div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "#A0B2AC", textWrap: "pretty" }}>{s.teaser}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", paddingRight: 20, color: "#5f6b66" }}>{ICON.chevDown}</div>
                </button>
                {expanded && (
                  <div style={{ padding: "4px 20px 20px", display: "flex", gap: 16, animation: "fadeUp .35s var(--ease)" }}>
                    {s.chars.map((cn, cidx) => {
                      const picked = st.selectedStory === s.key && st.selectedChar === cidx;
                      return (
                        <button key={cidx} onClick={() => this.selectChar(s.key, cidx)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 14, padding: 13, borderRadius: 12, border: "1.5px solid " + (picked ? s.accent : "#30504B"), background: picked ? s.soft : "transparent", cursor: "pointer", transition: "all .3s var(--ease)", textAlign: "left", color: "inherit" }}>
                          <div style={{ width: 54, height: 54, flex: "none", borderRadius: 999, overflow: "hidden" }}><Svg html={this._avatar(s.key, cidx)} style={{ width: "100%", height: "100%" }} /></div>
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "#ECF1EE" }}>{cn}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={this.create} disabled={!canCreate}
          style={{ marginTop: 30, display: "inline-flex", alignItems: "center", gap: 9, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, letterSpacing: 0.8, padding: "15px 40px", borderRadius: 8, border: "none", background: canCreate ? sel.accent : "#1a2220", color: canCreate ? "#0a0c0b" : "#5f6b66", cursor: canCreate ? "pointer" : "not-allowed", transition: "all .3s var(--ease)" }}>Create my story ✨</button>
      </div>
    );
  }

  // ---------------- Screen: generating ----------------
  renderGenerating(story, ci) {
    const st = this.state;
    const pf = st.facePhoto || st.photo;
    const label = st.genStep >= 5 && !this._captionsReady ? "Writing your story…" : "Painting scene " + Math.min(st.genStep, 5) + " of 5…";
    const pct = Math.round(st.genStep / 5 * 100) + "%";
    return (
      <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ position: "relative", width: 118, height: 118, marginBottom: 30 }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 999, background: "radial-gradient(circle,rgba(22,227,193,0.25),transparent 70%)" }} />
          <div style={{ position: "absolute", inset: 8, border: "2px dashed #16E3C1", borderRadius: 999, opacity: 0.45, animation: "spinSlow 9s linear infinite" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#16E3C1", animation: "floaty 3s var(--ease) infinite" }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16l-1.9-5.1L4.5 9l5.6-1.4z" /></svg>
          </div>
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 32, color: "#16E3C1", margin: "0 0 8px" }}>Painting your story…</h2>
        <p style={{ color: "#ECF1EE", fontSize: 18, margin: 0 }}>{label}</p>
        <div style={{ display: "flex", gap: 12, margin: "26px 0 24px" }}>
          {[0, 1, 2, 3, 4].map((i) => {
            const done = i < st.genStep, act = i === st.genStep - 1;
            return (
              <div key={i} style={{ position: "relative", width: 98, height: 74, borderRadius: 10, overflow: "hidden", border: "1px solid " + (done ? story.accent : "#23302d"), opacity: done ? 1 : 0.26, transition: "all .4s var(--ease)" }}>
                <Svg html={this._art(story.key, i, pf, ci)} style={{ position: "absolute", inset: 0 }} />
                <div style={{ position: "absolute", inset: 0, borderRadius: 10, border: "1.5px solid #16E3C1", opacity: 0, animation: act ? "softpulse 1.4s var(--ease) infinite" : "none" }} />
              </div>
            );
          })}
        </div>
        <div style={{ width: "min(460px,80%)", height: 8, borderRadius: 999, background: "#1a2220", overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct, background: "#16E3C1", borderRadius: 999, transition: "width .4s var(--ease)" }} />
        </div>
        <div style={{ marginTop: 26, display: "inline-flex", alignItems: "center", gap: 9, border: "1px solid #243a36", borderRadius: 999, padding: "9px 18px", color: "#16E3C1", fontFamily: "var(--font-display)", fontSize: 15 }}>{ICON.spark}You're offline — and it still works</div>
      </div>
    );
  }

  // ---------------- Screen: result (storybook) ----------------
  renderResult(story, accent, ci, captions, cur) {
    const st = this.state;
    const pf = st.facePhoto || st.photo;
    return (
      <div style={{ minHeight: "calc(100vh - 62px)", display: "flex", flexDirection: "column", alignItems: "center", padding: "30px 40px" }}>
        <div style={{ position: "relative", width: "min(760px,100%)", aspectRatio: "3 / 2", borderRadius: 18, overflow: "hidden", border: "1px solid #243a36", background: "#000" }}>
          <div style={{ display: "flex", width: "500%", height: "100%", transform: "translateX(-" + (cur * 20) + "%)", transition: "transform .45s var(--ease)" }}>
            {captions.map((cap, i) => {
              return (
                <div key={i} style={{ flex: "0 0 20%", position: "relative", height: "100%" }}>
                  <Svg html={this._art(story.key, i, pf, ci)} style={{ position: "absolute", inset: 0 }} />
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "18px 24px 36px", background: "linear-gradient(180deg,rgba(8,9,8,0.82),rgba(8,9,8,0.42) 60%,transparent)", borderTop: "3px solid " + accent, display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ flex: "none", width: 28, height: 28, borderRadius: 999, background: accent, color: "#0a0c0b", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                    <span style={{ fontFamily: "var(--font-body)", fontWeight: 400, fontSize: 19, color: "#fff", textWrap: "pretty" }}>{cap}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <HoverEl onClick={this.prev}
            style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", width: 46, height: 46, borderRadius: 999, background: "rgba(10,12,11,0.5)", border: "1px solid #30504B", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", transition: "all .3s var(--ease)" }}
            hoverStyle={{ borderColor: "#16E3C1", color: "#16E3C1" }}>{ICON.chevLeft}</HoverEl>
          <HoverEl onClick={this.next}
            style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", width: 46, height: 46, borderRadius: 999, background: "rgba(10,12,11,0.5)", border: "1px solid #30504B", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", transition: "all .3s var(--ease)" }}
            hoverStyle={{ borderColor: "#16E3C1", color: "#16E3C1" }}>{ICON.chevRight}</HoverEl>
        </div>

        <div style={{ display: "flex", gap: 8, margin: "20px 0" }}>
          {captions.map((_, i) => (
            <button key={i} onClick={() => this.go(i)} style={{ height: 9, borderRadius: 999, border: "none", cursor: "pointer", transition: "all .3s var(--ease)", width: i === cur ? 28 : 9, background: i === cur ? story.accent : "#30504B" }} />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <HoverEl onClick={this.startOver}
            style={{ background: "transparent", border: "1px solid #30504B", color: "#A0B2AC", fontFamily: "var(--font-display)", fontSize: 15, padding: "13px 26px", borderRadius: 8, cursor: "pointer", transition: "all .3s var(--ease)" }}
            hoverStyle={{ borderColor: "#16E3C1", color: "#16E3C1" }}>Start over</HoverEl>
        </div>
        <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, color: "#5f6b66", fontSize: 13 }}>{ICON.spark}Created on your device · works offline</div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
