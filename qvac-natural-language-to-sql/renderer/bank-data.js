/* ============================================================
   QVAC Natural Language to SQL, sample dataset + schema
   An in-memory bank database with 5 tables, seeded into SQLite
   (sql.js) entirely on-device. Nothing here ever leaves the machine.
   "Today" for this demo is 2026-06-08.

   The rows are GENERATED deterministically (seeded RNG) so the data is
   stable across reloads but large enough for rich charts/aggregations.
   Approx counts: customers 75 · accounts 102 · transactions 305 · loans 60 · audit_log 180.
   ============================================================ */

window.BANK_SCHEMA = [
  {
    table: "customers",
    columns: [
      { name: "id",           type: "INTEGER", note: "primary key" },
      { name: "name",         type: "TEXT" },
      { name: "city",         type: "TEXT",    note: "Frankfurt · Berlin · Munich · Hamburg · Cologne · Stuttgart · Düsseldorf · Leipzig" },
      { name: "age",          type: "INTEGER" },
      { name: "last_updated", type: "DATE",    note: "YYYY-MM-DD; last KYC refresh" },
    ],
  },
  {
    table: "accounts",
    columns: [
      { name: "id",          type: "INTEGER", note: "primary key" },
      { name: "customer_id", type: "INTEGER", note: "→ customers.id" },
      { name: "type",        type: "TEXT",    note: "checking | savings" },
      { name: "balance",     type: "REAL",    note: "EUR, current cleared balance" },
      { name: "debt",        type: "REAL",    note: "EUR, outstanding owed" },
    ],
  },
  {
    table: "transactions",
    columns: [
      { name: "id",         type: "INTEGER", note: "primary key" },
      { name: "account_id", type: "INTEGER", note: "→ accounts.id" },
      { name: "amount",     type: "REAL",    note: "EUR; negative = withdrawal / debit" },
      { name: "type",       type: "TEXT",    note: "deposit | withdrawal | transfer | fee" },
      { name: "date",       type: "DATE",    note: "YYYY-MM-DD" },
    ],
  },
  {
    table: "loans",
    columns: [
      { name: "id",              type: "INTEGER", note: "primary key" },
      { name: "account_id",      type: "INTEGER", note: "→ accounts.id" },
      { name: "type",            type: "TEXT",    note: "mortgage | personal | auto" },
      { name: "principal",       type: "REAL",    note: "EUR, original loan amount" },
      { name: "interest_rate",   type: "REAL",    note: "annual %, e.g. 4.5" },
      { name: "monthly_payment", type: "REAL",    note: "EUR" },
      { name: "due_date",        type: "DATE",    note: "next payment due" },
      { name: "status",          type: "TEXT",    note: "active | overdue | paid_off" },
    ],
  },
  {
    table: "audit_log",
    columns: [
      { name: "id",         type: "INTEGER", note: "primary key" },
      { name: "account_id", type: "INTEGER", note: "→ accounts.id; NULL for system events" },
      { name: "event_type", type: "TEXT",    note: "login | export | admin_override | suspicious_activity | limit_exceeded" },
      { name: "details",    type: "TEXT",    note: "human-readable event description" },
      { name: "created_at", type: "DATETIME",note: "YYYY-MM-DD HH:MM:SS" },
    ],
  },
];

window.BANK_SEED_SQL = (function () {
  // Deterministic PRNG (LCG) → the dataset is identical on every load.
  let _s = 20260608;
  const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const money = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  const chance = (p) => rnd() < p;
  const q = (v) => v === null ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'";
  const pad = (n) => String(n).padStart(2, "0");
  const dateIn = (y0, m0, y1, m1) => {
    const y = ri(y0, y1);
    const m = ri(1, 12);
    return `${y}-${pad(m)}-${pad(ri(1, 28))}`;
  };
  const date2026 = () => `2026-${pad(ri(1, 6))}-${pad(ri(1, 28))}`;
  const dt2026 = () => `2026-${pad(ri(1, 6))}-${pad(ri(1, 28))} ${pad(ri(6, 22))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}`;

  const FIRST = ["Lukas","Anna","Felix","Sophie","Maximilian","Marie","Paul","Laura","Jonas","Emma","Leon","Hannah","Elias","Mia","Noah","Lena","Tom","Julia","Markus","Sarah","Michael","Katharina","Stefan","Petra","Andreas","Nina","David","Clara","Jan","Lisa","Tobias","Greta","Niklas","Johanna","Florian","Melanie","Sebastian","Vanessa","Daniel","Theresa"];
  const LAST = ["Müller","Schmidt","Weber","Becker","Fischer","Hoffmann","Wagner","Schulz","Koch","Richter","Bauer","Klein","Wolf","Neumann","Schwarz","Zimmermann","Krüger","Braun","Hartmann","Lange","Vogt","Roth","Schäfer","Huber","Lehmann","Gruber","Frank","Berger","Kaiser","Peters"];
  const CITIES = ["Frankfurt","Berlin","Munich","Hamburg","Cologne","Stuttgart","Düsseldorf","Leipzig"];
  const CITY_W = ["Frankfurt","Frankfurt","Berlin","Berlin","Berlin","Munich","Munich","Hamburg","Hamburg","Cologne","Stuttgart","Düsseldorf","Leipzig"]; // weighted

  // ---- customers ----
  const N_CUST = 75;
  const customers = [];
  for (let id = 1; id <= N_CUST; id++) {
    customers.push([id, `${pick(FIRST)} ${pick(LAST)}`, pick(CITY_W), ri(21, 78), dateIn(2023, 1, 2026, 6)]);
  }

  // ---- accounts (1-2 per customer) ----
  const accounts = [];
  let aid = 0;
  for (const c of customers) {
    const n = chance(0.28) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      aid++;
      const hasDebt = chance(0.45);
      accounts.push([aid, c[0], pick(["checking", "checking", "savings"]), money(80, 62000), hasDebt ? money(500, 82000) : 0]);
    }
  }

  // ---- transactions (2-4 per account) ----
  const transactions = [];
  let tid = 0;
  for (const a of accounts) {
    const n = ri(2, 4);
    for (let k = 0; k < n; k++) {
      tid++;
      const kind = pick(["deposit", "deposit", "withdrawal", "withdrawal", "transfer", "fee"]);
      let amt;
      if (kind === "deposit") amt = money(120, 16000);
      else if (kind === "fee") amt = -money(20, 320);
      else amt = -money(80, 9000);
      transactions.push([tid, a[0], amt, kind, date2026()]);
    }
  }

  // ---- loans (~60 accounts get one) ----
  const loans = [];
  const shuffled = accounts.map((a) => a[0]).sort(() => rnd() - 0.5).slice(0, 60);
  let lid = 0;
  for (const accId of shuffled) {
    lid++;
    const type = pick(["mortgage", "personal", "auto", "personal", "auto"]);
    let principal, rate;
    if (type === "mortgage") { principal = money(150000, 360000); rate = Math.round((3 + rnd() * 2) * 10) / 10; }
    else if (type === "auto") { principal = money(8000, 26000); rate = Math.round((4.5 + rnd() * 2.5) * 10) / 10; }
    else { principal = money(10000, 62000); rate = Math.round((6.5 + rnd() * 3.5) * 10) / 10; }
    const monthly = Math.round((principal * (rate / 100) / 12 + principal / (type === "mortgage" ? 300 : 60)) * 100) / 100;
    const status = pick(["active", "active", "active", "overdue", "overdue", "paid_off"]);
    loans.push([lid, accId, type, principal, rate, monthly, date2026(), status]);
  }

  // ---- audit_log (~180) ----
  const EVENTS = ["login", "login", "login", "export", "admin_override", "suspicious_activity", "limit_exceeded"];
  const DETAILS = {
    login: () => `Customer portal login from IP ${ri(31, 212)}.${ri(0, 255)}.${ri(0, 255)}.${ri(1, 254)}`,
    export: () => pick(["Account statement exported (PDF, 3 months)", "Transaction history exported (CSV, 12 months)", "Loan repayment schedule exported (PDF)", "Interest statement exported for tax year 2025"]),
    admin_override: () => pick(["Account limit temporarily raised by ops team", "Fraud hold placed by compliance team", "Debt restructuring plan initiated", "Overdraft limit raised by branch manager"]),
    suspicious_activity: () => pick(["Withdrawal far above 30-day average", "Multiple fee charges in 48 hours", "Large deposit followed by same-day transfer", "IP geolocation mismatch on login", "Balance near zero with pending outgoing transfers"]),
    limit_exceeded: () => pick(["Transaction rejected: daily limit reached", "Overdraft protection triggered", "Fee rejected: insufficient balance", "Auto late-fee applied to overdue loan"]),
  };
  const audit = [];
  for (let id = 1; id <= 180; id++) {
    const ev = pick(EVENTS);
    const sys = ev === "admin_override" && chance(0.25);
    const accId = sys ? null : pick(accounts)[0];
    audit.push([id, accId, ev, DETAILS[ev](), dt2026()]);
  }

  // ---- assemble SQL ----
  const ddl = `
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, age INTEGER NOT NULL, last_updated DATE NOT NULL);
CREATE TABLE accounts (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'checking', balance REAL NOT NULL, debt REAL NOT NULL);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL DEFAULT 'deposit', date DATE NOT NULL);
CREATE TABLE loans (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, type TEXT NOT NULL, principal REAL NOT NULL, interest_rate REAL NOT NULL, monthly_payment REAL NOT NULL, due_date DATE NOT NULL, status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, account_id INTEGER, event_type TEXT NOT NULL, details TEXT NOT NULL, created_at DATETIME NOT NULL);
`;
  const rows = (arr) => arr.map((r) => "(" + r.map((v) => v === null ? "NULL" : (typeof v === "number" ? v : q(v))).join(",") + ")").join(",\n");
  return ddl
    + "INSERT INTO customers VALUES\n" + rows(customers) + ";\n"
    + "INSERT INTO accounts VALUES\n" + rows(accounts) + ";\n"
    + "INSERT INTO transactions VALUES\n" + rows(transactions) + ";\n"
    + "INSERT INTO loans VALUES\n" + rows(loans) + ";\n"
    + "INSERT INTO audit_log VALUES\n" + rows(audit) + ";\n";
})();
