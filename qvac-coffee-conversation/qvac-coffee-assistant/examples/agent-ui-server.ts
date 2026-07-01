// ============================================================================
// Agent UI Server - WebSocket-based Interactive Agent Control
// ============================================================================

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import os from "os"
import {
  loadModel,
  unloadModel,
  transcribe,
  translate,
  textToSpeech,
  // STT: ONE multilingual model. Parakeet TDT v3 transcribes ~25 languages with NO language set
  // at load (auto), so there is no "choose your language" step. The spoken language is then
  // inferred from the transcript (detectLang) to drive translation + the TTS voice.
  PARAKEET_TDT_0_6B_V3_Q8_0,
  // (Whisper constants kept imported as a fallback; no longer the default STT.)
  WHISPER_LARGE_V3_TURBO,
  WHISPER_BASE_Q8_0,
  WHISPER_SPANISH_TINY_Q8_0,
  WHISPER_FRENCH_BASE_Q8_0,
  WHISPER_GERMAN_BASE_Q8_0,
  WHISPER_ITALIAN_BASE_Q8_0,
  WHISPER_PORTUGUESE_BASE_Q8_0,
  // NMT: Bergamot X<->EN (the agent runs in English; we translate in and out).
  BERGAMOT_ES_EN, BERGAMOT_EN_ES,
  BERGAMOT_FR_EN, BERGAMOT_EN_FR,
  BERGAMOT_DE_EN, BERGAMOT_EN_DE,
  BERGAMOT_IT_EN, BERGAMOT_EN_IT,
  BERGAMOT_PT_EN, BERGAMOT_EN_PT,
  // LLM: model constant -> shared ~/.qvac cache (no local GGUF path).
  // Qwen3.6 35B-A3B is a MoE (35B total / ~3B active) -> much better tool-calling + multilingual
  // reasoning than the old 4B, while staying fast. ~22GB; fits a 36GB Mac alongside Parakeet+Chatterbox.
  QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M,
  QWEN3_8B_INST_Q4_K_M,
  QWEN3_4B_INST_Q4_K_M,
  // TTS: Chatterbox GGML multilingual (Piper ONNX was removed). Languages unlocked by patch-sdk.mjs.
  TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0,
  TTS_S3GEN_MULTILINGUAL_CHATTERBOX,
} from "@qvac/sdk"
import { CoffeeAgent } from "../agent"
import { detectLang, detectLangConfident, decideLanguage, type DetectedLang } from "./lang-id"
import { getTetherWDK } from "../tether-wdk"
import { loadOrCreateUserProfile } from "../agent/user-profile"
import { setQRCodeCallback, createOrderQRData, generateQRCodeDataURL } from "../utils/qrcode"
import type { AgentState, TurnResult, ToolCall, AgentCallbacks, ToolResult, Stage, ToolName, OrderQRCodeData } from "../agent/types"

// ============================================================================
// Global crash guard - the payment path must never take down the voice UI
// ============================================================================
// The Spark SDK authenticates in the background and, if the coordinator is unreachable (e.g. no
// internet, or a non-mainnet network), keeps retrying and throws uncaught SparkAuthenticationErrors
// on a timer. Without this guard those async throws crash the whole conversation server (the UI
// process "exited 1", the client never gets a reply, and a reload shows a dead localhost). Payments
// are a secondary feature; a payment failure must degrade gracefully, never kill speech.

const isPaymentPathError = (v: unknown): boolean => {
  const m = v instanceof Error ? `${v.message}` : String(v)
  return m.includes('Spark') || m.includes('Authentication') ||
         m.includes('Transport error') || m.includes('Unable to connect') ||
         m.includes('get_challenge')
}

process.on('unhandledRejection', (reason) => {
  if (isPaymentPathError(reason)) {
    console.warn('⚠️  Payment-path rejection swallowed (voice UI stays up):', reason instanceof Error ? reason.message : reason)
    return
  }
  console.error('⚠️  Unhandled Promise Rejection:', reason)
})

process.on('uncaughtException', (error) => {
  if (isPaymentPathError(error)) {
    console.warn('⚠️  Payment-path exception swallowed (voice UI stays up):', error instanceof Error ? error.message : error)
    return
  }
  console.error('⚠️  Uncaught Exception:', error)
})

// ============================================================================
// Types
// ============================================================================

type SessionPhase = "config" | "active"

interface AgentConfig {
  coffeeShopApiUrl: string
  llmModelPath: string
  ttsVoice: string
  espeakDataPath: string
  useRealPayments: boolean
  networkMode: string
  paymentCurrency: string
  maxTurns: number
  verbose: boolean
  language: Lang
}

interface WSMessage {
  type: string
  [key: string]: unknown
}

interface TTSQueueItem {
  text: string
  type: "filler" | "response"
  priority: number  // Lower = higher priority (response = 0, filler = 1)
  gen?: number      // filler generation; a filler is dropped if it is stale (a response started)
}

interface ClientState {
  ws: any
  agent: CoffeeAgent | null
  config: AgentConfig | null
  modelsLoaded: boolean
  whisperModelId: string | null
  llmModelId: string | null
  ttsModelId: string | null
  ttsLang: Lang | null   // language the loaded Chatterbox TTS was built for (reload when it changes)
  ttsPreload: Promise<void> | null   // in-flight TTS load kicked off at language detection (parallel with the LLM)
  langLocked: boolean    // true once a spoken language has been detected (then detection is sticky)
  // Language configuration
  language: SupportedLanguage
  // Filler speech state
  fillerActive: boolean
  fillerTimer: ReturnType<typeof setTimeout> | null
  fillerExtendedTimer: ReturnType<typeof setTimeout> | null
  fillerCount: number
  usedFillerPhrases: Set<string>
  currentFillerContext: FillerContext
  // Session phase
  sessionPhase: SessionPhase
  // TTS queue for sequential audio playback
  ttsQueue: TTSQueueItem[]
  ttsProcessing: boolean
  // True while a turn (greeting or response, incl. its TTS) is in flight. A single SDK worker
  // serves STT/LLM/TTS, so a message arriving mid-turn would contend and can hang it; we drop
  // input while busy.
  busy: boolean
  // Bumped whenever a response is enqueued or filler is stopped; a filler tagged with an older
  // gen is dropped so a tool-ack can never play AFTER (and cut off) the real response.
  fillerGen: number
}

// ============================================================================
// Configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || "3458")
const PUBLIC_DIR = join(import.meta.dir, "..", "coffee-shop-api", "public")

const DEFAULT_CONFIG: AgentConfig = {
  coffeeShopApiUrl: process.env.COFFEE_SHOP_API_URL || "http://localhost:3457",
  llmModelPath: process.env.LLM_MODEL_PATH || "./models/Qwen3-4B-Instruct-2507-Q8_0.gguf",
  ttsVoice: process.env.TTS_VOICE || "norman",
  espeakDataPath: process.env.ESPEAK_DATA_PATH || "/opt/homebrew/Cellar/espeak-ng/1.52.0/share/espeak-ng-data",
  useRealPayments: process.env.USE_REAL_PAYMENTS === "true",
  networkMode: process.env.NETWORK_MODE || "testnet",
  paymentCurrency: process.env.PAYMENT_CURRENCY || "sats",   // shop prices everything in sats (bitcoin), never USDT
  maxTurns: parseInt(process.env.MAX_TURNS || "25"),
  verbose: process.env.VERBOSE === "true",
  language: (process.env.AGENT_LANGUAGE as Lang) || "en",
}

// ============================================================================
// TTS Voice Configuration
// ============================================================================

// Languages with a Whisper STT model AND a Chatterbox TTS voice AND a Bergamot X<->EN path
// (the user can both speak and be answered in them). ru/ja have STT but no Chatterbox voice.
type Lang = "en" | "es" | "fr" | "de" | "it" | "pt"
const LANG_NAMES: Record<Lang, string> = {
  en: "English", es: "Espanol", fr: "Francais", de: "Deutsch", it: "Italiano", pt: "Portugues",
}

type VoiceConfig = {
  name: string
  language?: Lang
}

// A default neutral reference clip (no voice cloning): Chatterbox conditions timbre on it and
// synthesizes in the target language. One clip serves every language.
const DEFAULT_REFERENCE_AUDIO = join(import.meta.dir, "..", "assets", "default-voice.16k.wav")

// STT is per-source-language in 0.12.2 (one Whisper model per language, language is load-time).
const WHISPER_BY_LANG: Record<string, unknown> = {
  en: WHISPER_BASE_Q8_0,
  es: WHISPER_SPANISH_TINY_Q8_0,
  fr: WHISPER_FRENCH_BASE_Q8_0,
  de: WHISPER_GERMAN_BASE_Q8_0,
  it: WHISPER_ITALIAN_BASE_Q8_0,
  pt: WHISPER_PORTUGUESE_BASE_Q8_0,
}

// Bergamot X<->EN model per direction (the agent thinks in English; we translate in and out).
const BERGAMOT: Record<string, unknown> = {
  "es|en": BERGAMOT_ES_EN, "en|es": BERGAMOT_EN_ES,
  "fr|en": BERGAMOT_FR_EN, "en|fr": BERGAMOT_EN_FR,
  "de|en": BERGAMOT_DE_EN, "en|de": BERGAMOT_EN_DE,
  "it|en": BERGAMOT_IT_EN, "en|it": BERGAMOT_EN_IT,
  "pt|en": BERGAMOT_PT_EN, "en|pt": BERGAMOT_EN_PT,
}
// Cache the in-flight PROMISE, not the resolved id: two callers racing the first use of the same
// direction (e.g. a tool-ack translate + the response translate) would otherwise both miss the
// cache and call loadModel twice on the single worker (contention -> hang).
const nmtCache = new Map<string, Promise<string>>() // "from|to" -> modelId promise
const ensureNmt = async (from: string, to: string): Promise<string | null> => {
  const key = `${from}|${to}`
  if (from === to || !BERGAMOT[key]) return null
  let p = nmtCache.get(key)
  if (!p) {
    p = loadModel({ modelSrc: BERGAMOT[key] as any, modelType: "nmt", modelConfig: { engine: "Bergamot", from, to } })
    nmtCache.set(key, p)
    p.catch(() => nmtCache.delete(key)) // drop a failed load so a later call can retry
  }
  return p
}
// Crypto/currency units Bergamot mistranslates (verified: "500 sats" -> "500 sièges").
// We mask them with an inert sentinel the NMT copies verbatim, then restore the original.
const NO_TRANSLATE = /\b(satoshis?|sats?|usdt|usdc|btc|eth)\b/gi
// Translate text from->to via Bergamot; strips the ">>lang<<" target token some models echo.
// On any failure, fall back to the original text (a conversation should never crash on a flaky
// translation; worst case the user hears English instead of their language).
const translateText = async (from: string, to: string, text: string): Promise<string> => {
  if (from === to || !text.trim()) return text
  try {
    const id = await ensureNmt(from, to)
    if (!id) return text
    const saved: string[] = []
    const masked = text.replace(NO_TRANSLATE, (m) => ` ZZQ${saved.push(m) - 1}ZZQ `)
    const tr = translate({ modelId: id, text: masked, modelType: "nmt", stream: false })
    let out = String(await tr.text).trim().replace(/^\s*>>[a-z]{2,3}<<\s*/i, "").trim()
    out = out.replace(/ZZQ\s*(\d+)\s*ZZQ/gi, (_, i) => saved[Number(i)] ?? "")
    // tidy the spaces the sentinel left behind (e.g. "sats ." -> "sats.")
    out = out.replace(/\s+([.,!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim()
    return out || text
  } catch (e) {
    console.error(`[translate] ${from}->${to} failed, using original:`, (e as Error)?.message)
    return text
  }
}

// Voice list for the UI (the timbre is the default reference clip; language drives Chatterbox).
const VOICES: Record<string, VoiceConfig> = {
  default: { name: "Chatterbox", language: "en" },
}

// Native reference clip per language: Chatterbox clones the reference's accent, so an English
// reference made French sound English. These are native-voice samples (assets/ref-<lang>.16k.wav)
// so French sounds French, Spanish Spanish, etc. English keeps the brand reference.
const REF_DIR = join(import.meta.dir, "..", "assets")
const REF_BY_LANG: Record<string, string> = {
  en: DEFAULT_REFERENCE_AUDIO,
  fr: join(REF_DIR, "ref-fr.16k.wav"),
  es: join(REF_DIR, "ref-es.16k.wav"),
  it: join(REF_DIR, "ref-it.16k.wav"),
  de: join(REF_DIR, "ref-de.16k.wav"),
  pt: join(REF_DIR, "ref-pt.16k.wav"),
}

// Returns the Chatterbox load shape for a target language. modelSrc + s3gen + referenceAudio +
// language are all LOAD-TIME (changing language reloads the model). No Piper config / eSpeak.
const getVoiceConfig = (_voiceName: string, language: Lang = "en") => ({
  modelSrc: TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0.src,
  s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX.src,
  referenceAudioSrc: REF_BY_LANG[language] || DEFAULT_REFERENCE_AUDIO,
  voiceName: `Chatterbox (${language})`,
  language,
})

// ============================================================================
// Audio Utilities
// ============================================================================

// Chatterbox outputs 24 kHz mono (Piper was 22050).
const CHATTERBOX_SR = 24000
// Synthesis MUST go through sentenceStream: feeding a multi-sentence string as one
// utterance makes Chatterbox run away into ~40s of babble past ~100 graphemes.
// sentenceStream splits on sentence boundaries, merged up to this many graphemes/chunk.
const TTS_MAX_CHUNK_SCALARS = 80

const createWavHeader = (dataLength: number, sampleRate: number = CHATTERBOX_SR): Buffer => {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataLength, 40)
  return header
}

const int16ArrayToBuffer = (int16Array: number[]): Buffer => {
  const buffer = Buffer.alloc(int16Array.length * 2)
  for (let i = 0; i < int16Array.length; i++) {
    const value = int16Array[i] ?? 0
    buffer.writeInt16LE(value, i * 2)
  }
  return buffer
}

// Chatterbox appends ~10-15s of low-level trailing noise after the utterance. Trim only the
// leading/trailing low-energy (never inside speech); threshold = 90th-percentile frame energy.
// Ported from the QVAC Voice Relay recipe (test/07-voice-cloner).
const trimSpeech = (samples: number[] | Int16Array, sr: number = CHATTERBOX_SR): number[] => {
  const arr = Array.isArray(samples) ? samples : Array.from(samples)
  const win = Math.max(1, Math.floor(sr * 0.02))
  const frames = Math.floor(arr.length / win)
  if (frames < 10) return arr
  const rms = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0; const base = f * win
    for (let i = 0; i < win; i++) { const v = (arr[base + i] ?? 0) / 32768; s += v * v }
    rms[f] = Math.sqrt(s / win)
  }
  const sorted = Float32Array.from(rms).sort()
  const p90 = sorted[Math.floor(frames * 0.90)] || sorted[frames - 1]
  if (p90 <= 0) return arr
  const thr = Math.max(0.012, p90 * 0.08)
  let first = 0; while (first < frames && rms[first] < thr) first++
  let last = frames - 1; while (last > first && rms[last] < thr) last--
  if (last <= first) return arr
  const s0 = Math.max(0, first - 6) * win
  const s1 = Math.min(frames, last + 1 + 15) * win
  const out = arr.slice(s0, s1)
  return out.length < sr * 0.4 ? arr : out
}

// Number to words for TTS
const numberWords: Record<number, string> = {
  0: "zero", 1: "one", 2: "two", 3: "three", 4: "four",
  5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine",
  10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen",
  15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
  20: "twenty", 30: "thirty", 40: "forty", 50: "fifty",
  60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety"
}

const numberToWords = (num: number): string => {
  if (num < 0) return "negative " + numberToWords(-num)
  if (num < 20) return numberWords[num] ?? String(num)
  if (num < 100) {
    const tens = Math.floor(num / 10) * 10
    const ones = num % 10
    return ones === 0 ? numberWords[tens]! : `${numberWords[tens]}-${numberWords[ones]}`
  }
  if (num < 1000) {
    const h = Math.floor(num / 100)
    const rest = num % 100
    return rest === 0 ? `${numberWords[h]} hundred` : `${numberWords[h]} hundred ${numberToWords(rest)}`
  }
  // Sat amounts are typically in the thousands; spell them out so Chatterbox does not
  // read raw digits ("3 5 0 0"). Covers up to 999,999 (plenty for a coffee order).
  if (num < 1_000_000) {
    const th = Math.floor(num / 1000)
    const rest = num % 1000
    return rest === 0 ? `${numberToWords(th)} thousand` : `${numberToWords(th)} thousand ${numberToWords(rest)}`
  }
  return String(num)
}

const decimalToWords = (num: number): string => {
  const str = num.toString()
  if (!str.includes(".")) return numberToWords(num)
  const [intPart, decPart] = str.split(".")
  const intWords = numberToWords(parseInt(intPart || "0"))
  const decWords = (decPart || "").split("").map(d => numberWords[parseInt(d)] ?? d).join(" ")
  return `${intWords} point ${decWords}`
}

const formatForTTS = (text: string, lang: Lang = "en"): string => {
  let t = text
    // Remove emojis
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu, '')
    // Remove markdown bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove markdown bullet points
    .replace(/^[\s]*[-•*]\s+/gm, '')
    // Remove markdown headers
    .replace(/^#+\s*/gm, '')
    // Clean up extra whitespace
    .replace(/\n\s*\n/g, '. ')
    .replace(/\n/g, ', ')
  // Sat-only demo: "sats" is already a pronounceable word (say "sats", never "S A T"),
  // and there is no USDT/fiat in this demo, so no acronym spelling is needed.
  // Number/price spelling is ENGLISH-only. For other languages this would inject English
  // words into the foreign text and break pronunciation, so we skip it and let Chatterbox
  // read the digits in the target language.
  if (lang === "en") {
    t = t
      .replace(/(\d+)\.\s/g, (_, num) => `${numberToWords(parseInt(num))}, `)
      // Spell sat amounts so Chatterbox says "three thousand five hundred sats", not raw digits.
      .replace(/(\d[\d,]*)\s*sats?\b/gi, (_, amount) => `${numberToWords(parseInt(String(amount).replace(/,/g, "")))} sats`)
      .replace(/\$(\d+\.?\d*)/g, (_, price) => `${decimalToWords(parseFloat(price))} dollars`)
      .replace(/(\d+\.\d+)/g, (_, num) => decimalToWords(parseFloat(num)))
  }
  // Clean up any double spaces
  return t.replace(/\s+/g, ' ').trim()
}

// ============================================================================
// TTS Queue System
// ============================================================================

/**
 * Add a TTS item to the queue and start processing if not already running.
 * Responses have higher priority than fillers and will be moved to the front.
 */
const enqueueTTS = (client: ClientState, text: string, type: "filler" | "response") => {
  const priority = type === "response" ? 0 : 1
  // A response invalidates any filler from before it: bump the generation so an in-flight or
  // queued tool-ack is dropped instead of playing after (and cutting off) the response.
  if (type === "response") client.fillerGen++
  const item: TTSQueueItem = { text, type, priority, gen: type === "filler" ? client.fillerGen : undefined }

  // Insert based on priority (responses go to front, fillers to back)
  if (type === "response") {
    // Find the first filler and insert before it
    const firstFillerIndex = client.ttsQueue.findIndex(i => i.type === "filler")
    if (firstFillerIndex === -1) {
      client.ttsQueue.push(item)
    } else {
      client.ttsQueue.splice(firstFillerIndex, 0, item)
    }
  } else {
    client.ttsQueue.push(item)
  }
  
  // Start processing if not already running
  if (!client.ttsProcessing) {
    processTTSQueue(client)
  }
}

/**
 * Process the TTS queue sequentially.
 * Each item is fully generated and sent before the next one starts.
 */
const processTTSQueue = async (client: ClientState) => {
  if (client.ttsProcessing) return
  client.ttsProcessing = true
  
  while (client.ttsQueue.length > 0) {
    const item = client.ttsQueue.shift()
    if (!item) break

    if (!client.ttsModelId) {
      console.warn("TTS model not loaded, skipping audio")
      continue
    }

    // Drop a stale filler (a response was enqueued after it). Prevents the tool-ack from playing.
    if (item.type === "filler" && item.gen !== client.fillerGen) continue

    try {
      // item.text is ALREADY in the spoken language (translated once at enqueue time, then reused
      // for both the on-screen text and the audio so they always match). Just format it for TTS.
      const ttsLang = (client.config?.language || "en") as Lang
      const formattedText = formatForTTS(item.text, ttsLang)

      // Synthesize sentence-by-sentence. Feeding the whole multi-sentence response as ONE
      // utterance makes Chatterbox run away into ~40s of babble past ~100 graphemes, which
      // is what produced the long pause, the 30s of artefacts, AND the truncation (trimSpeech
      // was cutting the trailing babble, leaving only the first sentence). sentenceStream
      // splits on sentence boundaries so every chunk stays under the runaway threshold.
      const result = textToSpeech({
        modelId: client.ttsModelId,
        text: formattedText,
        inputType: "text",
        stream: true,
        sentenceStream: true,
        sentenceStreamMaxChunkScalars: TTS_MAX_CHUNK_SCALARS,
      })

      const audioBuffer: number[] = []
      for await (const s of result.bufferStream) audioBuffer.push(s)
      const audioData = int16ArrayToBuffer(trimSpeech(audioBuffer))
      const wavBuffer = Buffer.concat([createWavHeader(audioData.length), audioData])
      
      const audioBase64 = wavBuffer.toString("base64")

      // Send with appropriate message type
      if (item.type === "filler") {
        // Re-check staleness: a response may have been enqueued while we were synthesizing this
        // filler. If so, drop it so it never plays after the response.
        if (item.gen !== client.fillerGen) continue
        sendMessage(client.ws, {
          type: "filler_audio",
          audio: audioBase64,
          text: item.text,
          format: "wav",
        })
      } else {
        sendMessage(client.ws, {
          type: "tts_audio",
          audio: audioBase64,
          format: "wav",
        })
      }
      
      // Estimate audio duration and wait for it to (mostly) finish playing
      // This prevents the next audio from being sent before the previous one completes
      // Audio is 24000 Hz (Chatterbox), 16-bit mono = 2 bytes per sample
      const durationMs = (audioData.length / 2 / CHATTERBOX_SR) * 1000
      // Wait for ~80% of the duration to allow some overlap for natural flow
      const waitMs = Math.max(100, durationMs * 0.8)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      
    } catch (error) {
      console.error(`TTS generation error for ${item.type}:`, error)
    }
  }
  
  client.ttsProcessing = false
}

/**
 * Clear all pending filler phrases from the queue.
 * Called when the final response is ready to prioritize it.
 */
const clearFillerQueue = (client: ClientState) => {
  client.fillerGen++ // invalidate any filler already shifted into a mid-synth iteration
  client.ttsQueue = client.ttsQueue.filter(item => item.type !== "filler")
}

// ============================================================================
// Filler Speech Phrases (imported from shared module)
// ============================================================================

import {
  INITIAL_FILLERS,
  EXTENDED_FILLERS,
  STAGE_FILLERS,
  TOOL_CALLING_FILLERS,
  TOOL_COMPLETED_FILLERS,
  PAYMENT_STATUS_FILLERS,
  getFillers,
  type SupportedLanguage,
} from "./filler-speech"

// Filler speech timing configuration
const FILLER_INITIAL_DELAY = 800  // ms before first filler
const FILLER_EXTENDED_INTERVAL = 6000  // ms between extended fillers
const FILLER_EXTENDED_INCREMENT = 3000  // additional ms for each subsequent filler

// ============================================================================
// WebSocket Message Handlers
// ============================================================================

const sendMessage = (ws: any, message: WSMessage) => {
  try {
    ws.send(JSON.stringify(message))
  } catch (error) {
    console.error("Failed to send WebSocket message:", error)
  }
}

// ============================================================================
// TTS Generation (using queue)
// ============================================================================

// Chatterbox's voice language is load-time, so when the spoken (auto-detected) language changes we
// reload the TTS model for that language before speaking. Same reference voice; only language differs.
const ensureTtsLanguage = async (client: ClientState, lang: Lang) => {
  if (client.ttsLang === lang && client.ttsModelId) return
  sendMessage(client.ws, { type: "status", message: `Switching voice to ${LANG_NAMES[lang] || lang}...` })
  if (client.ttsModelId) { try { await unloadModel({ modelId: client.ttsModelId }) } catch (e) {} client.ttsModelId = null }
  const vc = getVoiceConfig(client.config?.ttsVoice || "default", lang)
  client.ttsModelId = await loadModel({
    modelSrc: vc.modelSrc,
    modelType: "tts",
    modelConfig: { ttsEngine: "chatterbox", language: vc.language, s3genModelSrc: vc.s3genModelSrc, referenceAudioSrc: vc.referenceAudioSrc, useGPU: true },
    // Surface the voice-model download like STT and the LLM do. On a COLD machine (first run) the
    // ~1.5GB Chatterbox blob downloads + hash-verifies here; without this the bar froze on
    // "Switching voice to ..." and looked hung even though it was working. No-op on a warm cache.
    onProgress: (progress: any) => {
      sendMessage(client.ws, { type: "loading_progress", model: "tts", progress: progress.percentage })
    },
  })
  client.ttsLang = lang
  // Warm the cold GPU kernels with a throwaway synth (drained, never sent). The very first synth on
  // a freshly-loaded Chatterbox hits a Metal-shader compile that can drop the first reply's audio;
  // pre-warming makes the first real reply actually speak.
  try {
    const warm = textToSpeech({ modelId: client.ttsModelId, text: "ok", inputType: "text", stream: true, sentenceStream: true, sentenceStreamMaxChunkScalars: TTS_MAX_CHUNK_SCALARS })
    for await (const _ of warm.bufferStream) { /* drain */ }
  } catch (e) {}
}

/**
 * Queue a response for TTS generation.
 * Clears any pending fillers and waits for the response to be spoken.
 */
const generateAndSendTTS = async (client: ClientState, text: string) => {
  if (!client.ttsModelId) {
    console.warn("TTS model not loaded, skipping audio")
    return
  }

  // Clear any remaining fillers - the response is more important
  clearFillerQueue(client)
  
  // Add response to queue with high priority
  enqueueTTS(client, text, "response")
  
  // Wait for queue to finish processing this response
  // This ensures the function doesn't return until the audio is sent
  while (client.ttsProcessing || client.ttsQueue.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

// ============================================================================
// Filler Speech Functions
// ============================================================================

interface FillerContext {
  stage?: string
  tool?: ToolName
  toolStatus?: "calling" | "completed"
}

const selectFillerPhrase = (client: ClientState, context: FillerContext, type: "initial" | "extended"): string => {
  const { stage, tool, toolStatus } = context
  const fillers = getFillers(client.language)
  let pool: string[] = []
  
  if (type === "extended") {
    // Extended fillers are always generic (waiting messages)
    pool = [...fillers.EXTENDED]
  } else {
    // For initial fillers, build pool with priority ordering:
    // Priority 1: Tool-specific fillers
    if (tool) {
      if (toolStatus === "completed") {
        const toolCompletedPhrases = fillers.TOOL_COMPLETED[tool]
        if (toolCompletedPhrases && toolCompletedPhrases.length > 0) {
          pool.push(...toolCompletedPhrases)
        }
      } else {
        // Default to "calling" status
        const toolCallingPhrases = fillers.TOOL_CALLING[tool]
        if (toolCallingPhrases && toolCallingPhrases.length > 0) {
          pool.push(...toolCallingPhrases)
        }
      }
    }
    
    // Priority 2: Stage-specific fillers
    if (stage && fillers.STAGE[stage]) {
      pool.push(...fillers.STAGE[stage])
    }
    
    // Priority 3: Generic initial fillers (always available as fallback)
    pool.push(...fillers.INITIAL)
  }

  // Pick a phrase we haven't used recently
  const availablePhrases = pool.filter(p => !client.usedFillerPhrases.has(p))
  const phrase = availablePhrases.length > 0
    ? availablePhrases[Math.floor(Math.random() * availablePhrases.length)]!
    : pool[Math.floor(Math.random() * pool.length)]!

  client.usedFillerPhrases.add(phrase)

  // Limit memory of used phrases
  if (client.usedFillerPhrases.size > 15) {
    const oldest = client.usedFillerPhrases.values().next().value
    if (oldest) client.usedFillerPhrases.delete(oldest)
  }

  return phrase
}

/**
 * Queue a filler phrase for TTS generation.
 * Uses the queue system to prevent overlapping speech.
 */
const playFillerSpeech = (client: ClientState, context: FillerContext, type: "initial" | "extended") => {
  if (!client.fillerActive || !client.ttsModelId) return

  const phrase = selectFillerPhrase(client, context, type)
  const contextStr = context.tool 
    ? `tool:${context.tool}` 
    : context.stage 
      ? `stage:${context.stage}` 
      : "generic"
  console.log(`🗣️ [Filler ${type}] (${contextStr}) ${phrase}`)

  // Add to queue - will be processed sequentially
  enqueueTTS(client, phrase, "filler")

  // Schedule next extended filler with progressive delay
  if (client.fillerActive) {
    scheduleNextExtendedFiller(client, context)
  }
}

const scheduleNextExtendedFiller = (client: ClientState, context: FillerContext) => {
  if (!client.fillerActive) return

  const delay = FILLER_EXTENDED_INTERVAL + (client.fillerCount * FILLER_EXTENDED_INCREMENT)
  client.fillerCount++

  client.fillerExtendedTimer = setTimeout(() => {
    if (client.fillerActive) {
      playFillerSpeech(client, context, "extended")
    }
  }, delay)
}

const startFillerSpeech = (client: ClientState, context?: FillerContext) => {
  if (client.fillerActive) return
  
  client.fillerActive = true
  client.fillerCount = 0
  client.usedFillerPhrases.clear()
  client.currentFillerContext = context || {}

  const contextStr = context?.tool 
    ? `tool:${context.tool}` 
    : context?.stage 
      ? `stage:${context.stage}` 
      : "none"
  console.log(`🔊 Filler speech started (${contextStr})`)

  // Schedule initial filler
  client.fillerTimer = setTimeout(() => {
    if (client.fillerActive) {
      playFillerSpeech(client, client.currentFillerContext, "initial")
    }
  }, FILLER_INITIAL_DELAY)
}

/**
 * Queue a tool-specific filler phrase for TTS.
 * Called when a tool starts or completes execution.
 */
const speakToolFiller = async (client: ClientState, tool: ToolName, status: "calling" | "completed") => {
  // One short acknowledgment per action: only when a tool STARTS (never on completion, never looped).
  if (!client.ttsModelId || status !== "calling") return

  const fillers = getFillers(client.language)
  const phrases = fillers.TOOL_CALLING[tool]
  if (!phrases || phrases.length === 0) return

  // Pick a phrase we haven't used recently
  const availablePhrases = phrases.filter(p => !client.usedFillerPhrases.has(p))
  const phrase = availablePhrases.length > 0
    ? availablePhrases[Math.floor(Math.random() * availablePhrases.length)]!
    : phrases[Math.floor(Math.random() * phrases.length)]!

  client.usedFillerPhrases.add(phrase)
  console.log(`🗣️ [Tool ${status}] ${tool}: ${phrase}`)

  // Fillers: the EN pool is varied; for other languages we DON'T Bergamot-translate it (that gave
  // garbage like "Verrouillage dans les details"). Use one short, clean native acknowledgment.
  const lang = (client.config?.language || "en") as Lang
  const NATIVE_FILLER: Record<string, string> = {
    es: "Un momento...", fr: "Un instant...", it: "Un attimo...", de: "Einen Moment...", pt: "Um momento...",
  }
  const spoken = lang === "en" ? phrase : (NATIVE_FILLER[lang] || "")
  if (spoken) enqueueTTS(client, spoken, "filler")
}

const stopFillerSpeech = (client: ClientState) => {
  if (!client.fillerActive) return
  
  client.fillerActive = false
  console.log("🔊 Filler speech stopped")

  // Clear timers
  if (client.fillerTimer) {
    clearTimeout(client.fillerTimer)
    client.fillerTimer = null
  }
  if (client.fillerExtendedTimer) {
    clearTimeout(client.fillerExtendedTimer)
    client.fillerExtendedTimer = null
  }

  // Clear any pending fillers from the TTS queue
  clearFillerQueue(client)

  // Reset state
  client.usedFillerPhrases.clear()
  client.fillerCount = 0
}

/**
 * Send initial greeting to the user
 */
const sendGreeting = async (client: ClientState) => {
  client.sessionPhase = "active"
  // No spoken/English greeting: the user speaks first (the rotating multilingual prompt on the start
  // screen is the invitation). Just tell the UI the agent is ready so the chat opens and the mic listens.
  sendMessage(client.ws, {
    type: "agent_ready",
    state: client.agent?.getState(),
  })
  client.busy = false
}

// ============================================================================
// Client Session Management
// ============================================================================

const clients = new Map<any, ClientState>()

const initializeClient = (ws: any): ClientState => {
  const client: ClientState = {
    ws,
    agent: null,
    config: null,
    modelsLoaded: false,
    whisperModelId: null,
    llmModelId: null,
    ttsModelId: null,
    ttsLang: null,
    ttsPreload: null,
    langLocked: false,
    // Language configuration
    language: "en",
    // Filler speech state
    fillerActive: false,
    fillerTimer: null,
    fillerExtendedTimer: null,
    fillerCount: 0,
    usedFillerPhrases: new Set<string>(),
    currentFillerContext: {},
    // Session phase
    sessionPhase: "config",
    // TTS queue for sequential audio playback
    ttsQueue: [],
    ttsProcessing: false,
    busy: false,
    fillerGen: 0,
  }
  clients.set(ws, client)
  return client
}

const cleanupClient = async (ws: any) => {
  const client = clients.get(ws)
  if (!client) return

  // Stop filler speech and clear TTS queue
  stopFillerSpeech(client)
  client.ttsQueue = []
  client.ttsProcessing = false

  // Clear QR code callback
  setQRCodeCallback(null)

  // Unload models
  const unloaders: Promise<unknown>[] = []
  
  if (client.whisperModelId) {
    unloaders.push(unloadModel({ modelId: client.whisperModelId }))
  }
  if (client.llmModelId) {
    unloaders.push(unloadModel({ modelId: client.llmModelId }))
  }
  if (client.ttsModelId) {
    unloaders.push(unloadModel({ modelId: client.ttsModelId }))
  }

  if (unloaders.length > 0) {
    try {
      await Promise.all(unloaders)
    } catch (error) {
      console.error("Error unloading models:", error)
    }
  }

  clients.delete(ws)
}

// ============================================================================
// Message Handlers
// ============================================================================

const handleGetConfig = (client: ClientState) => {
  // Load user profile
  let userProfile = null
  try {
    userProfile = loadOrCreateUserProfile()
  } catch {
    // No profile found
  }

  sendMessage(client.ws, {
    type: "config_loaded",
    config: DEFAULT_CONFIG,
    userProfile,
    availableVoices: Object.entries(VOICES).map(([id, v]) => ({
      id,
      name: v.name,
    })),
  })
}

// Fetch the live menu and format it as a compact prompt section. NEVER hardcoded - a menu edit in
// coffee-shop-api/data is reflected automatically (after the next server start). Returns "" if the
// shop API is unreachable (the agent then relies on the per-tool menu validation as a backstop).
const fetchMenuText = async (apiUrl: string): Promise<string> => {
  try {
    const resp = await fetch(`${apiUrl}/api/menu`)
    const data = await resp.json() as { data?: { drinks?: Array<{ name: string; category?: string; price?: number }>; options?: Array<{ name: string; price?: number }> } }
    const drinks = data?.data?.drinks || []
    const options = data?.data?.options || []
    if (drinks.length === 0) return ""
    const isCold = (c?: string) => { const x = (c || "").toLowerCase(); return x === "cold" || x === "iced" }
    const hot = drinks.filter(d => !isCold(d.category))
    const cold = drinks.filter(d => isCold(d.category))
    const fmt = (arr: Array<{ name: string; price?: number }>) => arr.map(d => `${d.name} (${Math.round(Number(d.price) || 0)} sats)`).join(", ")
    let s = "\n\n## OUR ACTUAL MENU (the ONLY items we sell - nothing else exists)\n"
    if (hot.length) s += `Hot drinks: ${fmt(hot)}\n`
    if (cold.length) s += `Cold drinks: ${fmt(cold)}\n`
    if (options.length) s += `Extras: ${options.map(o => o.name).join(", ")}\n`
    s += `If a customer asks for ANYTHING not on this list (tea, smoothie, juice, water, soda, Nespresso, plain "espresso", food, etc.), IMMEDIATELY and politely say it is not on our menu and offer what we DO have. Never claim to have an item that is not listed here, and never add a non-menu item to the order.`
    return s
  } catch {
    return ""
  }
}

const handleStart = async (client: ClientState, config: Partial<AgentConfig>) => {
  try {
    const finalConfig: AgentConfig = { ...DEFAULT_CONFIG, ...config }
    client.config = finalConfig
    // The agent (prompts, fillers, tool parsing) runs in English; we translate the user's
    // language in and out around it. config.language is the spoken/voice language (7 supported).
    client.language = "en"

    const isSpanish = finalConfig.language === "es"

    // Soft hardware warning (NOT a gate): the demo loads Qwen3 4B + Chatterbox (multi-GB) + Whisper.
    // On low RAM, loading can be very slow or crash. We warn and keep going.
    const totalGB = os.totalmem() / 1024 ** 3
    if (totalGB < 16) {
      const warn = totalGB < 8
        ? `Low memory: ${totalGB.toFixed(0)} GB detected. The 4B model needs more; it may be very slow or crash. 16 GB or more is recommended.`
        : `Heads up: ${totalGB.toFixed(0)} GB detected. 16 GB or more is recommended for the 4B model; loading may be slow.`
      console.warn(`[hardware] ${warn}`)
      sendMessage(client.ws, { type: "warning", message: warn })
    }

    sendMessage(client.ws, { type: "status", message: isSpanish ? "Cargando modelos..." : "Loading models..." })

    // STT: ONE multilingual model (Parakeet TDT v3). No per-language model, no language set at load:
    // it transcribes ~25 languages on its own. The spoken language is inferred from the transcript
    // (detectLang) afterwards to drive translation + the TTS voice. (parakeet-transcription does NOT
    // accept audio_format/language at load, so we hand it a self-describing WAV at transcribe time.)
    sendMessage(client.ws, { type: "status", message: isSpanish ? "Cargando modelo de voz a texto (multilingue)..." : "Loading speech model (multilingual, auto-language)..." })
    client.whisperModelId = await loadModel({
      modelSrc: PARAKEET_TDT_0_6B_V3_Q8_0 as any,
      modelType: "parakeet-transcription",
      onProgress: (progress: any) => {
        sendMessage(client.ws, {
          type: "loading_progress",
          model: "whisper",
          progress: progress.percentage,
        })
      },
    })

    // LLM default = Qwen3 4B (~2.5GB): lightest + fastest, and good enough for the ordering agent.
    // Fits comfortably alongside Parakeet (~1GB) + Chatterbox (~1.5GB). Swap via env for more
    // capability: AGENT_LLM=8b (Qwen3 8B, stronger tool-calling) or AGENT_LLM=35b (Qwen3.6 35B-A3B,
    // ~22GB, needs 32GB+ RAM).
    const AGENT_LLM =
      process.env.AGENT_LLM === "8b" ? QWEN3_8B_INST_Q4_K_M :
      process.env.AGENT_LLM === "35b" ? QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M :
      QWEN3_4B_INST_Q4_K_M
    sendMessage(client.ws, { type: "status", message: isSpanish ? "Cargando modelo de lenguaje..." : "Loading language model..." })
    client.llmModelId = await loadModel({
      modelSrc: AGENT_LLM,
      modelType: "llamacpp-completion",
      modelConfig: {
        ctx_size: 16384,
        device: "gpu",
        // Disable Qwen3 thinking for the agent's tool-calling hops. Measured 6.7x faster
        // (3433ms -> 509ms) AND it emits clean JSON directly (no <think> tokens to strip).
        // The FSM/tool loop does not need chain-of-thought; the reasoning panel (if added)
        // would be a separate, opt-in completion.
        reasoning_budget: 0,
      },
      onProgress: (progress: any) => {
        sendMessage(client.ws, {
          type: "loading_progress",
          model: "llm",
          progress: progress.percentage,
        })
      },
    })

    // Preload the Bergamot models for this conversation's language (both directions) so the
    // first message does not pay the NMT load. Small models (~40-80MB), cached for reuse.
    if (finalConfig.language !== "en") {
      sendMessage(client.ws, { type: "status", message: `Loading translation (${LANG_NAMES[finalConfig.language] || finalConfig.language})...` })
      await Promise.all([
        ensureNmt(finalConfig.language, "en").catch(() => null),
        ensureNmt("en", finalConfig.language).catch(() => null),
      ])
    }

    // PREWARM Chatterbox during the loading screen so the first reply doesn't pay the full cold
    // load (~5s) + the Metal-shader compile AFTER the user has already spoken. The shader compile
    // is the slow part and is shared across languages, so warming the default here makes the first
    // real synth fast even after the per-language reload on turn 1. (Recipe is on tts-ggml 0.2.5,
    // which tolerates a later overlapping load, so this is safe.)
    sendMessage(client.ws, { type: "status", message: "Loading voice..." })
    await ensureTtsLanguage(client, finalConfig.language).catch(() => null)

    client.modelsLoaded = true

    // Create agent callbacks for real-time updates
    const callbacks: AgentCallbacks = {
      onToolCall: (tool: ToolName, args: Record<string, unknown>, status: "calling" | "completed", result?: ToolResult) => {
        // Send tool call info to UI (include all result fields for display_menu, tts_response, etc.)
        sendMessage(client.ws, {
          type: "tool_call",
          tool,
          args,
          status,
          result: result ? { ...result } : undefined,
        })
        
        // Speak tool-specific filler (e.g., "let me check the menu" for shop.menu)
        // This fires immediately without waiting for the delayed filler system
        speakToolFiller(client, tool, status)
        
        // Update the filler context so any delayed fillers also know about the tool
        if (status === "calling") {
          client.currentFillerContext = { ...client.currentFillerContext, tool, toolStatus: status }
        }
        
        // Send state update after tool completes
        if (status === "completed" && client.agent) {
          sendMessage(client.ws, {
            type: "state_update",
            state: client.agent.getState(),
          })
        }
      },
      onStateChange: (state: AgentState, previousStage: Stage) => {
        sendMessage(client.ws, {
          type: "state_update",
          state,
          previousStage,
        })

        // Check for payment completion
        if (state.execution.payment_status === "completed" && state.execution.order_id) {
          // Strip any Relay-style "Type:" prefix (e.g. "SparkLightningSendRequest:<uuid>") so the
          // explorer link resolves. tools.ts already prefers the transfer sparkId, this is defensive.
          const rawHash = (state.execution as any).transaction_hash
          const txHash = rawHash ? String(rawHash).split(":").pop() : rawHash
          let link = ""

          if (txHash) {
            const NETWORK_MODE = process.env.NETWORK_MODE || 'testnet'
            const isMainnet = NETWORK_MODE === 'mainnet'
            const network = (state.execution.x402_requirements?.network || "").toLowerCase()

            if (network.includes("lightning") || network.includes("spark") || network === "sats") {
              // Lightning/Spark settles on the Spark statechain, not an EVM chain -> Spark explorer.
              link = `https://www.sparkscan.io/tx/${txHash}`
            } else if (network.includes("tron")) {
              link = isMainnet
                ? `https://tronscan.org/#/transaction/${txHash}`
                : `https://nile.tronscan.org/#/transaction/${txHash}`
            } else {
              // Ethereum/Base
              link = isMainnet
                ? `https://etherscan.io/tx/${txHash}`
                : `https://sepolia.basescan.org/tx/${txHash}`
            }
          }

          sendMessage(client.ws, {
            type: "payment_complete",
            orderId: state.execution.order_id,
            hash: txHash || "mock_transaction",
            link,
          })

          // Send the QR card from HERE, directly via client.ws (reliable, per-client). The old path
          // went through a module-global setQRCodeCallback that cleanupClient() nulls on ANY
          // disconnect, so after a reconnect the QR silently vanished while payment_complete still
          // worked. Fire-and-forget so it never blocks the state handler.
          ;(async () => {
            try {
              const qr = {
                orderId: state.execution.order_id!,
                timestamp: new Date().toISOString(),
                customerName: state.user?.name,
                currency: state.payment?.currency || "sats",
                items: [{ drink: state.order?.drink || "", extras: state.order?.options || [] }],
                total: (state.execution.x402_requirements as any)?.amount,
                ...(txHash ? { txHash, txLink: link } : {}),
              }
              const { qrContent, receiptUrl } = createOrderQRData(qr as any)
              const imageDataUrl = await generateQRCodeDataURL(qrContent)
              sendMessage(client.ws, { type: "qr_code", ...qr, receiptUrl, imageDataUrl })
            } catch (e) {
              console.error("QR generation for UI failed:", e)
            }
          })()
        }
      },
    }

    // Create agent with callbacks
    sendMessage(client.ws, { type: "status", message: "Initializing agent..." })
    
    const agent = new CoffeeAgent({
      coffeeShopApiUrl: finalConfig.coffeeShopApiUrl,
      llmModelId: client.llmModelId ?? undefined,
      maxTurns: finalConfig.maxTurns,
      defaultCurrency: finalConfig.paymentCurrency as any,   // "sats" by default (PaymentCurrency includes it)
      verbose: finalConfig.verbose,
      callbacks,
      // The agent ALWAYS reasons + replies in English; we translate X->EN in and EN->X out around
      // it (see handleUserMessage). Passing the spoken language here would make the agent answer in
      // Spanish for "es" and then we would translate Spanish->Spanish (garbled). Keep it English.
      language: "en",
    })

    // Set up WDK - select network based on NETWORK_MODE env variable
    const NETWORK_MODE = process.env.NETWORK_MODE || 'testnet'
    const isMainnet = NETWORK_MODE === 'mainnet'
    
    const wdkManager = getTetherWDK({
      networks: {
        ethereum: isMainnet ? 'https://eth.drpc.org' : 'https://ethereum-sepolia-rpc.publicnode.com',
        bitcoin: { network: isMainnet ? 'mainnet' : 'testnet', host: 'blockstream.info', port: 443 },
        solana: { rpcUrl: isMainnet ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com' },
        tron: isMainnet ? 'https://api.trongrid.io' : 'https://nile.trongrid.io'
      }
    })

    const wdkContext = {
      getAddress: async () => wdkManager.getAddress('ethereum', 0),
      signMessage: async (message: string) => wdkManager.signMessage('ethereum', message, 0),
      getBalance: () => wdkManager.getBalance('ethereum', 0),
      getAccount: async () => ({
        address: await wdkManager.getAddress('ethereum', 0),
        signMessage: async (msg: string) => wdkManager.signMessage('ethereum', msg, 0),
        getBalance: () => wdkManager.getBalance('ethereum', 0)
      }),
      sendTransaction: async (tx: any) => {
        const result = await wdkManager.sendTransaction('ethereum', tx, 0)
        return { hash: result.hash || result.signature || result.txid, fee: '0' }
      }
    }

    agent.setupWDK(wdkContext, wdkManager)
    client.agent = agent

    // Inject the REAL menu (fetched live, never hardcoded) into the agent's system prompt so it
    // knows exactly what exists and refuses off-menu items (tea, Nespresso...) on the FIRST turn
    // instead of pretending to have them. A menu edit is picked up on the next server start.
    try { agent.setMenu(await fetchMenuText(finalConfig.coffeeShopApiUrl)) } catch { /* shop API down -> agent still works via tool validation */ }

    // The QR card is now sent from the payment_complete handler (onStateChange) directly via
    // client.ws. We intentionally do NOT register a global setQRCodeCallback here: it is a
    // module-level singleton that cleanupClient() nulls on ANY disconnect, so after a reconnect it
    // silently stopped delivering the QR. tools.ts still prints the terminal QR; its UI callback is
    // simply unused now.

    // Send initial greeting to start the conversation
    await sendGreeting(client)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    sendMessage(client.ws, {
      type: "error",
      message: `Failed to start agent: ${errorMessage}`,
    })
  }
}

/**
 * Route user input based on session phase
 */
const routeUserInput = async (client: ClientState, text: string) => {
  await handleUserMessage(client, text)
}

// The core of one turn (translate in -> agent -> translate out -> display + speak), WITHOUT any
// busy management. Both the text and the voice handler own the `busy` flag and call this once they
// hold it, so the single SDK worker only ever serves one turn at a time.
const processTurn = async (client: ClientState, text: string) => {
  try {
    sendMessage(client.ws, { type: "processing_start", text })

    // No background "filler" chatter: the agent speaks ONLY a short acknowledgment when a tool
    // actually starts (via onToolCall -> speakToolFiller), then its real response.

    // Multilingual: the user spoke in their language; the agent reasons in English.
    // Translate the transcript X -> EN before handing it to the FSM agent.
    const lang = (client.config?.language || "en") as Lang
    const agentInput = lang === "en" ? text : await translateText(lang, "en", text)
    const result = await client.agent!.processMessage(agentInput)

    // Stop any pending tool-acknowledgment before the main response
    stopFillerSpeech(client)

    // The LLM now writes its response DIRECTLY in the spoken language (via the language directive
    // in the system prompt + setResponseLanguage), so NO machine-translation of the response.
    // Bergamot MT produced broken French ("Verrouillage dans les details", mixed tu/vous); the 8B
    // model writes fluent native text. Same string drives the on-screen text and the TTS audio.
    const outLang = (client.config?.language || "en") as Lang
    const displayResponse = result.response
    sendMessage(client.ws, {
      type: "llm_complete",
      text: displayResponse,
      complete: result.complete,
    })

    // Speak in the spoken language's voice. If a parallel TTS load was kicked off at language
    // detection (overlapping this turn's LLM work), await THAT instead of starting a new load.
    if (client.ttsPreload) {
      await client.ttsPreload
      client.ttsPreload = null
    }
    await ensureTtsLanguage(client, outLang)   // no-op if the preload already loaded this language
    await generateAndSendTTS(client, displayResponse)
  } catch (error) {
    stopFillerSpeech(client)
    const errorMessage = error instanceof Error ? error.message : String(error)
    sendMessage(client.ws, { type: "error", message: `Error processing message: ${errorMessage}` })
  }
}

const handleUserMessage = async (client: ClientState, text: string) => {
  if (!client.agent) {
    sendMessage(client.ws, {
      type: "error",
      message: "Agent not initialized. Please start the agent first.",
    })
    return
  }

  // Concurrency guard: the SDK has a single worker. If a message lands while the agent is still
  // processing/speaking the previous turn, both contend for the worker and it can hang. Drop the
  // new input and tell the UI to wait rather than risk a stuck worker.
  if (client.busy) {
    console.log(`[busy] ignoring input while a turn is in progress: ${JSON.stringify(text)}`)
    sendMessage(client.ws, {
      type: "busy",
      message: "One moment, I'm still finishing the previous response.",
    })
    return
  }
  client.busy = true
  try {
    await processTurn(client, text)
  } finally {
    client.busy = false
  }
}

const handleVoiceAudio = async (client: ClientState, audioBase64: string) => {
  if (!client.whisperModelId) {
    sendMessage(client.ws, {
      type: "error",
      message: "Whisper model not loaded",
    })
    return
  }

  // Same concurrency guard as text input: don't transcribe (which also uses the single worker)
  // while a turn is still in flight.
  if (client.busy) {
    console.log("[busy] ignoring voice input while a turn is in progress")
    sendMessage(client.ws, {
      type: "busy",
      message: "One moment, I'm still finishing the previous response.",
    })
    return
  }
  // Take the worker for the WHOLE voice turn: transcription uses the single SDK worker too, so we
  // must hold `busy` across STT + the turn, not just inside processTurn (otherwise a second mic tap
  // during transcription would contend and hang the worker).
  client.busy = true

  try {
    // The UI sends raw f32le @16k mono. Parakeet (parakeet-transcription) takes no audio_format at
    // load, so wrap the float samples into a self-describing 16k mono int16 WAV it can auto-detect.
    const f32buf = Buffer.from(audioBase64, "base64")
    const f32 = new Float32Array(f32buf.buffer, f32buf.byteOffset, Math.floor(f32buf.byteLength / 4))
    const pcm = Buffer.alloc(f32.length * 2)
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]))
      pcm.writeInt16LE(((s < 0 ? s * 32768 : s * 32767) | 0), i * 2)
    }
    const SR = 16000
    const wavHeader = Buffer.alloc(44)
    wavHeader.write("RIFF", 0); wavHeader.writeUInt32LE(36 + pcm.length, 4); wavHeader.write("WAVE", 8)
    wavHeader.write("fmt ", 12); wavHeader.writeUInt32LE(16, 16); wavHeader.writeUInt16LE(1, 20); wavHeader.writeUInt16LE(1, 22)
    wavHeader.writeUInt32LE(SR, 24); wavHeader.writeUInt32LE(SR * 2, 28); wavHeader.writeUInt16LE(2, 32); wavHeader.writeUInt16LE(16, 34)
    wavHeader.write("data", 36); wavHeader.writeUInt32LE(pcm.length, 40)
    const audioBuffer = Buffer.concat([wavHeader, pcm])

    sendMessage(client.ws, { type: "transcribing" })

    const text = await transcribe({
      modelId: client.whisperModelId,
      audioChunk: audioBuffer,
    })

    if (!text || text.includes("[BLANK_AUDIO]")) {
      sendMessage(client.ws, {
        type: "transcription_empty",
        message: "No speech detected",
      })
      return
    }

    // Strip leading + trailing quote marks the STT sometimes adds.
    const cleanedText = text.trim().replace(/^[\s"'«»‹›„‚‟“”‘’]+/, "").replace(/[\s"'«»‹›„‚‟“”‘’]+$/, "")

    // Auto-language: Parakeet doesn't return a language label, so infer it from the transcript and
    // make it the active language. Everything downstream (translate, TTS voice, fillers, display) reads
    // client.config.language, so setting it here is all that's needed to answer in the spoken language.
    // Language lock: lock the conversation language to the FIRST utterance that carries a real
    // language signal, then freeze it (no mid-order flips). A short ambiguous first word ("Serieux.",
    // a name) does NOT lock - we stay unlocked and keep detecting on the next turns until a confident
    // signal appears. This fixes the bug where an ambiguous first word locked the demo to English and
    // every later French sentence was answered in English.
    if (cleanedText && !client.langLocked) {
      const allowed: DetectedLang[] = ["en", "fr", "es", "it"]   // coffee demo: locked candidate set
      const detected = detectLangConfident(cleanedText, allowed)
      if (detected) {
        client.langLocked = true
        if (client.config && client.config.language !== detected) {
          client.config.language = detected as Lang
          client.language = detected as Lang
          sendMessage(client.ws, { type: "language_detected", language: detected })
        }
        // Make the agent REPLY in the detected language natively (no machine translation).
        client.agent?.setResponseLanguage?.(detected as any)
        // Kick off the per-language TTS (re)load NOW, in parallel with the LLM turn, so its ~5s
        // cold load overlaps the agent's reasoning instead of running after it. processTurn awaits
        // this handle before synth, so it never double-loads.
        if (client.ttsLang !== detected) {
          client.ttsPreload = ensureTtsLanguage(client, detected as Lang).catch(() => {})
        }
      }
    }

    sendMessage(client.ws, {
      type: "transcription_complete",
      text: cleanedText,
    })

    // We already hold `busy`, so call the turn core directly (NOT handleUserMessage, which would
    // try to take `busy` again and short-circuit).
    await processTurn(client, cleanedText)

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    sendMessage(client.ws, {
      type: "error",
      message: `Transcription error: ${errorMessage}`,
    })
  } finally {
    client.busy = false
  }
}

const handleReset = async (client: ClientState) => {
  if (!client.agent) {
    sendMessage(client.ws, {
      type: "error",
      message: "Agent not initialized",
    })
    return
  }

  // Don't reset mid-turn: a reset while a greeting/response is still synthesizing would enqueue a
  // second greeting and contend the single worker. Ask the user to wait, like the input guard.
  if (client.busy) {
    sendMessage(client.ws, {
      type: "busy",
      message: "One moment, I'm still finishing the previous response.",
    })
    return
  }

  // Stop any active filler speech and clear TTS queue
  stopFillerSpeech(client)
  client.ttsQueue = []
  client.ttsProcessing = false

  // Reset filler-related client state
  client.fillerActive = false
  client.fillerCount = 0
  client.usedFillerPhrases.clear()
  client.currentFillerContext = {}

  // Reset the agent (state, messages, session ID)
  client.agent.reset()

  // Reset the auto-detected language so a NEW chat re-detects from scratch. Otherwise a previous
  // French chat leaves the next chat locked to French (Thomas: spoke English after "New Chat",
  // got French). Back to the default; detection re-locks on the new chat's first confident utterance.
  client.langLocked = false
  client.ttsPreload = null
  if (client.config) client.config.language = "en" as Lang
  client.language = "en" as Lang
  client.agent.setResponseLanguage?.("en" as any)

  sendMessage(client.ws, {
    type: "agent_reset",
    state: client.agent.getState(),
  })

  // Send greeting to restart the conversation
  await sendGreeting(client)
}

// ============================================================================
// WebSocket Handler
// ============================================================================

const handleWebSocketMessage = async (ws: any, message: string) => {
  let client = clients.get(ws)
  if (!client) {
    client = initializeClient(ws)
  }

  try {
    const data = JSON.parse(message) as WSMessage

    switch (data.type) {
      case "get_config":
        handleGetConfig(client)
        break

      case "start":
        await handleStart(client, data.config as Partial<AgentConfig>)
        break

      case "user_message":
        await routeUserInput(client, data.text as string)
        break

      case "voice_audio":
        await handleVoiceAudio(client, data.audio as string)
        break

      case "reset":
        await handleReset(client)
        break

      case "get_state":
        if (client.agent) {
          sendMessage(ws, {
            type: "state_update",
            state: client.agent.getState(),
          })
        }
        break

      default:
        sendMessage(ws, {
          type: "error",
          message: `Unknown message type: ${data.type}`,
        })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    sendMessage(ws, {
      type: "error",
      message: `Failed to process message: ${errorMessage}`,
    })
  }
}

// ============================================================================
// Static File Serving
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
}

const serveStaticFile = (filePath: string): Response | null => {
  try {
    const fullPath = join(PUBLIC_DIR, filePath)

    // Must stay strictly inside PUBLIC_DIR (the trailing separator stops a sibling like
    // "public-secrets/" from passing a bare prefix check).
    if (fullPath !== PUBLIC_DIR && !fullPath.startsWith(PUBLIC_DIR + "/")) {
      return null
    }
    
    if (!existsSync(fullPath)) {
      return null
    }

    const content = readFileSync(fullPath)
    const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase()
    const contentType = MIME_TYPES[ext] || "application/octet-stream"

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        // Never cache the demo UI - the browser kept serving a stale agent-ui.css after edits,
        // which made fixed CSS look unfixed. Always revalidate so a plain reload shows the latest.
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    })
  } catch {
    return null
  }
}

// ============================================================================
// HTTP & WebSocket Server
// ============================================================================

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // local-only: never reachable from the network
  fetch(request, server) {
    const url = new URL(request.url)

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(request)
      if (upgraded) return undefined
      return new Response("WebSocket upgrade failed", { status: 400 })
    }

    // Serve agent UI
    if (url.pathname === "/" || url.pathname === "/agent-ui") {
      const file = serveStaticFile("agent-ui.html")
      if (file) return file
    }

    // Serve static files from /styles/ and root-level assets (fonts, images).
    if (url.pathname.startsWith("/styles/") || /^\/[\w.-]+\.(css|js|woff2?|png|svg|ico|jpg|jpeg)$/.test(url.pathname)) {
      const file = serveStaticFile(url.pathname)
      if (file) return file
    }

    // API info
    if (url.pathname === "/api/info") {
      return new Response(JSON.stringify({
        name: "Agent UI Server",
        version: "1.0.0",
        websocket: `ws://localhost:${PORT}/ws`,
      }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response("Not Found", { status: 404 })
  },
  websocket: {
    open(ws) {
      console.log("🔌 Client connected")
      initializeClient(ws)
    },
    message(ws, message) {
      handleWebSocketMessage(ws, message.toString())
    },
    close(ws) {
      console.log("🔌 Client disconnected")
      cleanupClient(ws)
    },
  },
})

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        Agent UI Server                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  HTTP Server:    http://localhost:${PORT}                                        ║
║  WebSocket:      ws://localhost:${PORT}/ws                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Open http://localhost:${PORT} in your browser to start                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)
