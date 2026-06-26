import { spawn } from "node:child_process";
import fs from "node:fs";
const PORT = 3461;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const srv = spawn(process.env.HOME + "/.bun/bin/bun", ["run", "examples/conversation-server.ts"],
  { env: { ...process.env, PORT: String(PORT), COFFEE_SHOP_API_URL: "http://localhost:3462" }, stdio: ["ignore","pipe","pipe"] });
let booted = false;
srv.stdout.on("data", d => { const s=String(d); if (s.includes("Coffee Conversation") || s.includes("ws://")) booted = true; });
srv.stderr.on("data", () => {});
const got = { ready:0, user:[], agent:[], audioFrames:0, audioBytes:0, errors:[] };
try {
  for (let i=0;i<240 && !booted;i++) await sleep(1000);
  if (!booted) throw new Error("server did not boot in 240s");
  log("server booted, connecting WS...");
  await sleep(500);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.binaryType = "arraybuffer";
  ws.addEventListener("message", (e) => {
    if (typeof e.data !== "string") { got.audioFrames++; got.audioBytes += e.data.byteLength; return; }
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type==="ready") got.ready++;
    else if (m.type==="user") { got.user.push(m); log("  USER:", m.lang, JSON.stringify(m.text)); }
    else if (m.type==="agent") { got.agent.push(m); log("  AGENT:", m.lang, JSON.stringify(m.text).slice(0,80)); }
    else if (m.type==="error") { got.errors.push(m.message); log("  ERR:", m.message); }
    else if (m.type==="state") log("  state:", m.state);
  });
  await new Promise((r,j)=>{ ws.onopen=r; ws.onerror=()=>j(new Error("ws error")); });
  log("WS open. waiting for ready + greeting...");
  for (let i=0;i<120 && got.ready===0;i++) await sleep(500);
  log("ready=" + got.ready + ". greeting audio frames so far:", got.audioFrames);
  // wait for greeting audio to finish
  await sleep(4000);
  const greetFrames = got.audioFrames;
  log("greeting done. frames:", greetFrames, "bytes:", got.audioBytes);
  // stream a French utterance
  log("streaming FR utterance...");
  const f32 = fs.readFileSync("/tmp/pk/fr.f32");
  const CH = 6400;
  for (let i=0;i<f32.length;i+=CH){ ws.send(f32.buffer.slice(f32.byteOffset+i, f32.byteOffset+Math.min(i+CH,f32.length))); await sleep(12); }
  const sil = new ArrayBuffer(6400);
  for (let i=0;i<25;i++){ ws.send(sil); await sleep(12); }
  // wait for the turn to complete (STT -> translate -> agent -> TTS)
  for (let i=0;i<120 && got.agent.length<2;i++) await sleep(1000);
  await sleep(2000);
  ws.close();
  log("\n=== RESULTS ===");
  log("ready:", got.ready);
  log("user utterances:", got.user.length, got.user.map(u=>`${u.lang}:"${u.text.slice(0,30)}"`));
  log("agent replies:", got.agent.length);
  log("total audio frames:", got.audioFrames, "bytes:", got.audioBytes, "(greeting:", greetFrames, ")");
  log("errors:", got.errors.length, got.errors.slice(0,3));
  const okGreeting = got.ready>0 && greetFrames>0;
  const okUtterance = got.user.length>=1 && got.user[0].lang==="fr";
  const okReply = got.agent.length>=2;          // greeting + reply
  const okAudio = got.audioFrames > greetFrames; // reply produced audio too
  log("\nGREETING (load+TTS+WS):", okGreeting);
  log("UTTERANCE (STT+langID):", okUtterance);
  log("AGENT REPLY:", okReply);
  log("REPLY AUDIO (TTS):", okAudio);
  log("\nE2E:", okGreeting && okUtterance && okReply ? "PASS" : "PARTIAL/FAIL");
} catch (e) { log("E2E ERROR:", e.message); }
finally { try { srv.kill("SIGTERM"); } catch {} await sleep(800); process.exit(0); }
