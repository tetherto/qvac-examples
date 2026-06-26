// Recipe-dashboard launcher shim for Coffee CONVERSATION (SDK 0.13.5).
// The dashboard discovers test/NN-name/server.js, parses `PORT = process.env.PORT || N`, and
// spawns `node server.js`. This recipe runs under BUN with two servers (the coffee shop API +
// the full-duplex conversation UI). This shim applies the on-disk TTS language patch, then
// launches both under bun. The conversation UI binds PORT (what the dashboard opens).
// NOTE: fresh ports (3461/3462) so this never clashes with the 09-coffee-demo-v2 fallback.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = process.env.PORT || 3461;          // conversation UI (dashboard opens this)
const API_PORT = process.env.API_PORT || 3462;  // coffee shop API
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "qvac-coffee-assistant");
const BUN = process.env.BUN_BIN || path.join(process.env.HOME || "", ".bun", "bin", "bun");

// 1) unlock all TTS languages on disk BEFORE the SDK is imported (idempotent; npm/bun install reverts it)
spawnSync("node", ["patch-sdk.mjs"], { cwd: APP, stdio: "inherit" });

// 2) launch the coffee shop API (no SDK; menu + orders + payments) and the conversation UI under bun
const baseEnv = { ...process.env, PORT: String(PORT), COFFEE_SHOP_API_PORT: String(API_PORT), COFFEE_SHOP_API_URL: `http://localhost:${API_PORT}` };
const api = spawn(BUN, ["run", "coffee-shop-api/server.ts"], { cwd: APP, env: { ...baseEnv, PORT: String(API_PORT) }, stdio: "inherit" });
const ui = spawn(BUN, ["run", "examples/agent-ui-server.ts"], { cwd: APP, env: baseEnv, stdio: "inherit" });

const stop = () => { for (const c of [api, ui]) { try { c.kill("SIGTERM"); } catch {} } process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (const c of [api, ui]) c.on("exit", (code) => { if (code) console.error(`[coffee-conversation] ${c === api ? "api" : "ui"} exited ${code}`); });
console.log(`[coffee-conversation] conversation UI on :${PORT}, API on :${API_PORT} (bun)`);
