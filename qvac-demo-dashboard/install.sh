#!/bin/bash
# QVAC Demo Dashboard: set up a new Mac in one command, then start the dashboard.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tetherto/qvac-examples/main/qvac-demo-dashboard/install.sh)"
#
# Installs what is missing (Homebrew, Node.js, ffmpeg, OpenSSL 3, the QVAC CLI), downloads this repository to
# ~/qvac-examples, runs `npm run setup` (every demo and its models) and starts the dashboard.
# Safe to run again: finished steps are skipped and interrupted downloads resume.
#
# Options, as environment variables:
#   QVAC_DEMO_DIR=/path      where to put the repository (default: ~/qvac-examples)
#   QVAC_DEMO_NO_SETUP=1     stop before `npm run setup`
#   QVAC_DEMO_NO_START=1     do not start the dashboard at the end

set -euo pipefail

DIR="${QVAC_DEMO_DIR:-$HOME/qvac-examples}"
REPO="https://github.com/tetherto/qvac-examples.git"
NEED_GB=55

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nStopped: %s\n' "$1" >&2; exit 1; }
retry() {  # a flaky connection (event Wi-Fi) should not end the install on the first reset
  local n
  for n in 1 2 3; do
    "$@" && return 0
    [ "$n" = 3 ] || { echo "Failed, trying again in 5 s ($n of 3)."; sleep 5; }
  done
  return 1
}

# 1. This Mac
[ "$(uname -s)" = Darwin ] || fail "this kit runs on macOS only."
[ "$(uname -m)" = arm64 ] || fail "this kit needs a Mac with Apple Silicon (M1 or newer)."
macos=$(sw_vers -productVersion)
[ "${macos%%.*}" -ge 14 ] || fail "macOS 14 or newer is needed, this Mac runs macOS $macos."
ram_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
[ "$ram_gb" -ge 16 ] || fail "16 GB of memory or more is needed, this Mac has $ram_gb GB."
free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if [ ! -d "$DIR/qvac-demo-dashboard" ] && [ "$free_gb" -lt "$NEED_GB" ]; then
  fail "about $NEED_GB GB of free disk is needed, this Mac has $free_gb GB free."
fi
echo "Mac: macOS $macos, $ram_gb GB of memory, $free_gb GB free."

# 2. Homebrew (its installer also installs the Xcode Command Line Tools, which bring git)
if ! command -v brew >/dev/null 2>&1; then
  if [ ! -x /opt/homebrew/bin/brew ]; then
    step "Installing Homebrew. Press Return when it asks, then type this Mac's password."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  eval "$(/opt/homebrew/bin/brew shellenv)"
  if ! grep -qs 'brew shellenv' "$HOME/.zprofile"; then
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
fi
git --version >/dev/null 2>&1 || fail "git does not work. Run: xcode-select --install
  If Xcode is installed and was just updated, run: sudo xcodebuild -license accept"

# 3. Node.js 22.17 or newer, and ffmpeg
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 17) ? 0 : 1)'
}
if ! node_ok; then
  step "Installing Node.js"
  brew install node
  hash -r
fi
node_ok || fail "Node.js 22.17 or newer is needed, and $(command -v node) is $(node --version).
  Remove the older one or put $(brew --prefix)/bin first in your PATH, then run this again."
if ! command -v ffmpeg >/dev/null 2>&1; then
  step "Installing ffmpeg"
  brew install ffmpeg
fi
# The LLM addon of the older demos (SDK 0.13 and 0.16) loads Homebrew's OpenSSL from this exact path.
if [ ! -e /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib ]; then
  step "Installing OpenSSL 3"
  brew install openssl@3
fi

# 4. The QVAC CLI (Afri Translate loads the SDK from it)
if ! command -v qvac >/dev/null 2>&1; then
  step "Installing the QVAC CLI"
  npm install -g @qvac/cli || fail "npm could not install @qvac/cli globally. If it says EACCES, your Node.js
  was not installed by Homebrew: run 'brew install node' and put $(brew --prefix)/bin first in your PATH."
  hash -r
fi
echo "Tools: node $(node --version), $(ffmpeg -version | head -1 | cut -d' ' -f1-3), qvac at $(command -v qvac)."

# 5. This repository
if [ -d "$DIR/.git" ]; then
  step "Updating $DIR"
  git -C "$DIR" pull --ff-only || echo "Could not update $DIR (offline, or local changes). Carrying on with the copy on disk."
elif [ -e "$DIR" ]; then
  fail "$DIR already exists and is not a copy of qvac-examples. Move it away, or pick another folder:
  QVAC_DEMO_DIR=~/somewhere-else and the same command."
else
  step "Downloading qvac-examples to $DIR"
  retry git clone --depth 1 "$REPO" "$DIR" || fail "could not download $REPO. Check the connection and run the same command again."
fi
cd "$DIR/qvac-demo-dashboard"

# 6. Every demo and its models
if [ "${QVAC_DEMO_NO_SETUP:-}" = 1 ]; then
  echo "Skipping npm run setup (QVAC_DEMO_NO_SETUP=1)."
else
  step "Installing the demos and downloading their models (about $NEED_GB GB, this takes a while)"
  npm run setup || fail "some demos are not ready, see the MISSING lines above. Fix them and run the
  same command again: finished work is skipped and downloads resume."
fi

# 7. Start
echo
echo "Next time, start the dashboard with:"
echo "  cd \"$DIR/qvac-demo-dashboard\" && npm start"
if [ "${QVAC_DEMO_NO_START:-}" = 1 ]; then
  exit 0
fi
step "Starting the dashboard at http://localhost:8400 (Ctrl+C stops it and every demo)"
exec npm start
