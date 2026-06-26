# QVAC Coffee Agent - Conversation Mode

A fully on-device voice coffee-ordering agent built on the **QVAC SDK**. Speak in any
language; it transcribes (Parakeet), reasons + calls tools in a small local LLM (Qwen3-8B),
replies in your language (Chatterbox TTS), and takes a Bitcoin/sats order end-to-end - all
local, no cloud.

## Features
- **Conversation mode**: hands-free, continuous listening with barge-in. Auto-detects the
  spoken language (EN / FR / ES / IT) and answers natively.
- **Push-to-talk** fallback (Settings) for noisy rooms.
- Full order flow: menu -> drink -> name -> summary -> sats price -> payment QR.
- 100% on-device: STT, LLM, TTS, translation (Bergamot), and a mock x402/Lightning payment.

## Run
```bash
cd qvac-coffee-assistant
npm install
# copy the env template and adjust if you want real payments (mock by default):
cp .env.example .env
cd ..
node server.js   # conversation UI on :3461, coffee-shop API on :3462
```
Open http://localhost:3461 and tap "Start talking".

## Notes
- Models download to `~/.qvac` on first run.
- Payments run in **mock mode** by default (no real funds). Real wallet seeds/keys are never
  committed (see `.gitignore`).

License: Apache-2.0
