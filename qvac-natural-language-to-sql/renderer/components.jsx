/* ============================================================
   QVAC Natural Language to SQL - icons + presentational components
   Bespoke thin-geometric SVGs in the brand style (single mint
   stroke). Shared to window for the app script.
   ============================================================ */
const I = ({ size = 16, children, sw = 1.6, fill = "none", ...p }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    {...p}
  >
    {children}
  </svg>
);

const IconShield = (p) => (
  <I {...p}>
    <path d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </I>
);
const IconLock = (p) => (
  <I {...p}>
    <rect x="5" y="11" width="14" height="9" rx="1.6" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
  </I>
);
const IconTable = (p) => (
  <I {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="2.6" />
    <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
    <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
  </I>
);
const IconTri = (p) => (
  <I {...p} sw={0}><path d="M8 5l8 7-8 7z" fill="currentColor" /></I>
);
const IconCopy = (p) => (
  <I {...p}>
    <rect x="9" y="9" width="11" height="11" rx="1.6" />
    <path d="M5 15V5a1.6 1.6 0 0 1 1.6-1.6H15" />
  </I>
);
const IconKey = (p) => (
  <I {...p}>
    <circle cx="8" cy="8" r="3.4" />
    <path d="M10.5 10.5L20 20M16 16l2-2M19 13l1.5 1.5" />
  </I>
);
const IconSpark = (p) => (
  <I {...p}>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
    <path d="M18 15l.7 1.9L21 17.6l-2.3.7L18 21l-.7-2.3-2.3-.4 2.3-.9z" />
  </I>
);
const IconCode = (p) => (
  <I {...p}><path d="M9 8l-4 4 4 4M15 8l4 4-4 4" /></I>
);
const IconWarn = (p) => (
  <I {...p}>
    <path d="M12 4l9 15.5H3z" />
    <path d="M12 10v4" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </I>
);
const IconNoEdit = (p) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </I>
);
const IconInfo = (p) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" /></I>
);
const IconSend = (p) => (
  <I {...p}><path d="M5 12h13M12 5l7 7-7 7" /></I>
);
const IconPlay = (p) => (
  <I {...p} sw={0}><path d="M7 5l11 7-11 7z" fill="currentColor" /></I>
);
const IconCpu = (p) => (
  <I {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </I>
);

/* ----------------------- SIDEBAR ----------------------- */
function Badge() {
  return (
    <div className="badge">
      <IconShield size={26} style={{ color: "var(--qvac-green)" }} />
      <div className="badge-txt">
        <b>100% Local</b> · Nothing leaves this device.
      </div>
    </div>
  );
}

function SchemaTable({ t, count, open, onToggle }) {
  return (
    <div className="tbl">
      <div className={"tbl-head" + (open ? " open" : "")} onClick={onToggle}>
        <span className="tw"><IconTri size={10} /></span>
        <span className="tbl-icon"><IconTable size={15} /></span>
        <span className="tbl-name">{t.table}</span>
        <span className="tbl-rows">{count} rows</span>
      </div>
      {open && (
        <div className="cols">
          {t.columns.map((c) => (
            <div className="col" key={c.name}>
              <span className="cn">{c.name}</span>
              <span className="ct">{c.type}</span>
              {c.note && c.note.includes("primary key") && <span className="ck">PK</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ schema, counts, loaded, onLoadDemo, history, onPickHistory }) {
  const [openTbls, setOpenTbls] = React.useState({
    customers: true, accounts: false, transactions: false, loans: false, audit_log: false,
  });
  const toggle = (name) => setOpenTbls((s) => ({ ...s, [name]: !s[name] }));

  return (
    <aside className="side">
      <div className="side-brand">
        <div className="brand-row">
          <img src="assets/logo.svg" alt="qvac" />
        </div>
        <Badge />
      </div>

      <div className="side-scroll">
        <div className="sec-head">
          <span className="sec-title">Schema</span>
          <span className="sec-count">{loaded ? `${schema.length} tables` : "none"}</span>
        </div>

        {loaded ? (
          <div className="schema-list">
            {schema.map((t) => (
              <SchemaTable
                key={t.table}
                t={t}
                count={counts[t.table] ?? 0}
                open={!!openTbls[t.table]}
                onToggle={() => toggle(t.table)}
              />
            ))}
          </div>
        ) : (
          <div className="hist-empty">No database loaded.</div>
        )}

        <button className="load-demo" onClick={onLoadDemo}>
          <IconTable size={14} />
          {loaded ? "Reload demo bank schema" : "Load demo bank schema"}
        </button>

        <div className="sec-head" style={{ marginTop: 8 }}>
          <span className="sec-title">Query history</span>
          <span className="sec-count">{history.length ? `${history.length}` : "this session"}</span>
        </div>
        {history.length === 0 ? (
          <div className="hist-empty">
            Questions you ask this session appear here. Click any to re-run.
          </div>
        ) : (
          <div className="hist">
            {history.map((h, i) => (
              <button className="hist-item" key={h.id} onClick={() => onPickHistory(h)}>
                <span className="hn">{String(history.length - i).padStart(2, "0")}</span>
                <span className="hq">{h.question}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="side-foot">
        <span className="dot-live" />
        <span className="foot-txt">On-device · no network</span>
      </div>
    </aside>
  );
}

/* ----------------------- MODEL BANNER ----------------------- */
function ModelBanner({ status }) {
  if (!status || status.state === "ready") return null;

  const isError = status.state === "error";
  const pct = status.progress || 0;

  const displayLabel = isError
    ? "Model failed to load."
    : (status.label || "Loading model…");

  return (
    <div className={"model-banner" + (isError ? " model-banner-error" : "")}>
      <IconCpu size={14} style={{ color: isError ? "#e08a7a" : "var(--qvac-green)", flexShrink: 0 }} />
      <div className="mb-content">
        <span className="mb-label">{displayLabel}</span>
        {!isError && (
          <div className="mb-bar">
            <div className="mb-fill" style={{ width: pct + "%" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------- PANELS ----------------------- */
function PlanPanels({ plan, technical, sql, onSqlChange }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard && navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="plan">
      <div className="panel">
        <div className="panel-head">
          <span className="ph-icon"><IconSpark size={15} /></span>
          <span className="ph-title">What this will do</span>
        </div>
        <div className="summary-body">{plan.explanation || "No summary available."}</div>
      </div>

      {technical && (
        <div className="panel">
          <div className="panel-head">
            <span className="ph-icon"><IconCode size={15} /></span>
            <span className="ph-title">Generated SQL · editable</span>
            <button className="ph-copy" onClick={copy}>
              <IconCopy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <textarea
            className="sql-editor"
            value={sql}
            spellCheck={false}
            onChange={(e) => onSqlChange(e.target.value)}
            rows={Math.min(20, Math.max(4, sql.split("\n").length + 1))}
          />
          <div className="sql-foot">
            <IconLock size={12} style={{ color: "var(--qvac-green)" }} />
            Read-only · executed locally against in-memory SQLite
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ kind, children }) {
  return (
    <div className={"notice" + (kind === "block" ? " block" : "")}>
      {kind === "block"
        ? <IconNoEdit size={18} style={{ color: "#e0b85a" }} />
        : <IconWarn size={18} style={{ color: "#e08a7a" }} />}
      <div className="nt">{children}</div>
    </div>
  );
}

function fmtCell(val, colName) {
  if (val === null || val === undefined) return { text: "NULL", cls: "" };
  if (typeof val === "number") {
    const isMoney = /balance|debt|amount|total|sum|avg|principal|payment/i.test(colName || "");
    const text = isMoney
      ? val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : Number.isInteger(val) ? String(val) : val.toLocaleString("en-US");
    let cls = "num";
    if (/amount/i.test(colName || "")) cls += val < 0 ? " neg" : " pos";
    return { text, cls };
  }
  return { text: String(val), cls: "" };
}

function ResultsTable({ result }) {
  if (!result) return null;
  const { columns, rows } = result;
  return (
    <div className="results">
      <div className="results-head">
        <h3>Results</h3>
        <span className="rcount">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="table-wrap">
        <table className="rt">
          <thead>
            <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length || 1}><div className="empty-rows">No rows matched.</div></td></tr>
            ) : (
              rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((v, ci) => {
                    const f = fmtCell(v, columns[ci]);
                    return <td key={ci} className={f.cls}>{f.text}</td>;
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Charts: dependency-free inline SVG (100% local, no CDN/lib).
// Auto-builds a chart from any query result: first non-numeric column = labels,
// first numeric column = values. Bar (default) / Line (time series) / Pie.
// ============================================================
const CHART_COLORS = ["#16e3c1", "#78aaff", "#f5a97f", "#a6da95", "#c6a0f6", "#ee99a0", "#eed49f", "#8aadf4", "#7dc4e4", "#f0c6c6"];
const chTrunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const chNum = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return String(Math.round(n * 100) / 100);
};
const looksDate = (s) => /^\d{4}-\d{2}(-\d{2})?/.test(String(s));

function inferChart(result) {
  if (!result) return null;
  const { columns, rows } = result;
  if (!rows || !rows.length || !columns.length) return null;
  const isNum = (v) => v !== null && v !== "" && !isNaN(Number(v));
  const numIdx = columns.map((_, i) => i).filter((i) => rows.every((r) => isNum(r[i])));
  if (!numIdx.length) return null;
  let li = columns.findIndex((_, i) => !numIdx.includes(i));
  if (li < 0) li = 0;
  const idLike = (name) => /(^id$|_id$|^rowid$)/i.test(name);
  // Prefer a real measure (amount/balance/total) over an id/key column.
  const vi = numIdx.find((i) => i !== li && !idLike(columns[i])) ?? numIdx.find((i) => i !== li);
  if (vi == null) return null;
  const MAX = 24;
  const use = rows.slice(0, MAX);
  return {
    labels: use.map((r) => String(r[li] ?? "")),
    values: use.map((r) => Number(r[vi])),
    labelCol: columns[li],
    valueCol: columns[vi],
    isTime: use.length > 1 && use.every((r) => looksDate(r[li])),
    trimmed: rows.length > MAX,
    total: rows.length,
  };
}

function BarChart({ data }) {
  const max = Math.max(...data.values, 1);
  const barH = 24, gap = 12, labelW = 150, valW = 70, w = 820;
  const trackW = w - labelW - valW;
  const h = data.values.length * (barH + gap);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart-svg" preserveAspectRatio="xMinYMin meet">
      {data.values.map((v, i) => {
        const y = i * (barH + gap);
        const bw = Math.max(2, (v / max) * trackW);
        return (
          <g key={i}>
            <text x="0" y={y + barH * 0.72} className="ch-label">{chTrunc(data.labels[i], 20)}</text>
            <rect x={labelW} y={y} width={trackW} height={barH} className="ch-track" rx="5" />
            <rect x={labelW} y={y} width={bw} height={barH} className="ch-bar" rx="5" />
            <text x={labelW + bw + 8} y={y + barH * 0.72} className="ch-val">{chNum(v)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data }) {
  const max = Math.max(...data.values), min = Math.min(...data.values, 0);
  const w = 820, h = 300, padL = 8, padR = 56, padT = 12, padB = 34;
  const iw = w - padL - padR, ih = h - padT - padB, n = data.values.length;
  const xx = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yy = (v) => padT + ih - ((v - min) / ((max - min) || 1)) * ih;
  const pts = data.values.map((v, i) => `${xx(i)},${yy(v)}`).join(" ");
  const step = Math.ceil(n / 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart-svg" preserveAspectRatio="xMinYMin meet">
      <polyline points={pts} fill="none" className="ch-line" strokeWidth="2" />
      {data.values.map((v, i) => <circle key={i} cx={xx(i)} cy={yy(v)} r="3" className="ch-dot" />)}
      {data.labels.map((l, i) => (i % step === 0 || i === n - 1) ? (
        <text key={i} x={xx(i)} y={h - 12} className="ch-label" textAnchor="middle">{chTrunc(l, 10)}</text>
      ) : null)}
    </svg>
  );
}

function PieChart({ data }) {
  const total = data.values.reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
  const cx = 140, cy = 145, r = 120, W = 540, H = 300;
  let acc = 0;
  const arcs = data.values.map((v, i) => {
    const a0 = (acc / total) * 2 * Math.PI; acc += Math.max(0, v);
    const a1 = (acc / total) * 2 * Math.PI;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0);
    const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
    return { d: `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`, c: CHART_COLORS[i % CHART_COLORS.length], label: data.labels[i], v };
  });
  // Single self-contained SVG (slices + legend) so it exports cleanly to an image.
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMinYMin meet">
      {arcs.map((a, i) => <path key={i} d={a.d} fill={a.c} />)}
      {arcs.slice(0, 12).map((a, i) => (
        <g key={"lg" + i} transform={`translate(300, ${20 + i * 22})`}>
          <rect width="12" height="12" rx="3" fill={a.c} />
          <text x="20" y="11" className="ch-label">{chTrunc(a.label, 20)}</text>
          <text x="230" y="11" className="ch-val" textAnchor="end">{chNum(a.v)}</text>
        </g>
      ))}
    </svg>
  );
}

// Save the visible chart SVG as a JPEG. Inlines computed styles (so CSS-class
// fills survive), rasterizes onto a canvas with the app background, downloads.
function saveChartJpeg(svg, filename) {
  if (!svg) return;
  const clone = svg.cloneNode(true);
  const props = ["fill", "stroke", "stroke-width", "font-family", "font-size", "font-weight", "text-anchor", "opacity"];
  const src = [svg, ...svg.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];
  src.forEach((s, i) => {
    const cs = getComputedStyle(s);
    props.forEach((p) => { const v = cs.getPropertyValue(p); if (v) dst[i].setAttribute(p, v); });
  });
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const W = (vb && vb.width) || svg.clientWidth || 900;
  const H = (vb && vb.height) || svg.clientHeight || 500;
  const scale = 2;
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#161718";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/jpeg", 0.92);
    a.download = filename || "chart.jpg";
    a.click();
  };
  img.src = url;
}

// Result viewer: Table | Chart toggle. `defaultChart` opens straight to the chart
// (e.g. when the question asked for a graph). Used by both Ask results and Browse data.
function ResultView({ result, defaultChart }) {
  const chart = inferChart(result);
  const [mode, setMode] = React.useState(defaultChart && chart ? "chart" : "table");
  const [ctype, setCtype] = React.useState(null); // null = auto
  const chartRef = React.useRef(null);
  if (!result) return null;
  const { columns, rows } = result;
  const auto = chart && chart.isTime ? "line" : "bar";
  const type = ctype || auto;
  return (
    <div className="results">
      <div className="results-head">
        <h3>{mode === "chart" ? "Chart" : "Results"}</h3>
        <span className="rcount">{rows.length} row{rows.length === 1 ? "" : "s"}{chart && chart.trimmed && mode === "chart" ? ` · showing first ${chart.values.length}` : ""}</span>
        <div className="rv-toggle">
          <button className={mode === "table" ? "on" : ""} onClick={() => setMode("table")}>Table</button>
          <button className={mode === "chart" ? "on" : ""} onClick={() => setMode("chart")} disabled={!chart} title={chart ? "" : "Need a category + a numeric column to chart"}>Chart</button>
        </div>
      </div>

      {mode === "chart" && chart ? (
        <div className="chart-wrap" ref={chartRef}>
          <div className="chart-bar">
            <span className="chart-cap">{chart.valueCol} by {chart.labelCol}</span>
            <div className="chart-tools">
              <div className="chart-types">
                {["bar", "line", "pie"].map((t) => (
                  <button key={t} className={type === t ? "on" : ""} onClick={() => setCtype(t)}>{t}</button>
                ))}
              </div>
              <button className="chart-save" onClick={() => saveChartJpeg(chartRef.current && chartRef.current.querySelector("svg"), `${chart.valueCol}-by-${chart.labelCol}.jpg`)}>Save JPEG</button>
            </div>
          </div>
          {type === "line" ? <LineChart data={chart} /> : type === "pie" ? <PieChart data={chart} /> : <BarChart data={chart} />}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="rt">
            <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={columns.length || 1}><div className="empty-rows">No rows matched.</div></td></tr>
              ) : (
                rows.map((r, ri) => (
                  <tr key={ri}>{r.map((v, ci) => { const f = fmtCell(v, columns[ci]); return <td key={ci} className={f.cls}>{f.text}</td>; })}</tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Browse the actual rows of a table (real data, queried locally, no model needed).
// Shows that the app works on a real database you can query.
function DataBrowser({ schema, counts, active, onPick, result }) {
  return (
    <div className="data-view">
      <div className="data-picker">
        {schema.map((t) => (
          <button
            key={t.table}
            className={"data-tab" + (active === t.table ? " on" : "")}
            onClick={() => onPick(t.table)}
          >
            <IconTable size={14} />
            <span className="dt-name">{t.table}</span>
            <span className="dt-count">{counts[t.table] ?? 0}</span>
          </button>
        ))}
      </div>
      {result
        ? <ResultView result={result} />
        : <div className="data-empty">Select a table to browse its rows.</div>}
    </div>
  );
}

Object.assign(window, {
  IconShield, IconLock, IconTable, IconTri, IconCopy, IconKey, IconSpark,
  IconCode, IconWarn, IconNoEdit, IconInfo, IconSend, IconPlay, IconCpu,
  Sidebar, ModelBanner, PlanPanels, Notice, ResultsTable, ResultView, DataBrowser, fmtCell,
  BarChart, LineChart, PieChart, inferChart,
});
