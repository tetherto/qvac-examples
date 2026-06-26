# QVAC Coffee Assistant - Architecture Diagram

This document provides visual diagrams of the system architecture and a walkthrough of a simple coffee ordering scenario.

---

## System Architecture

```mermaid
flowchart TB
    subgraph User["👤 Speaker/User"]
        mic[🎤 Microphone]
        speaker[🔊 Speaker]
    end

    subgraph VoiceAssistant["Voice Assistant Client"]
        subgraph STT["Speech-to-Text"]
            whisper[Whisper<br/>tiny.en]
        end
        
        subgraph TTS["Text-to-Speech"]
            piper[Piper TTS]
            espeak[espeak-ng]
        end
        
        subgraph Agent["Coffee Agent"]
            subgraph LLM["LLM"]
                qwen[Qwen3-4B<br/>Instruct]
            end
            
            subgraph Tools["Tools"]
                state_tools[State Tools<br/>get, patch, summary<br/>confirm_order]
                shop_tools[Shop Tools<br/>get_quote, create_order<br/>complete_with_payment]
                payment_tools[Payment Tools<br/>x402_request<br/>x402_pay]
                profile_tools[Profile Tools<br/>get_defaults]
            end
            
            state_machine[State Machine<br/>COLLECT_INFO → CONFIRM<br/>→ EXECUTE → DONE]
        end
        
        menu[(Menu Data<br/>Drinks, Options<br/>Stores)]
        
        customer_wallet[Customer Wallet<br/>WDK Index 0]
    end

    subgraph CoffeeShopAPI["Coffee Shop API"]
        api_endpoints[API Endpoints<br/>/api/menu<br/>/api/orders<br/>/api/quote]
        
        shop_wallet[Shop Wallet<br/>WDK Index 1]
        
        orders_db[(Orders<br/>In-Memory Store)]
    end

    subgraph Blockchain["Blockchain Network"]
        tron[TRON Nile<br/>Testnet]
        usdt[USDT<br/>TRC-20]
    end

    %% User interactions
    mic -->|Audio| whisper
    piper -->|Audio| speaker
    espeak -.->|Phonemes| piper

    %% Voice Assistant internal flow
    whisper -->|Text| qwen
    qwen -->|Response| piper
    qwen <-->|Execute| Tools
    Tools <-->|Read/Write| state_machine
    state_tools -->|Access| menu

    %% API interactions
    shop_tools -->|HTTP| api_endpoints
    payment_tools -->|Send USDT| customer_wallet
    
    %% Coffee Shop API internal
    api_endpoints --> orders_db
    api_endpoints --> shop_wallet

    %% Blockchain
    customer_wallet -->|Transfer| tron
    tron -->|Receive| shop_wallet
    usdt -.->|Token| tron
```

---

## Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Whisper** | `@qvac/sdk` | Speech-to-Text transcription |
| **Piper TTS** | ONNX model + espeak | Text-to-Speech synthesis |
| **LLM (Qwen)** | Qwen3-4B-Instruct GGUF | Natural language understanding & tool orchestration |
| **State Machine** | TypeScript | Tracks order progress through stages |
| **Tools** | TypeScript functions | Actions the LLM can invoke |
| **Customer Wallet** | Tether WDK | User's crypto wallet for payments |
| **Coffee Shop API** | Bun HTTP server | Backend for orders and shop wallet |
| **Shop Wallet** | Tether WDK (index 1) | Merchant wallet receiving payments |

---

## Simple Order Scenario - Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant User as 👤 User
    participant Whisper as 🎤 Whisper STT
    participant LLM as 🧠 LLM (Qwen)
    participant Tools as 🔧 Tools
    participant State as 📊 State Machine
    participant API as ☕ Coffee Shop API
    participant CustWallet as 💳 Customer Wallet
    participant ShopWallet as 🏪 Shop Wallet
    participant Piper as 🔊 Piper TTS

    Note over User,Piper: Phase 1: Collect Order Information
    
    User->>Whisper: "I'd like a large latte delivered to 123 Main St"
    Whisper->>LLM: Transcribed text
    LLM->>Tools: state.patch({order: {drink: "latte", size: "large"}, fulfillment: {address: "123 Main St"}})
    Tools->>State: Update state
    State-->>Tools: Success
    LLM->>Tools: profile.get_defaults()
    Tools-->>LLM: {name: "John", currency: "USDT"}
    LLM->>Tools: state.patch({user: {name: "John"}})
    Tools->>State: Update state
    LLM->>Piper: "Got it! A large latte to 123 Main St. Is that correct?"
    Piper->>User: 🔊 Speech output

    Note over User,Piper: Phase 2: Confirm Order
    
    User->>Whisper: "Yes, that's right"
    Whisper->>LLM: "Yes, that's right"
    LLM->>Tools: state.summary()
    Tools-->>LLM: Order summary with price ($8.90)
    LLM->>Tools: state.confirm_order()
    Tools->>State: Set user_confirmed = true
    State-->>Tools: Stage → EXECUTE
    
    Note over User,Piper: Phase 3: Execute Payment
    
    LLM->>Tools: shop.create_order()
    Tools->>API: POST /api/orders
    API-->>Tools: 402 Payment Required + x402 requirements
    LLM->>Tools: payments.x402_pay()
    Tools->>CustWallet: Send 8.90 USDT
    CustWallet->>ShopWallet: 💸 USDT Transfer (blockchain)
    CustWallet-->>Tools: Transaction hash
    
    Note over User,Piper: Phase 4: Complete Order
    
    LLM->>Tools: shop.complete_with_payment()
    Tools->>API: POST /api/orders + X-Payment-Proof header
    API->>API: Verify payment, update order status → "paid"
    API-->>Tools: Order confirmed (ORD-2026-0001)
    Tools->>State: Stage → DONE
    LLM->>Piper: "Your order is complete! Order ID: ORD-2026-0001"
    Piper->>User: 🔊 Speech output
    
    Note over ShopWallet: Shop wallet now has +8.90 USDT ✅
```

---

## State Machine Stages

```mermaid
stateDiagram-v2
    [*] --> COLLECT_INFO: Agent initialized
    
    COLLECT_INFO --> COLLECT_INFO: Gathering drink, size,<br/>address, name
    COLLECT_INFO --> CONFIRM: All fields collected<br/>summary_shown = true
    
    CONFIRM --> CONFIRM: Waiting for user<br/>confirmation
    CONFIRM --> EXECUTE: user_confirmed = true
    
    EXECUTE --> EXECUTE: Creating order,<br/>processing payment
    EXECUTE --> DONE: payment_status = completed
    EXECUTE --> FAILED: Error or timeout
    
    DONE --> [*]: Order complete ✅
    FAILED --> [*]: Order failed ❌
```

---

## Tool Categories

```mermaid
mindmap
  root((Agent Tools))
    State Tools
      state.get
      state.patch
      state.missing_fields
      state.advance_if_ready
      state.summary
      state.confirm_order
    Profile Tools
      profile.get_defaults
    Shop Tools
      shop.get_quote
      shop.create_order
      shop.complete_with_payment
    Payment Tools
      payments.x402_request
      payments.x402_pay
```

---

## x402 Payment Flow

The system uses the **x402 protocol** for payment-gated API access:

```mermaid
sequenceDiagram
    participant Agent as 🤖 Agent
    participant API as ☕ Coffee Shop API
    participant Wallet as 💳 Customer Wallet
    participant Chain as ⛓️ Blockchain

    Agent->>API: POST /api/orders (no payment)
    API-->>Agent: 402 Payment Required<br/>+ X-Payment-Required header
    
    Note over Agent: Parse payment requirements:<br/>amount, recipient, nonce
    
    Agent->>Wallet: Send USDT to recipient
    Wallet->>Chain: Token transfer TX
    Chain-->>Wallet: TX hash confirmed
    
    Agent->>API: POST /api/orders<br/>+ X-Payment-Proof header
    API->>API: Verify payment proof
    API-->>Agent: 201 Created<br/>Order confirmed
```

---

## Deployment View

```mermaid
flowchart LR
    subgraph LocalMachine["Local Machine"]
        subgraph Process1["Process 1: Voice Assistant"]
            voice[coffee-voice-control.ts]
            models[(GGUF + ONNX Models)]
        end
        
        subgraph Process2["Process 2: Coffee Shop API"]
            server[server.ts :3457]
        end
        
        subgraph SharedData["Shared Data"]
            seed[(tether-wdk-seed.json)]
            profile[(user-profile.json)]
        end
    end
    
    subgraph External["External Services"]
        tron_rpc[TRON Nile RPC<br/>nile.trongrid.io]
    end
    
    voice --> models
    voice <-->|HTTP| server
    voice --> seed
    voice --> profile
    server --> seed
    server <-->|JSON-RPC| tron_rpc
```

---

## Quick Reference

### Start the System

```bash
# Terminal 1: Start Coffee Shop API
cd qvac-coffee-assistant
bun run server

# Terminal 2: Start Voice Assistant
cd qvac-coffee-assistant
USE_REAL_PAYMENTS=true bun run voice
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_REAL_PAYMENTS` | `false` | Enable real blockchain transactions |
| `NETWORK_MODE` | `testnet` | Network mode (testnet/mainnet) |
| `COFFEE_SHOP_API_URL` | `http://localhost:3457` | API endpoint |
| `TTS_VOICE` | `norman` | TTS voice (norman/ryan/semaine) |

---

## Web UI Architecture

The Agent UI Server provides a browser-based interface for interacting with the coffee agent via WebSockets.

```mermaid
flowchart TB
    subgraph Browser["🌐 Browser (agent-ui.html)"]
        subgraph UIComponents["UI Components"]
            config_panel[Config Panel<br/>Settings & Start]
            conversation[Conversation Area<br/>Typewriter Effect]
            state_viz[State Machine<br/>Visual Spheres]
            order_panel[Order Details<br/>Real-time Updates]
        end
        
        subgraph AudioIO["Audio I/O"]
            mic_capture[🎤 Microphone<br/>ScriptProcessorNode]
            audio_playback[🔊 Audio Playback<br/>Web Audio API]
        end
        
        ws_client[WebSocket Client]
    end
    
    subgraph AgentUIServer["Agent UI Server (:3458)"]
        http_server[HTTP Server<br/>Serves Static Files]
        ws_server[WebSocket Server<br/>/ws endpoint]
        
        subgraph Models["QVAC Models"]
            whisper_model[Whisper STT]
            llm_model[Qwen LLM]
            tts_model[Piper TTS]
        end
        
        subgraph AgentCore["Coffee Agent"]
            react_loop[ReAct Loop]
            tools_exec[Tool Executor]
            state_mgr[State Manager]
            callbacks[Agent Callbacks<br/>onToolCall, onStateChange<br/>onLLMResponse]
        end
        
        filler_mgr[Filler Speech<br/>Manager]
    end
    
    subgraph CoffeeShopAPI["Coffee Shop API (:3457)"]
        api[REST API]
    end
    
    %% Browser to Server
    ws_client <-->|WebSocket| ws_server
    mic_capture -->|voice_audio| ws_client
    ws_client -->|tts_audio, filler_audio| audio_playback
    
    %% Server internal
    ws_server --> whisper_model
    whisper_model --> react_loop
    react_loop <--> tools_exec
    tools_exec <--> state_mgr
    react_loop --> llm_model
    react_loop --> callbacks
    callbacks --> ws_server
    filler_mgr --> tts_model
    tts_model --> ws_server
    
    %% External
    tools_exec -->|HTTP| api
```

---

## WebSocket Message Flow

Real-time communication between the browser and agent server:

```mermaid
sequenceDiagram
    autonumber
    participant Browser as 🌐 Browser
    participant Server as 🖥️ Agent UI Server
    participant Agent as 🤖 Coffee Agent
    participant API as ☕ Coffee Shop API
    
    Note over Browser,API: Initialization
    Browser->>Server: Connect WebSocket
    Browser->>Server: get_config
    Server-->>Browser: config_loaded (settings, profile)
    Browser->>Server: start (with config)
    Server-->>Browser: status ("Loading models...")
    Server-->>Browser: loading_progress (whisper, llm, tts)
    Server-->>Browser: agent_ready (initial state)
    Server-->>Browser: llm_complete (greeting)
    Server-->>Browser: tts_audio (greeting audio)
    
    Note over Browser,API: User Interaction
    Browser->>Server: voice_audio (raw PCM)
    Server-->>Browser: transcribing
    Server-->>Browser: filler_audio ("Let me check...")
    Server-->>Browser: transcription_complete (text)
    
    Note over Browser,API: Agent Processing
    Server-->>Browser: processing_start
    Agent->>Agent: ReAct Loop
    Server-->>Browser: tool_call (profile.get_defaults, calling)
    Server-->>Browser: tool_call (profile.get_defaults, completed)
    Server-->>Browser: state_update (new state)
    Server-->>Browser: tool_call (state.patch, calling)
    Server-->>Browser: tool_call (state.patch, completed)
    Server-->>Browser: state_update (updated state)
    
    Note over Browser,API: Response
    Server-->>Browser: llm_complete (response text)
    Server-->>Browser: tts_audio (response audio)
    
    Note over Browser,API: Order Completion
    Agent->>API: Create order + payment
    Server-->>Browser: tool_call (shop.create_order, calling)
    Server-->>Browser: tool_call (shop.create_order, completed)
    Server-->>Browser: state_update (stage: DONE)
    Server-->>Browser: qr_code (order QR)
    Server-->>Browser: llm_complete ("Order complete!")
    Server-->>Browser: tts_audio (confirmation audio)
```

---

## WebSocket Message Types

| Direction | Message Type | Purpose |
|-----------|--------------|---------|
| **Client → Server** | | |
| | `get_config` | Request current configuration |
| | `start` | Initialize agent with config |
| | `user_message` | Send text message |
| | `voice_audio` | Send raw PCM audio for transcription |
| | `reset` | Reset agent to initial state |
| **Server → Client** | | |
| | `config_loaded` | Configuration and user profile |
| | `status` | Loading status message |
| | `loading_progress` | Model loading progress (%) |
| | `agent_ready` | Agent initialized, ready for input |
| | `processing_start` | Agent started processing |
| | `tool_call` | Tool execution status (calling/completed) |
| | `state_update` | Agent state changed |
| | `llm_complete` | LLM response text |
| | `tts_audio` | Base64-encoded WAV audio |
| | `filler_audio` | Filler speech audio + text |
| | `transcription_complete` | Transcribed user speech |
| | `qr_code` | Order QR code image |
| | `error` | Error message |

---

## UI Deployment View

```mermaid
flowchart LR
    subgraph LocalMachine["Local Machine"]
        subgraph Process1["Process 1: Agent UI Server"]
            ui_server[agent-ui-server.ts :3458]
            models[(GGUF + ONNX Models)]
        end
        
        subgraph Process2["Process 2: Coffee Shop API"]
            api_server[server.ts :3457]
        end
        
        subgraph StaticFiles["Static Files"]
            html[agent-ui.html]
            css[agent-ui.css]
        end
        
        subgraph SharedData["Shared Data"]
            seed[(tether-wdk-seed.json)]
            profile[(user-profile.json)]
        end
    end
    
    subgraph Browser["Browser"]
        client[Agent UI Client]
    end
    
    subgraph External["External Services"]
        tron_rpc[TRON Nile RPC]
    end
    
    client <-->|WebSocket| ui_server
    client -->|HTTP| ui_server
    ui_server --> models
    ui_server --> html
    ui_server --> css
    ui_server <-->|HTTP| api_server
    ui_server --> seed
    ui_server --> profile
    api_server --> seed
    api_server <-->|JSON-RPC| tron_rpc
```

---

## Start the Web UI

```bash
# Terminal 1: Start Coffee Shop API
cd qvac-coffee-assistant
bun run api

# Terminal 2: Start Agent UI Server
cd qvac-coffee-assistant
bun run ui

# Open browser to http://localhost:3458
```
