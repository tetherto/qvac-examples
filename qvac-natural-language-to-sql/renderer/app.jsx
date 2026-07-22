/* ============================================================
   QVAC Natural Language to SQL - application root + state
   Everything is React state. No <form>. No routing. No login.
   Local AI: Qwen3 4B runs in Electron main process via @qvac/sdk.
   ============================================================ */
const { useState, useEffect, useRef, useCallback } = React;

const EXAMPLES = [
  "Top 3 clients in Frankfurt with the biggest debt",
  "Show all overdue loans with the customer name and monthly payment",
];

let HID = 0;

function App() {
  const [booting, setBooting] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState({});

  // Local model loading state (managed by main process)
  const [modelStatus, setModelStatus] = useState(
    window.QVAC_BRIDGE
      ? { state: "loading", progress: 0, label: "Starting local model…" }
      : { state: "error", progress: 0, label: "Local model unavailable" }
  );
  const modelReady = modelStatus.state === "ready" || modelStatus.state === "error";

  const [question, setQuestion] = useState("");
  const [technical, setTechnical] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState(null);
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [wantChart, setWantChart] = useState(false);  // question asked for a graph -> open results as a chart

  // Browse-data view: show the actual rows of a table (runs locally, no model needed).
  const [view, setView] = useState("ask");        // "ask" | "data"
  const [dataTable, setDataTable] = useState(null);
  const [dataResult, setDataResult] = useState(null);
  const browseTable = useCallback((t) => {
    try { setDataResult(window.QVACdb.run(`SELECT * FROM ${t} LIMIT 200`)); }
    catch (e) { setDataResult({ columns: [], rows: [] }); }
    setDataTable(t);
  }, []);
  const openData = useCallback(() => {
    setView("data");
    if (!dataTable && window.QVACdb.isReady()) browseTable(window.BANK_SCHEMA[0].table);
  }, [dataTable, browseTable]);

  const taRef = useRef(null);

  const refreshCounts = useCallback(() => {
    const c = {};
    window.BANK_SCHEMA.forEach((t) => { c[t.table] = window.QVACdb.rowCount(t.table); });
    setCounts(c);
  }, []);

  // Boot the local SQLite engine once.
  useEffect(() => {
    let alive = true;
    window.QVACdb.init()
      .then(() => {
        if (!alive) return;
        setLoaded(true);
        refreshCounts();
        setBooting(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError({ kind: "error", msg: "Could not start the local database engine. " + e.message });
        setBooting(false);
      });
    return () => { alive = false; };
  }, [refreshCounts]);

  // Subscribe to model loading progress from the main process.
  useEffect(() => {
    if (!window.QVAC_BRIDGE || !window.QVAC_BRIDGE.onModelProgress) return;

    // Get current status immediately (in case model loaded before renderer)
    window.QVAC_BRIDGE.getModelStatus().then((s) => {
      if (s) setModelStatus(s);
    }).catch(() => {});

    // Subscribe to future updates
    window.QVAC_BRIDGE.onModelProgress((s) => {
      setModelStatus(s);
    });
  }, []);

  const reloadSchema = () => {
    window.QVACdb.init().then(() => { setLoaded(true); refreshCounts(); });
  };

  const resetOutputs = () => { setPlan(null); setSql(""); setResult(null); setError(null); };

  const ask = async (qArg) => {
    const q = (qArg ?? question).trim();
    if (!q || generating) return;
    if (!modelReady && modelStatus.state !== "error") {
      setError({ kind: "error", msg: "The local model is still loading. Please wait a moment." });
      return;
    }
    setQuestion(q);
    resetOutputs();
    setWantChart(/\b(chart|graph|plot|visuali[sz]e|bar chart|pie chart|line chart|trend|histogram|distribution|breakdown)\b/i.test(q));
    setGenerating(true);
    try {
      const out = await window.QVACai.generate(window.BANK_SCHEMA, q);
      try {
        window.QVACdb.guard(out.sql);
      } catch (guardErr) {
        setError({ kind: "block", msg: "QVAC Natural Language to SQL is read-only. Only SELECT queries are allowed." });
        return;
      }
      setPlan({ explanation: out.explanation });
      setSql(out.sql);
      setHistory((h) => [{ id: ++HID, question: q, sql: out.sql, explanation: out.explanation }, ...h].slice(0, 30));
    } catch (e) {
      setError({ kind: "error", msg: e.message || "The model could not generate a query." });
    } finally {
      setGenerating(false);
    }
  };

  const run = (sqlArg) => {
    const q = (sqlArg ?? sql).trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setTimeout(() => {
      try {
        const res = window.QVACdb.run(q);
        setResult(res);
      } catch (e) {
        if (e.code === "READ_ONLY") {
          setError({ kind: "block", msg: e.message });
        } else {
          setError({ kind: "error", msg: "That query could not run: " + e.message });
        }
      } finally {
        setRunning(false);
      }
    }, 260);
  };

  const pickHistory = (h) => {
    setQuestion(h.question);
    setPlan({ explanation: h.explanation });
    setSql(h.sql);
    setError(null);
    run(h.sql);
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
  };

  const askDisabled = !question.trim() || generating || (!modelReady && modelStatus.state !== "error");

  if (booting) {
    return (
      <div className="boot">
        <img src="assets/logo.svg" alt="qvac" />
        <div className="spin" />
        <div className="bt">Starting local database engine…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        schema={window.BANK_SCHEMA}
        counts={counts}
        loaded={loaded}
        onLoadDemo={reloadSchema}
        history={history}
        onPickHistory={pickHistory}
      />

      <main className="main">
        <div className="topbar">
          <IconShield size={18} style={{ color: "var(--qvac-green)" }} />
          <span className="top-title">QVAC Natural Language to SQL: Ask your data</span>
          <span className="top-reassure">
            <IconLock size={14} />
            Your schema, queries &amp; results never leave this device
          </span>
        </div>

        <ModelBanner status={modelStatus} />

        <div className="scroll">
          <div className="canvas">
            <div className="view-tabs">
              <button className={"vtab" + (view === "ask" ? " on" : "")} onClick={() => setView("ask")}>Ask</button>
              <button className={"vtab" + (view === "data" ? " on" : "")} onClick={openData}>Browse data</button>
            </div>

            {view === "ask" ? (
            <React.Fragment>
            <div className="ask-box">
              <textarea
                ref={taRef}
                value={question}
                placeholder="Ask your data anything…  e.g. Which customers in Munich owe the most?"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onKey}
                rows={2}
              />
              <button className="btn-ask" onClick={() => ask()} disabled={askDisabled}>
                <IconSend size={15} />
                {!modelReady && modelStatus.state !== "error" ? "Loading model…" : "Ask"}
              </button>
            </div>

            <div className="chips">
              <span className="chip-lead">Try</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => ask(ex)}
                  disabled={!modelReady && modelStatus.state !== "error"}>
                  {ex}
                </button>
              ))}
            </div>

            <div className="tech-row">
              <span className="switch" role="switch" aria-checked={technical} onClick={() => setTechnical((v) => !v)}>
                <span className="track" style={{
                  background: technical ? "rgba(22,227,193,0.2)" : "#252728",
                  borderColor: technical ? "var(--qvac-green)" : "var(--qvac-border)",
                }}>
                  <span className="thumb" style={{
                    transform: technical ? "translateX(18px)" : "translateX(0)",
                    background: technical ? "var(--qvac-green)" : "#8a8c8d",
                  }} />
                </span>
              </span>
              <div className="tech-label">
                <span className="t1">I'm technical: show &amp; edit the SQL</span>
                <span className="t2">
                  {technical
                    ? "The generated query is shown below and you can tweak it before running."
                    : "Off: you'll see a plain-English summary of what the query does."}
                </span>
              </div>
            </div>

            {generating && (
              <div className="loading">
                <span className="spin" />
                <span className="lt">
                  <b>QVAC</b> is translating your question into SQL…
                </span>
              </div>
            )}

            {plan && !generating && (
              <PlanPanels plan={plan} technical={technical} sql={sql} onSqlChange={setSql} />
            )}

            {plan && !generating && (
              <div className="run-row">
                <button className="btn-run" onClick={() => run()} disabled={running || !sql.trim()}>
                  <IconPlay size={14} /> {running ? "Running…" : "Run query"}
                </button>
                <span className="run-hint">Executes locally · read-only</span>
              </div>
            )}

            {error && (
              <Notice kind={error.kind}>
                {error.kind === "block"
                  ? <span><b>Blocked.</b> {error.msg}</span>
                  : error.msg}
              </Notice>
            )}

            {result && !error && <ResultView result={result} defaultChart={wantChart} />}

            <div className="demo-note">
              <IconInfo size={14} />
              <p>
                <b>An example, not a Tether product.</b> This is an open-source demonstration of the
                QVAC SDK, provided as-is with no warranty or support. The bank and all of its data are
                fictional. The local AI writes the SQL and can get it wrong, so read the query before
                you trust any result. Nothing here is financial advice. Everything runs on-device.
              </p>
            </div>
            </React.Fragment>
            ) : (
              <DataBrowser schema={window.BANK_SCHEMA} counts={counts}
                active={dataTable} onPick={browseTable} result={dataResult} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
