/* ============================================================
   QVAC Natural Language to SQL, local SQLite engine (sql.js / WebAssembly)
   The database lives entirely in memory, in this process.
   Queries execute on-device. No network, no server, ever.
   ============================================================ */

window.QVACdb = (function () {
  let db = null;

  // Statements that mutate data. QVAC Natural Language to SQL is strictly read-only.
  const FORBIDDEN = /\b(DELETE|DROP|UPDATE|INSERT|ALTER|TRUNCATE|REPLACE|CREATE|ATTACH|PRAGMA|VACUUM)\b/i;

  async function init() {
    // The WASM is vendored locally and served from the 127.0.0.1 static
    // server (window.QVAC_LOCAL_WASM is wired in index.html). No CDN, ever.
    const SQL = await initSqlJs({
      locateFile: (file) => window.QVAC_LOCAL_WASM(file),
    });
    db = new SQL.Database();
    db.run(window.BANK_SEED_SQL);
    return true;
  }

  function guard(sql) {
    if (FORBIDDEN.test(sql)) {
      const err = new Error(
        "QVAC Natural Language to SQL is read-only. Queries that modify data are blocked."
      );
      err.code = "READ_ONLY";
      throw err;
    }
  }

  function run(sql) {
    if (!db) throw new Error("Database not ready yet.");
    guard(sql);
    const res = db.exec(sql);
    if (!res.length) return { columns: [], rows: [] };
    const { columns, values } = res[0];
    return { columns, rows: values };
  }

  function liveSchema() {
    if (!db) return [];
    const out = run(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    return out.rows.map((r) => r[0]);
  }

  function rowCount(table) {
    try {
      return run(`SELECT COUNT(*) FROM ${table}`).rows[0][0];
    } catch {
      return 0;
    }
  }

  return { init, run, guard, liveSchema, rowCount, isReady: () => !!db };
})();
