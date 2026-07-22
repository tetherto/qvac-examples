/* ============================================================
   Build step, make the app 100% local.

   1. Vendor the front-end libraries (sql.js WASM, React, React-DOM)
      from node_modules into renderer/vendor/ so nothing loads from a CDN.
   2. Pre-transpile the JSX to plain JS so the browser never runs Babel.

   Runs automatically via `prestart` (so `npm start` always builds first),
   or on demand with `npm run build`. Output is gitignored.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const ROOT = path.join(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const RENDERER = path.join(ROOT, "renderer");
const VENDOR = path.join(RENDERER, "vendor");

// Third-party assets to copy verbatim into renderer/vendor/.
// Production React builds only, never the development builds.
const VENDORED = [
  ["sql.js/dist/sql-wasm.js", "sql-wasm.js"],
  ["sql.js/dist/sql-wasm.wasm", "sql-wasm.wasm"],
  ["react/umd/react.production.min.js", "react.production.min.js"],
  ["react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"],
];

// JSX sources transpiled in place to sibling .js files (classic runtime,
// so the output keeps using the global React/ReactDOM the vendored UMD
// builds expose, no bundler, no module system).
const JSX = ["components.jsx", "app.jsx"];

function vendor() {
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const [from, to] of VENDORED) {
    fs.copyFileSync(path.join(NODE_MODULES, from), path.join(VENDOR, to));
    console.log(`  vendored  vendor/${to}`);
  }
}

function transpile() {
  for (const file of JSX) {
    const src = path.join(RENDERER, file);
    const { code } = babel.transformFileSync(src, {
      presets: [["@babel/preset-react", { runtime: "classic" }]],
    });
    const out = file.replace(/\.jsx$/, ".js");
    fs.writeFileSync(path.join(RENDERER, out), code);
    console.log(`  transpiled ${out}`);
  }
}

console.log("Building renderer (vendoring libs + transpiling JSX)…");
vendor();
transpile();
console.log("Done. Everything loads locally; no CDN at runtime.");
