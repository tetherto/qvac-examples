#!/usr/bin/env bun
// ============================================================================
// Download Piper TTS Voice Models
// ============================================================================
//
// Downloads high-quality Piper TTS voices from Hugging Face:
// - Ryan (en_US-ryan-high) - US English male, warm/friendly
// - Semaine (en_GB-semaine-medium) - British English female, expressive
//
// Usage:
//   bun run scripts/download-tts-voices.ts
//   bun run scripts/download-tts-voices.ts --voice ryan
//   bun run scripts/download-tts-voices.ts --voice semaine
//   bun run scripts/download-tts-voices.ts --voice all
//
// ============================================================================

import { existsSync, mkdirSync, createWriteStream } from "fs"
import { join } from "path"

// ============================================================================
// Voice Definitions
// ============================================================================

interface VoiceModel {
  name: string
  description: string
  locale: string
  quality: string
  files: {
    model: string
    config: string
  }
  urls: {
    model: string
    config: string
  }
}

const HUGGINGFACE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

const VOICES: Record<string, VoiceModel> = {
  ryan: {
    name: "Ryan",
    description: "US English male, warm and friendly tone",
    locale: "en_US",
    quality: "high",
    files: {
      model: "en_US-ryan-high.onnx",
      config: "en_US-ryan-high.onnx.json",
    },
    urls: {
      model: `${HUGGINGFACE_BASE}/en/en_US/ryan/high/en_US-ryan-high.onnx?download=true`,
      config: `${HUGGINGFACE_BASE}/en/en_US/ryan/high/en_US-ryan-high.onnx.json?download=true`,
    },
  },
  semaine: {
    name: "Semaine",
    description: "British English female, expressive and clear",
    locale: "en_GB",
    quality: "medium",
    files: {
      model: "en_GB-semaine-medium.onnx",
      config: "en_GB-semaine-medium.onnx.json",
    },
    urls: {
      model: `${HUGGINGFACE_BASE}/en/en_GB/semaine/medium/en_GB-semaine-medium.onnx?download=true`,
      config: `${HUGGINGFACE_BASE}/en/en_GB/semaine/medium/en_GB-semaine-medium.onnx.json?download=true`,
    },
  },
}

// ============================================================================
// Download Utilities
// ============================================================================

const TTS_MODEL_DIR = join(process.cwd(), "models", "tts")

const ensureDirectory = (dir: string): void => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`📁 Created directory: ${dir}`)
  }
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const downloadFile = async (url: string, destPath: string, label: string): Promise<void> => {
  if (existsSync(destPath)) {
    console.log(`   ✓ ${label} already exists, skipping`)
    return
  }

  console.log(`   ⬇ Downloading ${label}...`)
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "qvac-coffee-assistant/1.0",
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download ${label}: ${response.status} ${response.statusText}`)
  }

  const contentLength = response.headers.get("content-length")
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Failed to get response reader")
  }

  const file = Bun.file(destPath)
  const writer = file.writer()

  let downloadedBytes = 0
  let lastProgress = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    writer.write(value)
    downloadedBytes += value.length

    if (totalBytes > 0) {
      const progress = Math.floor((downloadedBytes / totalBytes) * 100)
      if (progress >= lastProgress + 10) {
        process.stdout.write(`\r   ⬇ Downloading ${label}... ${progress}% (${formatBytes(downloadedBytes)})`)
        lastProgress = progress
      }
    }
  }

  await writer.end()
  console.log(`\r   ✓ Downloaded ${label} (${formatBytes(downloadedBytes)})                    `)
}

const downloadVoice = async (voiceId: string): Promise<void> => {
  const voice = VOICES[voiceId]
  if (!voice) {
    throw new Error(`Unknown voice: ${voiceId}. Available: ${Object.keys(VOICES).join(", ")}`)
  }

  console.log(`\n🎤 Downloading ${voice.name} voice (${voice.locale}, ${voice.quality} quality)`)
  console.log(`   ${voice.description}`)

  const modelPath = join(TTS_MODEL_DIR, voice.files.model)
  const configPath = join(TTS_MODEL_DIR, voice.files.config)

  await downloadFile(voice.urls.model, modelPath, voice.files.model)
  await downloadFile(voice.urls.config, configPath, voice.files.config)

  console.log(`   ✅ ${voice.name} voice ready!`)
}

// ============================================================================
// Main
// ============================================================================

const printUsage = () => {
  console.log(`
Usage: bun run scripts/download-tts-voices.ts [--voice <name>]

Options:
  --voice <name>   Download specific voice: ryan, semaine, or all (default: all)

Available voices:
`)
  for (const [id, voice] of Object.entries(VOICES)) {
    console.log(`  ${id.padEnd(10)} - ${voice.name} (${voice.locale}, ${voice.quality})`)
    console.log(`              ${voice.description}`)
  }
  console.log(`
  all        - Download all voices

Example:
  bun run scripts/download-tts-voices.ts --voice ryan
`)
}

const main = async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              Piper TTS Voice Model Downloader                        ║
╚══════════════════════════════════════════════════════════════════════╝
`)

  // Parse arguments
  const args = process.argv.slice(2)
  let voiceArg = "all"

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--voice" && args[i + 1]) {
      voiceArg = args[i + 1]!
      i++
    } else if (args[i] === "--help" || args[i] === "-h") {
      printUsage()
      process.exit(0)
    }
  }

  // Ensure directory exists
  ensureDirectory(TTS_MODEL_DIR)
  console.log(`📂 Model directory: ${TTS_MODEL_DIR}`)

  // Download voices
  if (voiceArg === "all") {
    for (const voiceId of Object.keys(VOICES)) {
      await downloadVoice(voiceId)
    }
  } else {
    await downloadVoice(voiceArg)
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ✅ Download complete!                                               ║
║                                                                      ║
║  To use a voice, set the TTS_VOICE environment variable:             ║
║    export TTS_VOICE=ryan                                             ║
║    export TTS_VOICE=semaine                                          ║
║                                                                      ║
║  Then run: bun run dev                                               ║
╚══════════════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`)
  process.exit(1)
})
