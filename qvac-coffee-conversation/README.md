# QVAC Coffee Conversation

A fully local, voice-driven coffee ordering agent built with the [QVAC SDK](https://www.npmjs.com/package/@qvac/sdk), with a real Bitcoin Lightning payment settled through Tether's [WDK](https://docs.wdk.tether.io). You talk to it, it takes your order, and it pays a real Lightning invoice. Everything (speech to text, the agent LLM, translation, text to speech) runs on your device. No cloud, no API keys.

## What it shows

- **On-device voice pipeline:** microphone -> speech to text (Parakeet) -> language detection -> translation (Bergamot) -> ordering agent (Qwen3) -> text to speech (Chatterbox). All via one `@qvac/sdk` install.
- **Agentic ordering:** the LLM drives a typed order state machine through tool calls (menu, quote, create order, pay).
- **Real payment:** the order is paid over the Lightning Network via WDK's Spark wallet (Bitcoin L2). A mock mode is the default so you can run the whole thing without moving any funds.
- **Multilingual:** speak in your language, the agent understands and replies in it (spoken output is English, Spanish, German, or Italian).

## Requirements

- **[Bun](https://bun.sh)** (the servers run on Bun): `curl -fsSL https://bun.sh/install | bash`
- **Node 18+** (only to launch the two servers)
- **Apple Silicon Mac, running native arm64** (see Troubleshooting). Also works on Linux.
- **~4 GB free disk** for the models, downloaded once on first run into `~/.qvac`.

## Quick start (mock mode, nothing to configure)

```bash
git clone https://github.com/tetherto/qvac-examples.git
cd qvac-examples/qvac-coffee-conversation/qvac-coffee-assistant
bun install
cd ..
node server.js
```

Then open **http://localhost:3461**, click **Start**, wait for the models to load (first run downloads them, ~1-2 min), then tap the mic and order a coffee out loud (for example "I'd like a cappuccino for pickup").

That is it. In mock mode a placeholder invoice is shown and **no real funds move**, so it is safe to demo immediately.

The launcher starts three local servers:

| Port | Service |
|---|---|
| **3461** | Conversation UI (open this) |
| **3462** | Coffee shop API |
| **3470** | Order receipt site (opened by the QR code) |

## Payment modes

The demo has two modes, controlled by `USE_REAL_PAYMENTS` in the `.env`:

- **Mock (default):** a placeholder Lightning invoice is shown, any proof is accepted, nothing moves on chain. This is the safe default for a UI demo. No wallet needed.
- **Real (mainnet Lightning):** a genuine Lightning invoice is minted and paid from a real Spark wallet. Requires a funded wallet seed (see Wallets).

## Configuration: the `.env`

Copy the template and edit it:

```bash
cd qvac-coffee-assistant
cp .env.example .env
```

Key settings:

```bash
# --- Payment mode ---
USE_REAL_PAYMENTS=false     # false = mock (safe default). true = real Lightning.

# --- Real payments (only read when USE_REAL_PAYMENTS=true) ---
PAYMENT_NETWORK=LIGHTNING
NETWORK_MODE=mainnet        # mainnet for real sats
SPARK_NETWORK=MAINNET       # Spark networks: MAINNET / SIGNET / REGTEST. There is NO "testnet".
WDK_SEED_PHRASE=...         # 12-word seed of the wallet (see Wallets). NEVER commit this.

# --- Pricing ---
SATS_PER_USD=1000           # fixed demo rate: 1 USD = 1000 sats (not a live market rate)

# --- Agent LLM ---
AGENT_LLM=4b                # 4b (Qwen3 4B, default) | 8b (Qwen3 8B) | 35b (Qwen3.6 35B-A3B, needs 32GB+ RAM)

# --- QR / receipt ---
ENABLE_QR_CODE=true
```

Bun auto-loads `.env` from `qvac-coffee-assistant/`.

## Wallets (for real payments)

The payment is a **proof-of-payment demo**, not real commerce. Both sides of the payment are derived from **one** seed (`WDK_SEED_PHRASE`):

| Role | Derivation | What it does |
|---|---|---|
| **Customer** | Spark account **index 0** | Pays the invoice |
| **Shop** | Spark account **index 1** | Receives the invoice |

Because both accounts come from the same seed, the sats flow customer (0) -> shop (1) and stay inside the same wallet. To run real payments you only need to **fund the customer account (index 0)**. Each coffee is 50 to 60 sats.

Providing the seed:

- Set `WDK_SEED_PHRASE` in the `.env` (a 12-word BIP39 phrase). The wallet then travels entirely in the `.env`, no seed file needed.
- Use `SPARK_NETWORK=MAINNET` for real sats.
- If `WDK_SEED_PHRASE` is unset, a fresh (unfunded) seed is generated into `data/tether-wdk-seed.json` on first run, so real payments fail with "insufficient funds" until you fund it.

> **Security:** never commit a seed phrase to a public repo (a BIP39 seed derives mainnet keys and gets scraped by bots). The `.env` is gitignored on purpose. Tether team members: use the shared funded `.env` provided privately rather than generating your own.

## Models

All models are downloaded once to `~/.qvac` and cached:

| Task | Model |
|---|---|
| Speech to text | Parakeet TDT 0.6B (multilingual, auto-language) |
| Agent LLM | Qwen3 4B (default) |
| Translation | Bergamot (per language pair) |
| Text to speech | Chatterbox (multilingual) |

Swap the LLM with `AGENT_LLM` in the `.env`: `4b` (default), `8b` (stronger tool-calling), or `35b` (Qwen3.6 35B-A3B, needs 32GB+ RAM).

## Using the demo

1. Open **http://localhost:3461** and click **Start**.
2. Wait for the models to load (a progress line shows the stages).
3. Tap the mic and order by voice, for example "one flat white for pickup, my name is Sam".
4. The agent confirms the order and the total in sats, and asks you to confirm.
5. Say "yes" to pay. The invoice is minted and paid.
6. You get a **Payment Complete** card plus a **QR code** whose "Open receipt" link shows the order, and (in real mode) a **View on Explorer** link to the transaction on [SparkScan](https://www.sparkscan.io).

## Architecture

```
Browser mic (energy VAD)
  -> Parakeet STT (auto language)
  -> language lock + Bergamot translate (X -> EN)
  -> Qwen3 ordering agent (tool-calling FSM: menu / quote / order / pay)
  -> WDK Spark: mint + pay a Lightning invoice
  -> Bergamot translate (EN -> X) + Chatterbox TTS (spoken reply)
```

Spoken output languages: English, Spanish, German, Italian. Understanding and translation cover many more.

## Troubleshooting

- **Slow, huge CPU usage, "1 min per response":** you are almost certainly running under Rosetta. Check with `bun --print process.arch`; it must print `arm64`. If it prints `x64`, the models run on CPU. Reinstall Bun and Node in a native arm64 shell.
- **First run is slow:** the models (~4 GB) download once into `~/.qvac`. Later runs load from cache and are fast.
- **First real payment takes a few seconds:** the Spark wallet authenticates on boot (pre-warmed).
- **A UI change is not showing:** hard reload the page (Cmd+Shift+R) to bypass the browser cache.
- **Port already in use:** stop any previous run, or override `PORT` / `API_PORT` in the `.env`.

## License

Apache 2.0. See the `LICENSE` file.
