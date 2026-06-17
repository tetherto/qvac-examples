/* ============================================================
   QVAC Natural Language to SQL — icons + presentational components
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
        <div className="summary-body">{plan.explanation || "—"}</div>
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

Object.assign(window, {
  IconShield, IconLock, IconTable, IconTri, IconCopy, IconKey, IconSpark,
  IconCode, IconWarn, IconNoEdit, IconInfo, IconSend, IconPlay, IconCpu,
  Sidebar, ModelBanner, PlanPanels, Notice, ResultsTable, fmtCell,
});
