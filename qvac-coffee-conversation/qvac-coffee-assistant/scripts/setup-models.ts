#!/usr/bin/env bun
// ============================================================================
// Setup Models Script (Cross-Platform)
// ============================================================================
//
// Downloads required models for the QVAC Coffee Assistant:
// - Qwen3-4B-Instruct GGUF model for LLM inference (~4.5GB)
// - Piper TTS voice models for text-to-speech (~140MB)
//
// This script is designed to be run as a postinstall hook.
// It's idempotent - already downloaded files are skipped.
//
// Usage:
//   bun run scripts/setup-models.ts           # Download all models
//   bun run scripts/setup-models.ts --skip-llm    # Skip LLM, download TTS only
//   bun run scripts/setup-models.ts --skip-tts    # Skip TTS, download LLM only
//   bun run scripts/setup-models.ts --skip-env    # Skip .env file creation
//   bun run scripts/setup-models.ts --force-env   # Overwrite existing .env files
//   bun run scripts/setup-models.ts --help        # Show help
//
// Environment variables:
//   SKIP_MODEL_DOWNLOAD=1  - Skip all model downloads
//   SKIP_LLM_DOWNLOAD=1    - Skip LLM model download
//   SKIP_TTS_DOWNLOAD=1    - Skip TTS voice downloads
//
// ============================================================================

import { existsSync, mkdirSync, statSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get project root (script is in qvac-coffee-assistant/scripts/)
const __filename = fileURLToPath(import.meta.url);
const scriptDir = dirname(__filename);
const projectRoot = dirname(scriptDir);

// Model paths
const MODELS_DIR = join(projectRoot, 'models');
const LLM_MODEL_PATH = join(MODELS_DIR, 'Qwen3-4B-Instruct-2507-Q8_0.gguf');
const TTS_MODEL_DIR = join(MODELS_DIR, 'tts');

// Hugging Face URLs
const LLM_MODEL_URL = 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q8_0.gguf';
const TTS_BASE_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

// TTS voice paths
const VOICES = {
  ryan: {
    model: 'en/en_US/ryan/high/en_US-ryan-high.onnx',
    config: 'en/en_US/ryan/high/en_US-ryan-high.onnx.json',
  },
  semaine: {
    model: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx',
    config: 'en/en_GB/semaine/medium/en_GB-semaine-medium.onnx.json',
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

function printHeader() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              QVAC Coffee Assistant - Model Setup                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');
}

function printSection(text: string) {
  console.log('');
  console.log(`━━━ ${text} ━━━`);
}

function printSuccess(text: string) {
  console.log(`✓ ${text}`);
}

function printSkip(text: string) {
  console.log(`⊘ ${text}`);
}

function printDownload(text: string) {
  console.log(`⬇ ${text}`);
}

function printError(text: string) {
  console.error(`✗ ${text}`);
}

function showHelp() {
  console.log('Usage: bun run scripts/setup-models.ts [OPTIONS]');
  console.log('');
  console.log('Downloads required models for QVAC Coffee Assistant.');
  console.log('');
  console.log('Options:');
  console.log('  --skip-llm    Skip LLM model download');
  console.log('  --skip-tts    Skip TTS voice downloads');
  console.log('  --skip-env    Skip .env file creation');
  console.log('  --force-env   Overwrite existing .env files');
  console.log('  --help        Show this help message');
  console.log('');
  console.log('Environment variables:');
  console.log('  SKIP_MODEL_DOWNLOAD=1  Skip all model downloads');
  console.log('  SKIP_LLM_DOWNLOAD=1    Skip LLM model download');
  console.log('  SKIP_TTS_DOWNLOAD=1    Skip TTS voice downloads');
  console.log('');
  console.log('Models downloaded:');
  console.log('  - Qwen3-4B-Instruct GGUF (~4.5GB) - LLM for natural language understanding');
  console.log('  - Piper TTS voices (~140MB) - Neural text-to-speech');
  console.log('');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function downloadFile(url: string, dest: string, label: string): Promise<boolean> {
  if (existsSync(dest)) {
    const stats = statSync(dest);
    printSuccess(`${label} already exists (${formatBytes(stats.size)}), skipping`);
    return true;
  }

  printDownload(`Downloading ${label}...`);

  // Create parent directory if needed
  const dir = dirname(dest);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await Bun.write(dest, buffer);

    const stats = statSync(dest);
    printSuccess(`Downloaded ${label} (${formatBytes(stats.size)})`);
    return true;
  } catch (error) {
    printError(`Failed to download ${label}: ${error}`);
    if (existsSync(dest)) {
      await Bun.write(dest, ''); // Clear failed download
    }
    return false;
  }
}

// ============================================================================
// Main Functions
// ============================================================================

async function downloadLLM(skipLLM: boolean): Promise<boolean> {
  printSection('LLM Model (Qwen3-4B-Instruct)');

  if (process.env.SKIP_LLM_DOWNLOAD === '1' || skipLLM) {
    printSkip('Skipping LLM download (SKIP_LLM_DOWNLOAD=1 or --skip-llm)');
    return true;
  }

  console.log('  Model: Qwen3-4B-Instruct (Q8_0 quantized)');
  console.log('  Size:  ~4.5 GB');
  console.log(`  Path:  ${LLM_MODEL_PATH}`);
  console.log('');

  return await downloadFile(LLM_MODEL_URL, LLM_MODEL_PATH, 'Qwen3-4B-Instruct model');
}

async function downloadTTS(skipTTS: boolean): Promise<boolean> {
  printSection('TTS Voice Models (Piper)');

  if (process.env.SKIP_TTS_DOWNLOAD === '1' || skipTTS) {
    printSkip('Skipping TTS download (SKIP_TTS_DOWNLOAD=1 or --skip-tts)');
    return true;
  }

  console.log('  Voices: Ryan (US English) + Semaine (UK English)');
  console.log('  Size:   ~140 MB total');
  console.log(`  Path:   ${TTS_MODEL_DIR}/`);
  console.log('');

  if (!existsSync(TTS_MODEL_DIR)) {
    mkdirSync(TTS_MODEL_DIR, { recursive: true });
  }

  // Download Ryan voice
  console.log('  Ryan voice (US English male, warm/friendly)');
  const ryan1 = await downloadFile(
    `${TTS_BASE_URL}/${VOICES.ryan.model}?download=true`,
    join(TTS_MODEL_DIR, 'en_US-ryan-high.onnx'),
    'Ryan model'
  );
  const ryan2 = await downloadFile(
    `${TTS_BASE_URL}/${VOICES.ryan.config}?download=true`,
    join(TTS_MODEL_DIR, 'en_US-ryan-high.onnx.json'),
    'Ryan config'
  );

  console.log('');

  // Download Semaine voice
  console.log('  Semaine voice (UK English female, expressive)');
  const semaine1 = await downloadFile(
    `${TTS_BASE_URL}/${VOICES.semaine.model}?download=true`,
    join(TTS_MODEL_DIR, 'en_GB-semaine-medium.onnx'),
    'Semaine model'
  );
  const semaine2 = await downloadFile(
    `${TTS_BASE_URL}/${VOICES.semaine.config}?download=true`,
    join(TTS_MODEL_DIR, 'en_GB-semaine-medium.onnx.json'),
    'Semaine config'
  );

  return ryan1 && ryan2 && semaine1 && semaine2;
}

async function createEnvFiles(skipEnv: boolean, forceEnv: boolean): Promise<boolean> {
  if (skipEnv) {
    printSkip('Skipping .env file creation (--skip-env)');
    return true;
  }

  printSection('Creating Environment Files');
  
  const envQvac = join(projectRoot, '.env.qvac');
  const envCoffee = join(projectRoot, '.env.coffee');
  const envBTC = join(projectRoot, '.envBTC');
  const envExample = join(projectRoot, '.env.example');
  
  let success = true;

  // Create .env.qvac from .envBTC
  if (existsSync(envQvac) && !forceEnv) {
    printSuccess('.env.qvac already exists, skipping (use --force-env to overwrite)');
  } else if (!existsSync(envBTC)) {
    printError('.envBTC not found, cannot create .env.qvac');
    success = false;
  } else {
    copyFileSync(envBTC, envQvac);
    printSuccess('Created .env.qvac (copied from .envBTC)');
  }

  // Create .env.coffee from .env.example
  if (existsSync(envCoffee) && !forceEnv) {
    printSuccess('.env.coffee already exists, skipping (use --force-env to overwrite)');
  } else if (!existsSync(envExample)) {
    printError('.env.example not found, cannot create .env.coffee');
    success = false;
  } else {
    copyFileSync(envExample, envCoffee);
    printSuccess('Created .env.coffee (copied from .env.example)');
  }

  console.log('\n  Note: Edit these files to customize your configuration:');
  console.log('  .env.qvac   - QVAC agent (bun run qvac)');
  console.log('  .env.coffee - Coffee Shop API (bun run api)');

  return success;
}

function printComplete() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ Setup complete!                                                 ║');
  console.log('║                                                                     ║');
  console.log('║  Configuration files:                                               ║');
  console.log('║    .env.qvac   - QVAC agent config (TTS, LLM, voice)                ║');
  console.log('║    .env.coffee - Coffee shop API config (payments, menu)            ║');
  console.log('║                                                                     ║');
  console.log('║  Run both servers:                                                  ║');
  console.log('║    bun run api       - Start Coffee Shop API (uses .env.coffee)     ║');
  console.log('║    bun run qvac      - Start QVAC agent (uses .env.qvac)            ║');
  console.log('║                                                                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  let skipLLM = false;
  let skipTTS = false;
  let skipEnv = false;
  let forceEnv = false;

  // Parse arguments
  for (const arg of args) {
    switch (arg) {
      case '--skip-llm':
        skipLLM = true;
        break;
      case '--skip-tts':
        skipTTS = true;
        break;
      case '--skip-env':
        skipEnv = true;
        break;
      case '--force-env':
        forceEnv = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
      default:
        console.error(`Unknown option: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }

  // Check if all downloads should be skipped
  if (process.env.SKIP_MODEL_DOWNLOAD === '1') {
    printSkip('Skipping all model downloads (SKIP_MODEL_DOWNLOAD=1)');
    process.exit(0);
  }

  printHeader();

  // Ensure we're in the right directory
  const packageJsonPath = join(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    printError('Error: package.json not found. Run this script from the project root.');
    process.exit(1);
  }

  // Create models directory
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  // Download models
  const llmSuccess = await downloadLLM(skipLLM);
  const ttsSuccess = await downloadTTS(skipTTS);

  if (!llmSuccess || !ttsSuccess) {
    printError('Some downloads failed. Please check your internet connection and try again.');
    process.exit(1);
  }

  // Create environment files
  const envSuccess = await createEnvFiles(skipEnv, forceEnv);
  if (!envSuccess) {
    printError('Failed to create some environment files.');
    process.exit(1);
  }

  printComplete();
}

main().catch((error) => {
  printError(`Unexpected error: ${error}`);
  process.exit(1);
});
