// Coffee Conversation Server - full-duplex voice on QVAC SDK 0.13.5.
//
// What's new vs the push-to-talk demo (examples/agent-ui-server.ts, kept as the fallback):
//   - ONE multilingual STT (Whisper large-v3-turbo + Silero VAD, detect_language) -> no
//     "choose your language" step. VAD segments turns automatically; the streaming session
//     yields one finalized utterance per turn (see the SDK's examples/voice-assistant).
//   - Conversation loop: utterance -> language-ID -> translate X->EN -> CoffeeAgent (EN)
//     -> translate EN->X -> Chatterbox multilingual TTS (tts-ggml 0.2.5, EOS fix) -> stream.
//   - Barge-in: the browser keeps its mic open (echo-cancelled) during playback; on detected
//     speech it stops playback locally and sends {type:"barge"}, and the server cancels the
//     in-flight TTS + LLM and re-opens the mic. A half-duplex mic-gate is the reliable baseline.
//
// 100% on-device. Reuses the coffee agent brain (menu / order / payment tools) unchanged.

import {
  loadModel, unloadModel, transcribeStream, translate, textToSpeech, cancel,
  WHISPER_LARGE_V3_TURBO, VAD_SILERO_5_1_2, QWEN3_4B_INST_Q4_K_M,
  TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0, TTS_S3GEN_MULTILINGUAL_CHATTERBOX,
  BERGAMOT_ES_EN, BERGAMOT_EN_ES, BERGAMOT_FR_EN, BERGAMOT_EN_FR,
  BERGAMOT_DE_EN, BERGAMOT_EN_DE, BERGAMOT_IT_EN, BERGAMOT_EN_IT,
  BERGAMOT_PT_EN, BERGAMOT_EN_PT,
} from "@qvac/sdk";
import { join } from "path";
import { randomUUID } from "crypto";
import { CoffeeAgent } from "../agent";
import { getTetherWDK } from "../tether-wdk";
import { detectLang, type DetectedLang } from "./lang-id";

// ── config ──
const PORT = parseInt(process.env.PORT || "3461");
const COFFEE_API = process.env.COFFEE_SHOP_API_URL || "http://localhost:3457";
const REFERENCE_AUDIO = join(import.meta.dir, "..", "assets", "default-voice.16k.wav");
const TTS_SR = 24000;
// Output voice is gated by Chatterbox; en/es/de/it are first-class, fr/pt via the language patch.
const TTS_OK: DetectedLang[] = ["en", "es", "de", "it", "fr", "pt"];
const SUPPORTED: DetectedLang[] = ["en", "es", "fr", "de", "it", "pt"];
const GREETING_EN = "Hi! Welcome to the coffee shop. What can I get you?";

const BERGAMOT: Record<string, unknown> = {
  "es|en": BERGAMOT_ES_EN, "en|es": BERGAMOT_EN_ES, "fr|en": BERGAMOT_FR_EN, "en|fr": BERGAMOT_EN_FR,
  "de|en": BERGAMOT_DE_EN, "en|de": BERGAMOT_EN_DE, "it|en": BERGAMOT_IT_EN, "en|it": BERGAMOT_EN_IT,
  "pt|en": BERGAMOT_PT_EN, "en|pt": BERGAMOT_EN_PT,
};

// ── shared models (loaded once) ──
let sttId: string | null = null;
let llmId: string | null = null;
const ttsByLang = new Map<string, string>();   // lang -> Chatterbox modelId (LRU)
const TTS_LRU_MAX = 2;
const nmtCache = new Map<string, string>();     // "from|to" -> nmt modelId

async function loadShared() {
  if (!sttId) {
    console.log("[conv] loading Whisper large-v3-turbo + Silero VAD (multilingual, auto-language)...");
    sttId = await loadModel({
      modelSrc: WHISPER_LARGE_V3_TURBO,
      modelType: "whisper",                 // REQUIRED: routes modelConfig to the whisper plugin
      modelConfig: {                        // (without it, `language` defaults to 'en' and detect_language throws)
        vadModelSrc: VAD_SILERO_5_1_2, audio_format: "f32le",
        language: "auto", detect_language: true,
        strategy: "greedy", n_threads: 4,
        no_timestamps: true, suppress_blank: true, temperature: 0.0,
      },
    });
  }
  if (!llmId) {
    console.log("[conv] loading Qwen3 4B (agent brain)...");
    llmId = await loadModel({ modelSrc: QWEN3_4B_INST_Q4_K_M, modelConfig: { ctx_size: 16384 } });
  }
  console.log("[conv] shared models ready.");
}

async function ensureTts(lang: string): Promise<string> {
  const key = TTS_OK.includes(lang as DetectedLang) ? lang : "en";
  const have = ttsByLang.get(key);
  if (have) return have;
  console.log(`[conv] loading Chatterbox TTS (${key})...`);
  const id = await loadModel({
    modelSrc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0.src,
    modelType: "tts",
    modelConfig: {
      ttsEngine: "chatterbox", language: key,
      s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX.src,
      referenceAudioSrc: REFERENCE_AUDIO, useGPU: true,
    },
  });
  ttsByLang.set(key, id);
  while (ttsByLang.size > TTS_LRU_MAX) {
    const oldKey = ttsByLang.keys().next().value as string;
    const oldId = ttsByLang.get(oldKey)!;
    ttsByLang.delete(oldKey);
    await unloadModel({ modelId: oldId, clearStorage: false }).catch(() => {});
  }
  return id;
}

const NO_TRANSLATE = /\b(satoshis?|sats?|usdt|usdc|btc|eth)\b/gi;
async function ensureNmt(from: string, to: string): Promise<string | null> {
  if (from === to) return null;
  const key = `${from}|${to}`;
  if (nmtCache.has(key)) return nmtCache.get(key)!;
  const src = BERGAMOT[key];
  if (!src) return null;
  const id = await loadModel({ modelSrc: src as any, modelType: "nmt", modelConfig: { engine: "Bergamot", from, to } });
  nmtCache.set(key, id);
  return id;
}
async function translateText(from: string, to: string, text: string): Promise<string> {
  if (from === to || !text.trim()) return text;
  try {
    const id = await ensureNmt(from, to);
    if (!id) return text;
    const saved: string[] = [];
    const masked = text.replace(NO_TRANSLATE, (m) => ` ZZQ${saved.push(m) - 1}ZZQ `);
    const tr = translate({ modelId: id, text: masked, modelType: "nmt", stream: false });
    let out = String(await tr.text).trim().replace(/^\s*>>[a-z]{2,3}<<\s*/i, "").trim();
    out = out.replace(/ZZQ\s*(\d+)\s*ZZQ/gi, (_, i) => saved[Number(i)] ?? "");
    out = out.replace(/\s+([.,!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
    return out || text;
  } catch (e) {
    console.error(`[conv] translate ${from}->${to} failed:`, (e as Error)?.message);
    return text;
  }
}

function wavHeader(dataLen: number, sr: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + dataLen, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(dataLen, 40);
  return h;
}

// ── per-connection conversation ──
interface Conn {
  ws: any;
  agent: CoffeeAgent;
  session: any;            // transcribeStream session
  isSpeaking: boolean;     // agent is talking -> gate the mic (half-duplex baseline)
  fullDuplex: boolean;     // if true, keep feeding mic during playback (browser AEC + barge)
  ttsReqId: string | null; // in-flight TTS request, for cancel()
  turnSeq: number;         // bumped on barge to abandon a stale turn
  closed: boolean;
}
const conns = new WeakMap<any, Conn>();

const send = (ws: any, obj: any) => { try { ws.send(JSON.stringify(obj)); } catch {} };

async function speak(conn: Conn, text: string, lang: string, seq: number) {
  if (!text.trim() || conn.closed) return;
  const ttsId = await ensureTts(lang);
  if (conn.turnSeq !== seq) return; // barged while loading
  const reqId = randomUUID();
  conn.ttsReqId = reqId;
  conn.isSpeaking = true;
  send(conn.ws, { type: "state", state: "speaking" });
  send(conn.ws, { type: "audio.start", sampleRate: TTS_SR });
  try {
    const out = textToSpeech({
      modelId: ttsId, text, inputType: "text", requestId: reqId,
      stream: true, sentenceStream: true, sentenceStreamMaxChunkScalars: 80,
    } as any);
    const buf: number[] = [];
    for await (const s of out.bufferStream) {
      if (conn.turnSeq !== seq || conn.closed) break;   // barge-in: stop sending
      buf.push(s);
      if (buf.length >= 4800) { // ~200ms
        const arr = Int16Array.from(buf.splice(0, buf.length));
        conn.ws.send(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
      }
    }
    if (buf.length && conn.turnSeq === seq && !conn.closed) {
      const arr = Int16Array.from(buf);
      conn.ws.send(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
    }
  } catch (e) {
    if (conn.turnSeq === seq) console.error("[conv] tts error:", (e as Error)?.message);
  } finally {
    conn.ttsReqId = null;
    conn.isSpeaking = false;
    send(conn.ws, { type: "audio.end" });
    if (conn.turnSeq === seq && !conn.closed) send(conn.ws, { type: "state", state: "listening" });
  }
}

// One user turn: utterance text -> detect lang -> translate -> agent -> translate -> speak.
async function handleUtterance(conn: Conn, rawText: string) {
  const text = rawText.trim();
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return; // ignore blips
  const seq = ++conn.turnSeq;        // new turn; abandons any in-flight one
  const lang = detectLang(text, SUPPORTED);
  send(conn.ws, { type: "user", text, lang });
  send(conn.ws, { type: "state", state: "thinking" });
  try {
    const en = await translateText(lang, "en", text);
    if (conn.turnSeq !== seq) return;
    const result = await conn.agent.processMessage(en);
    if (conn.turnSeq !== seq) return;
    const replyEn = result.response || "Sorry, could you say that again?";
    const replyX = await translateText("en", lang, replyEn);
    if (conn.turnSeq !== seq) return;
    send(conn.ws, { type: "agent", text: replyX, lang, complete: result.complete });
    await speak(conn, replyX, lang, seq);
  } catch (e) {
    send(conn.ws, { type: "error", message: (e as Error)?.message || "turn failed" });
    if (!conn.closed) send(conn.ws, { type: "state", state: "listening" });
  }
}

// Barge-in: user started talking over the agent. Cancel the in-flight TTS + abandon the turn.
async function bargeIn(conn: Conn) {
  conn.turnSeq++;                    // abandons the speaking turn (speak() loop breaks)
  const reqId = conn.ttsReqId;
  conn.ttsReqId = null;
  conn.isSpeaking = false;
  if (reqId) { try { await cancel({ requestId: reqId }); } catch {} }
  send(conn.ws, { type: "barge.ack" });
  send(conn.ws, { type: "state", state: "listening" });
}

async function startConn(ws: any) {
  await loadShared();
  const agent = new CoffeeAgent({
    coffeeShopApiUrl: COFFEE_API, llmModelId: llmId ?? undefined,
    maxTurns: 20, defaultCurrency: "USDT", verbose: false, language: "en",
  });
  // Best-effort wallet (payments work if WDK is available; the conversation works regardless).
  try {
    const mode = process.env.NETWORK_MODE || "testnet";
    const isMain = mode === "mainnet";
    const wdk = getTetherWDK({
      networks: {
        ethereum: isMain ? "https://eth.drpc.org" : "https://ethereum-sepolia-rpc.publicnode.com",
        bitcoin: { network: isMain ? "mainnet" : "testnet", host: "blockstream.info", port: 443 },
        solana: { rpcUrl: isMain ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com" },
        tron: isMain ? "https://api.trongrid.io" : "https://nile.trongrid.io",
      },
    });
    const ctx = {
      getAddress: async () => wdk.getAddress("ethereum", 0),
      signMessage: async (m: string) => wdk.signMessage("ethereum", m, 0),
      getBalance: () => wdk.getBalance("ethereum", 0),
      getAccount: async () => ({ address: await wdk.getAddress("ethereum", 0), signMessage: async (m: string) => wdk.signMessage("ethereum", m, 0), getBalance: () => wdk.getBalance("ethereum", 0) }),
      sendTransaction: async (tx: any) => { const r = await wdk.sendTransaction("ethereum", tx, 0); return { hash: r.hash || r.signature || r.txid, fee: "0" }; },
    };
    agent.setupWDK(ctx as any, wdk);
  } catch (e) { console.warn("[conv] WDK unavailable, payments disabled:", (e as Error)?.message); }

  const session = await transcribeStream({ modelId: sttId });
  const conn: Conn = { ws, agent, session, isSpeaking: false, fullDuplex: false, ttsReqId: null, turnSeq: 0, closed: false };
  conns.set(ws, conn);

  // Consume VAD-segmented utterances (one finalized turn per yield).
  (async () => {
    try {
      for await (const userText of session) {
        if (conn.closed) break;
        if (conn.isSpeaking && !conn.fullDuplex) continue; // half-duplex: drop self-overlap
        await handleUtterance(conn, String(userText));
      }
    } catch (e) { if (!conn.closed) console.error("[conv] session loop:", (e as Error)?.message); }
  })();

  send(ws, { type: "ready", supported: SUPPORTED });
  // Greeting (spoken). Greet in English; the user's first utterance sets the language thereafter.
  const seq = ++conn.turnSeq;
  send(ws, { type: "agent", text: GREETING_EN, lang: "en" });
  await speak(conn, GREETING_EN, "en", seq);
}

function closeConn(ws: any) {
  const conn = conns.get(ws);
  if (!conn) return;
  conn.closed = true;
  try { conn.session?.end?.(); } catch {}
  conns.delete(ws);
}

// ── server ──
const PUBLIC = join(import.meta.dir, "..", "coffee-shop-api", "public");
const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) return undefined;
      return new Response("ws upgrade failed", { status: 400 });
    }
    let p = url.pathname === "/" ? "/conversation.html" : url.pathname;
    const file = Bun.file(join(PUBLIC, p.replace(/\.\.+/g, ".")));
    if (await file.exists()) return new Response(file);
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) { startConn(ws).catch((e) => { send(ws, { type: "error", message: String(e?.message || e) }); }); },
    message(ws, message) {
      const conn = conns.get(ws);
      if (!conn) return;
      if (typeof message === "string") {
        let m: any; try { m = JSON.parse(message); } catch { return; }
        if (m.type === "barge") void bargeIn(conn);
        else if (m.type === "config" && typeof m.fullDuplex === "boolean") conn.fullDuplex = m.fullDuplex;
        return;
      }
      // binary: f32le mic frame. Gate while the agent speaks (unless full-duplex/barge mode).
      if (conn.isSpeaking && !conn.fullDuplex) return;
      try { conn.session.write(new Uint8Array(message as ArrayBufferLike)); } catch {}
    },
    close(ws) { closeConn(ws); },
  },
});

console.log(`\n  Coffee Conversation  ->  http://localhost:${server.port}  (ws://localhost:${server.port}/ws)\n  Multilingual auto-language - speak any of: ${SUPPORTED.join(", ")} - 100% on-device\n`);
