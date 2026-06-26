#!/bin/bash
# ============================================================================
# Setup Models Script
# ============================================================================
#
# Downloads required models and creates environment files for QVAC Coffee Assistant:
# - Qwen3-4B-Instruct GGUF model for LLM inference (~4.5GB)
# - Piper TTS voice models for text-to-speech (~140MB)
# - .env.qvac (QVAC agent config - used by: bun run qvac)
# - .env.coffee (Coffee Shop API config - used by: bun run api)
#
# This script is designed to be run as a postinstall hook.
# It's idempotent - already downloaded files and .env files are skipped.
#
# Usage:
#   ./scripts/setup-models.sh               # Full setup (models + env files)
#   ./scripts/setup-models.sh --skip-llm    # Skip LLM, download TTS only
#   ./scripts/setup-models.sh --skip-tts    # Skip TTS, download LLM only
#   ./scripts/setup-models.sh --skip-env    # Skip .env file creation
#   ./scripts/setup-models.sh --force-env   # Overwrite existing .env files
#   ./scripts/setup-models.sh --help        # Show help
#
# Environment variables:
#   SKIP_MODEL_DOWNLOAD=1  - Skip all model downloads
#   SKIP_LLM_DOWNLOAD=1    - Skip LLM model download
#   SKIP_TTS_DOWNLOAD=1    - Skip TTS voice downloads
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Model paths
MODELS_DIR="models"
LLM_MODEL_PATH="$MODELS_DIR/Qwen3-4B-Instruct-2507-Q8_0.gguf"
TTS_MODEL_DIR="$MODELS_DIR/tts"

# Hugging Face URLs (using Unsloth's public GGUF repo)
LLM_MODEL_URL="https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q8_0.gguf"
TTS_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# TTS voice paths (using simple variables for bash 3.x compatibility)
RYAN_MODEL_PATH="en/en_US/ryan/high/en_US-ryan-high.onnx"
RYAN_CONFIG_PATH="en/en_US/ryan/high/en_US-ryan-high.onnx.json"
SEMAINE_MODEL_PATH="en/en_GB/semaine/medium/en_GB-semaine-medium.onnx"
SEMAINE_CONFIG_PATH="en/en_GB/semaine/medium/en_GB-semaine-medium.onnx.json"

# ============================================================================
# Utility Functions
# ============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}              QVAC Coffee Assistant - Model Setup                    ${BLUE}║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${YELLOW}━━━ $1 ━━━${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_skip() {
    echo -e "${YELLOW}⊘${NC} $1"
}

print_download() {
    echo -e "${BLUE}⬇${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Downloads required models and creates environment files for QVAC Coffee Assistant."
    echo ""
    echo "Options:"
    echo "  --skip-llm    Skip LLM model download"
    echo "  --skip-tts    Skip TTS voice downloads"
    echo "  --skip-env    Skip .env file creation"
    echo "  --force-env   Overwrite existing .env files"
    echo "  --help        Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  SKIP_MODEL_DOWNLOAD=1  Skip all model downloads"
    echo "  SKIP_LLM_DOWNLOAD=1    Skip LLM model download"
    echo "  SKIP_TTS_DOWNLOAD=1    Skip TTS voice downloads"
    echo ""
    echo "Models downloaded:"
    echo "  - Qwen3-4B-Instruct GGUF (~4.5GB) - LLM for natural language understanding"
    echo "  - Piper TTS voices (~140MB) - Neural text-to-speech"
    echo ""
    echo "Environment files created:"
    echo "  - .env.qvac   - QVAC agent settings (bun run qvac)"
    echo "  - .env.qvac   - QVAC agent settings (bun run qvac-api)"
    echo "  - .env.coffee - Coffee Shop API settings (bun run ui)"
    echo "  - .env.coffee - Coffee Shop API settings (bun run coffee-api)"
    echo ""
}

# Format bytes to human readable
format_bytes() {
    local bytes=$1
    if [ "$bytes" -lt 1024 ]; then
        echo "${bytes} B"
    elif [ "$bytes" -lt $((1024 * 1024)) ]; then
        echo "$(echo "scale=1; $bytes / 1024" | bc) KB"
    elif [ "$bytes" -lt $((1024 * 1024 * 1024)) ]; then
        echo "$(echo "scale=1; $bytes / 1024 / 1024" | bc) MB"
    else
        echo "$(echo "scale=2; $bytes / 1024 / 1024 / 1024" | bc) GB"
    fi
}

# Download file with progress
download_file() {
    local url="$1"
    local dest="$2"
    local label="$3"

    if [ -f "$dest" ]; then
        local size=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null || echo "0")
        print_success "$label already exists ($(format_bytes $size)), skipping"
        return 0
    fi

    print_download "Downloading $label..."

    # Create parent directory if needed
    mkdir -p "$(dirname "$dest")"

    # Use curl with progress bar
    if curl -L --progress-bar -o "$dest" "$url"; then
        local size=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null || echo "0")
        print_success "Downloaded $label ($(format_bytes $size))"
        return 0
    else
        print_error "Failed to download $label"
        rm -f "$dest"
        return 1
    fi
}

# ============================================================================
# Main Functions
# ============================================================================

download_llm() {
    print_section "LLM Model (Qwen3-4B-Instruct)"

    if [ "${SKIP_LLM_DOWNLOAD:-0}" = "1" ] || [ "$SKIP_LLM" = "1" ]; then
        print_skip "Skipping LLM download (SKIP_LLM_DOWNLOAD=1)"
        return 0
    fi

    echo "  Model: Qwen3-4B-Instruct (Q8_0 quantized)"
    echo "  Size:  ~4.5 GB"
    echo "  Path:  $LLM_MODEL_PATH"
    echo ""

    download_file "$LLM_MODEL_URL" "$LLM_MODEL_PATH" "Qwen3-4B-Instruct model"
}

download_tts() {
    print_section "TTS Voice Models (Piper)"

    if [ "${SKIP_TTS_DOWNLOAD:-0}" = "1" ] || [ "$SKIP_TTS" = "1" ]; then
        print_skip "Skipping TTS download (SKIP_TTS_DOWNLOAD=1)"
        return 0
    fi

    echo "  Voices: Ryan (US English) + Semaine (UK English)"
    echo "  Size:   ~140 MB total"
    echo "  Path:   $TTS_MODEL_DIR/"
    echo ""

    mkdir -p "$TTS_MODEL_DIR"

    # Download Ryan voice
    echo -e "  ${YELLOW}Ryan voice${NC} (US English male, warm/friendly)"
    download_file "${TTS_BASE_URL}/${RYAN_MODEL_PATH}?download=true" \
        "$TTS_MODEL_DIR/en_US-ryan-high.onnx" \
        "Ryan model"
    download_file "${TTS_BASE_URL}/${RYAN_CONFIG_PATH}?download=true" \
        "$TTS_MODEL_DIR/en_US-ryan-high.onnx.json" \
        "Ryan config"

    echo ""

    # Download Semaine voice
    echo -e "  ${YELLOW}Semaine voice${NC} (UK English female, expressive)"
    download_file "${TTS_BASE_URL}/${SEMAINE_MODEL_PATH}?download=true" \
        "$TTS_MODEL_DIR/en_GB-semaine-medium.onnx" \
        "Semaine model"
    download_file "${TTS_BASE_URL}/${SEMAINE_CONFIG_PATH}?download=true" \
        "$TTS_MODEL_DIR/en_GB-semaine-medium.onnx.json" \
        "Semaine config"
}

print_complete() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}  ✅ Setup complete!                                                 ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                                     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Configuration files:                                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    .env.qvac   - QVAC agent config (TTS, LLM, voice)                ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    .env.coffee - Coffee shop API config (payments, menu)            ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                                     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Run both servers:                                                  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    bun run api       - Start Coffee Shop API (uses .env.coffee)     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    bun run qvac      - Start QVAC agent (uses .env.qvac)            ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                                     ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ============================================================================
# Environment File Creation
# ============================================================================

create_env_qvac() {
    print_section "Creating .env.qvac (QVAC Agent Config)"

    if [ -f ".env.qvac" ] && [ "$FORCE_ENV" != "1" ]; then
        print_success ".env.qvac already exists, skipping (use --force-env to overwrite)"
        return 0
    fi

    if [ ! -f ".envBTC" ]; then
        print_error ".envBTC not found, cannot create .env.qvac"
        return 1
    fi

    cp .envBTC .env.qvac
    print_success "Created .env.qvac (copied from .envBTC)"
}

create_env_coffee() {
    print_section "Creating .env.coffee (Coffee Shop API Config)"

    if [ -f ".env.coffee" ] && [ "$FORCE_ENV" != "1" ]; then
        print_success ".env.coffee already exists, skipping (use --force-env to overwrite)"
        return 0
    fi

    if [ ! -f ".env.example" ]; then
        print_error ".env.example not found, cannot create .env.coffee"
        return 1
    fi

    cp .env.example .env.coffee
    print_success "Created .env.coffee (copied from .env.example)"
}

create_env_files() {
    if [ "$SKIP_ENV" = "1" ]; then
        print_skip "Skipping .env file creation (--skip-env)"
        return 0
    fi

    create_env_qvac
    create_env_coffee

    echo ""
    echo -e "  ${YELLOW}Note:${NC} Edit these files to customize your configuration:"
    echo -e "  ${BLUE}.env.qvac${NC}   - QVAC agent (bun run qvac) - copied from .envBTC"
    echo -e "  ${BLUE}.env.coffee${NC} - Coffee Shop API (bun run api) - copied from .env.example"
}

# ============================================================================
# Main Entry Point
# ============================================================================

main() {
    # Parse arguments
    SKIP_LLM=0
    SKIP_TTS=0
    SKIP_ENV=0
    FORCE_ENV=0

    for arg in "$@"; do
        case $arg in
            --skip-llm)
                SKIP_LLM=1
                ;;
            --skip-tts)
                SKIP_TTS=1
                ;;
            --skip-env)
                SKIP_ENV=1
                ;;
            --force-env)
                FORCE_ENV=1
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $arg"
                show_help
                exit 1
                ;;
        esac
    done

    # Check if all downloads should be skipped
    if [ "${SKIP_MODEL_DOWNLOAD:-0}" = "1" ]; then
        echo -e "${YELLOW}⊘${NC} Skipping all model downloads (SKIP_MODEL_DOWNLOAD=1)"
        exit 0
    fi

    print_header

    # Ensure we're in the right directory
    if [ ! -f "package.json" ]; then
        echo -e "${RED}Error: package.json not found. Run this script from the project root.${NC}"
        exit 1
    fi

    # Create models directory
    mkdir -p "$MODELS_DIR"

    # Download models
    download_llm
    download_tts

    # Create environment files
    create_env_files

    print_complete
}

main "$@"
