#!/usr/bin/env bun
// ============================================================================
// Test Harness - Text-Based Agent Testing CLI
// ============================================================================
//
// Tests the agentic coffee assistant with real LLM integration.
// Tracks and displays FSM state transitions as the LLM makes tool calls.
//
// Usage:
//   bun run examples/test-harness.ts
//   bun run examples/test-harness.ts --scenario simple
//   bun run examples/test-harness.ts --scenario dense
//
// Environment:
//   LLM_MODEL_PATH - Path to Qwen GGUF model (required)
// ============================================================================

import * as readline from "readline"
import { loadModel, unloadModel } from "@qvac/sdk"
import { CoffeeAgent } from "../agent"
import { getTetherWDK } from "../tether-wdk"
import type { TurnResult, AgentState, Stage } from "../agent/types"

// ============================================================================
// Model Loading
// ============================================================================

const LLM_MODEL_PATH = process.env["LLM_MODEL_PATH"] || "models/Qwen3-4B-Instruct-2507-Q8_0.gguf"
let loadedModelId: string | null = null

const loadLLMModel = async (): Promise<string> => {
  console.log(c("dim", `\n📥 Loading LLM model from ${LLM_MODEL_PATH}...`))
  
  const modelId = await loadModel({
    modelSrc: LLM_MODEL_PATH,
    modelType: "llm",
    modelConfig: {
      ctx_size: 16384, // Increased from 4096 to prevent context overflow in multi-turn conversations
    },
    onProgress: (progress) => {
      process.stdout.write(`\r   ${progress.percentage.toFixed(1)}%`)
    },
  })
  
  console.log(`\n${c("green", "✅")} LLM loaded (ID: ${modelId})`)
  loadedModelId = modelId
  return modelId
}

const cleanup = async () => {
  if (loadedModelId) {
    console.log(c("dim", "\n🧹 Unloading model..."))
    await unloadModel({ modelId: loadedModelId })
    loadedModelId = null
  }
}

// Handle shutdown
process.on("SIGINT", async () => {
  await cleanup()
  process.exit(0)
})

// ============================================================================
// Configuration
// ============================================================================

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
}

const c = (color: keyof typeof COLORS, text: string) => `${COLORS[color]}${text}${COLORS.reset}`

const TURN_TIMEOUT_MS = 180000 // 180 second (3 min) timeout per turn - local LLMs with large context can be slow

// ============================================================================
// Test Scenarios
// ============================================================================

interface TestScenario {
  name: string
  description: string
  messages: string[]
  expectedOutcome: string
}

const SCENARIOS: Record<string, TestScenario> = {
  simple: {
    name: "Simple Order",
    description: "Basic order with follow-up confirmation",
    messages: [
      "I want to order a large latte",
      "Yes please",
      "Yes, confirm the order",
    ],
    expectedOutcome: "Order completed with payment",
  },
  dense: {
    name: "Information-Dense Input",
    description: "All info in one message",
    messages: [
      "Large iced oat latte, deliver to 123 Villa Drive, name Omar, pay in USDT.",
      "Yes, confirm",
    ],
    expectedOutcome: "Order completed with minimal follow-ups",
  },
  edge: {
    name: "Edge Case - Change Order",
    description: "User changes mind during order",
    messages: [
      "I want a small espresso",
      "Actually, make it a large cappuccino",
      "Deliver to 456 Oak Street, name Sarah",
      "Yes, confirm",
    ],
    expectedOutcome: "Final order reflects changed items",
  },
}

// ============================================================================
// FSM State Tracking
// ============================================================================

const STAGE_ORDER: Stage[] = ["COLLECT_INFO", "CONFIRM", "EXECUTE", "DONE", "FAILED"]

const getStageIcon = (stage: Stage): string => {
  switch (stage) {
    case "COLLECT_INFO": return "📝"
    case "CONFIRM": return "✋"
    case "EXECUTE": return "⚡"
    case "DONE": return "✅"
    case "FAILED": return "❌"
  }
}

const getStageColor = (stage: Stage): keyof typeof COLORS => {
  switch (stage) {
    case "COLLECT_INFO": return "blue"
    case "CONFIRM": return "yellow"
    case "EXECUTE": return "magenta"
    case "DONE": return "green"
    case "FAILED": return "red"
  }
}

const formatStageTransition = (from: Stage, to: Stage): string => {
  if (from === to) return ""
  const fromIcon = getStageIcon(from)
  const toIcon = getStageIcon(to)
  return c("bright", `\n    🔄 FSM TRANSITION: ${fromIcon} ${from} → ${toIcon} ${to}`)
}

const formatFSMProgress = (stage: Stage): string => {
  const stages = ["COLLECT_INFO", "CONFIRM", "EXECUTE", "DONE"]
  const currentIdx = stages.indexOf(stage)
  
  return stages.map((s, i) => {
    const icon = getStageIcon(s as Stage)
    if (i < currentIdx) return c("green", `${icon}✓`)
    if (i === currentIdx) return c("yellow", `${icon}◀`)
    return c("dim", `${icon}○`)
  }).join(" → ")
}

// ============================================================================
// State Display
// ============================================================================

const formatStateCompact = (state: AgentState): string => {
  const lines: string[] = []
  
  const stageColor = getStageColor(state.stage)
  lines.push(c("bright", "┌──────────────────────────────────────────────────────────────┐"))
  lines.push(c("bright", "│") + ` ${getStageIcon(state.stage)} Stage: ${c(stageColor, state.stage.padEnd(12))} | Turns: ${state.counters.turns_total}/${state.counters.max_turns_total} | ${formatFSMProgress(state.stage).padEnd(30)}` + c("bright", "│"))
  lines.push(c("bright", "├──────────────────────────────────────────────────────────────┤"))
  
  // Order line
  const orderStr = state.order.drink 
    ? `${state.order.drink}${state.order.options?.length ? ` +${state.order.options.join(",")}` : ""}`
    : "-"
  lines.push(c("bright", "│") + ` Order: ${orderStr.substring(0, 54).padEnd(54)} ` + c("bright", "│"))
  
  // User line
  const userStr = state.user.name || "-"
  lines.push(c("bright", "│") + ` Name: ${userStr.padEnd(55)} ` + c("bright", "│"))
  
  // Status line
  const confirmed = state.confirmation.user_confirmed ? c("green", "YES") : c("dim", "no")
  const payment = state.execution.payment_status 
    ? (state.execution.payment_status === "completed" ? c("green", "PAID") : c("yellow", state.execution.payment_status))
    : c("dim", "-")
  const orderId = state.execution.order_id ? state.execution.order_id.substring(0, 20) : "-"
  lines.push(c("bright", "│") + ` Confirmed: ${confirmed} | Payment: ${payment} | Order: ${orderId.padEnd(20)} ` + c("bright", "│"))
  
  lines.push(c("bright", "└──────────────────────────────────────────────────────────────┘"))
  
  return lines.join("\n")
}

// ============================================================================
// Tool Call Display
// ============================================================================

const formatToolCalls = (result: TurnResult): string => {
  if (result.toolsCalled.length === 0) {
    return c("dim", "    (no tools called)")
  }
  
  return result.toolsCalled.map((call, i) => {
    const argStr = Object.keys(call.args).length > 0 
      ? JSON.stringify(call.args).substring(0, 60) + (JSON.stringify(call.args).length > 60 ? "..." : "")
      : "{}"
    return `    ${c("yellow", `${i + 1}.`)} ${c("cyan", call.tool)}(${c("dim", argStr)})`
  }).join("\n")
}

// ============================================================================
// Timeout wrapper
// ============================================================================

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${ms/1000}s: ${message}`)), ms)
    )
  ])
}

// ============================================================================
// Interactive Mode
// ============================================================================

const runInteractive = async (): Promise<void> => {
  console.log(c("bright", "\n╔════════════════════════════════════════════════════════════════╗"))
  console.log(c("bright", "║") + c("cyan", "  ☕ Agentic Coffee Assistant - Test Harness                    ") + c("bright", "║"))
  console.log(c("bright", "║") + c("dim", "  Tracks FSM state transitions as LLM makes tool calls          ") + c("bright", "║"))
  console.log(c("bright", "╚════════════════════════════════════════════════════════════════╝"))
  
  // Load LLM model
  const llmModelId = await loadLLMModel()
  
  console.log(c("dim", "\nCommands: /state /reset /exit /help\n"))
  
  const agent = new CoffeeAgent({
    verbose: true,
    coffeeShopApiUrl: "http://localhost:3457",
    llmModelId,
  })
  
  const wdkManager = getTetherWDK({
    networks: {
      ethereum: 'https://ethereum-sepolia-rpc.publicnode.com',
      bitcoin: { network: 'testnet', host: 'blockstream.info', port: 443 },
      solana: { rpcUrl: 'https://api.devnet.solana.com' },
      tron: 'https://nile.trongrid.io'
    }
  })
  
  const wdkContext = {
    getAddress: async () => wdkManager.getAddress('ethereum', 0),
    signMessage: (message: string) => wdkManager.signMessage('ethereum', message, 0),
    getBalance: () => wdkManager.getBalance('ethereum', 0),
    getAccount: async () => ({
      address: await wdkManager.getAddress('ethereum', 0),
      signMessage: (msg: string) => wdkManager.signMessage('ethereum', msg, 0),
      getBalance: () => wdkManager.getBalance('ethereum', 0)
    }),
    sendTransaction: async (tx: any) => {
      const result = await wdkManager.sendTransaction('ethereum', tx, 0)
      return { hash: result.hash || result.signature || result.txid, fee: '0' }
    }
  }
  agent.setupWDK(wdkContext, wdkManager)
  
  let previousStage: Stage = "COLLECT_INFO"
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  
  console.log(formatStateCompact(agent.getState()))
  
  const prompt = (): void => {
    rl.question(c("green", "\n👤 You: "), async (input) => {
      const trimmed = input.trim()
      
      if (!trimmed) {
        prompt()
        return
      }
      
      if (trimmed.startsWith("/")) {
        switch (trimmed) {
          case "/state":
            console.log("\n" + formatStateCompact(agent.getState()))
            break
          case "/reset":
            agent.reset()
            previousStage = "COLLECT_INFO"
            console.log(c("yellow", "\n🔄 Agent reset"))
            console.log(formatStateCompact(agent.getState()))
            break
          case "/exit":
            console.log(c("dim", "\nGoodbye! ☕"))
            rl.close()
            await cleanup()
            process.exit(0)
          case "/help":
            console.log(c("dim", "\nCommands: /state /reset /exit /help"))
            break
          default:
            console.log(c("red", `Unknown command: ${trimmed}`))
        }
        prompt()
        return
      }
      
      console.log(c("dim", "\n⏳ Processing (LLM thinking)..."))
      
      try {
        const result = await withTimeout(
          agent.processMessage(trimmed),
          TURN_TIMEOUT_MS,
          "Agent response"
        )
        
        // Show FSM transition if any
        if (result.state.stage !== previousStage) {
          console.log(formatStageTransition(previousStage, result.state.stage))
        }
        previousStage = result.state.stage
        
        // Show tool calls
        console.log(c("bright", "\n🔧 Tool Calls:"))
        console.log(formatToolCalls(result))
        
        // Show response
        console.log(c("bright", "\n🤖 Assistant:"))
        console.log(c("white", `    ${result.response}`))
        
        // Show updated state
        console.log(c("bright", "\n📊 Current State:"))
        console.log(formatStateCompact(result.state))
        
        // Check for completion
        if (result.complete) {
          if (result.state.stage === "DONE") {
            console.log(c("green", "\n🎉 ORDER COMPLETE! Payment successful."))
            console.log(c("green", `   Order ID: ${result.state.execution.order_id}`))
            console.log(c("green", `   Payment Status: ${result.state.execution.payment_status}`))
          } else if (result.state.stage === "FAILED") {
            console.log(c("red", `\n💥 ORDER FAILED: ${result.error || "Unknown error"}`))
          }
        }
      } catch (error) {
        console.log(c("red", `\n❌ Error: ${error instanceof Error ? error.message : String(error)}`))
      }
      
      prompt()
    })
  }
  
  prompt()
}

// ============================================================================
// Scenario Mode
// ============================================================================

const runScenario = async (scenarioName: string): Promise<void> => {
  const scenario = SCENARIOS[scenarioName]
  
  if (!scenario) {
    console.log(c("red", `Unknown scenario: ${scenarioName}`))
    console.log(c("dim", `Available: ${Object.keys(SCENARIOS).join(", ")}`))
    process.exit(1)
  }
  
  console.log(c("bright", "\n╔════════════════════════════════════════════════════════════════╗"))
  console.log(c("bright", "║") + c("cyan", `  Running Scenario: ${scenario.name.padEnd(43)}`) + c("bright", "║"))
  console.log(c("bright", "║") + c("dim", `  ${scenario.description.padEnd(61)}`) + c("bright", "║"))
  console.log(c("bright", "╚════════════════════════════════════════════════════════════════╝"))
  
  // Load LLM model
  const llmModelId = await loadLLMModel()
  
  console.log(c("dim", `\nExpected: ${scenario.expectedOutcome}\n`))
  
  const agent = new CoffeeAgent({
    verbose: false,
    coffeeShopApiUrl: "http://localhost:3457",
    llmModelId,
  })
  
  const wdkManager = getTetherWDK({
    networks: {
      ethereum: 'https://ethereum-sepolia-rpc.publicnode.com',
      bitcoin: { network: 'testnet', host: 'blockstream.info', port: 443 },
      solana: { rpcUrl: 'https://api.devnet.solana.com' },
      tron: 'https://nile.trongrid.io'
    }
  })
  
  const wdkContext = {
    getAddress: async () => wdkManager.getAddress('ethereum', 0),
    signMessage: (message: string) => wdkManager.signMessage('ethereum', message, 0),
    getBalance: () => wdkManager.getBalance('ethereum', 0),
    getAccount: async () => ({
      address: await wdkManager.getAddress('ethereum', 0),
      signMessage: (msg: string) => wdkManager.signMessage('ethereum', msg, 0),
      getBalance: () => wdkManager.getBalance('ethereum', 0)
    }),
    sendTransaction: async (tx: any) => {
      const result = await wdkManager.sendTransaction('ethereum', tx, 0)
      return { hash: result.hash || result.signature || result.txid, fee: '0' }
    }
  }
  agent.setupWDK(wdkContext, wdkManager)
  
  let previousStage: Stage = "COLLECT_INFO"
  let finalResult: TurnResult | null = null
  const allTransitions: string[] = []
  
  console.log(c("bright", "Initial State:"))
  console.log(formatStateCompact(agent.getState()))
  
  // Run through messages
  for (let i = 0; i < scenario.messages.length; i++) {
    const message = scenario.messages[i]!
    
    console.log(c("green", `\n════════════════════════════════════════════════════════════════`))
    console.log(c("green", `[Turn ${i + 1}/${scenario.messages.length}] 👤 User: "${message}"`))
    console.log(c("dim", "Processing..."))
    
    try {
      const result = await withTimeout(
        agent.processMessage(message),
        TURN_TIMEOUT_MS,
        `Turn ${i + 1}`
      )
      
      finalResult = result
      
      // Track FSM transition
      if (result.state.stage !== previousStage) {
        const transition = `${previousStage} → ${result.state.stage}`
        allTransitions.push(transition)
        console.log(formatStageTransition(previousStage, result.state.stage))
      }
      previousStage = result.state.stage
      
      // Show tool calls
      console.log(c("bright", "\n🔧 Tool Calls:"))
      console.log(formatToolCalls(result))
      
      // Show response
      console.log(c("bright", "\n🤖 Assistant:"))
      console.log(c("white", `    ${result.response}`))
      
      // Show state
      console.log(c("bright", "\n📊 State After Turn:"))
      console.log(formatStateCompact(result.state))
      
      // Check for early completion
      if (result.complete) {
        console.log(c("yellow", `\n⚡ Agent signaled completion at turn ${i + 1}`))
        break
      }
    } catch (error) {
      console.log(c("red", `\n❌ Error: ${error instanceof Error ? error.message : String(error)}`))
      break
    }
  }
  
  // Final Summary
  console.log(c("bright", "\n════════════════════════════════════════════════════════════════"))
  console.log(c("bright", "                        SCENARIO RESULT"))
  console.log(c("bright", "════════════════════════════════════════════════════════════════"))
  
  console.log(c("bright", "\n📈 FSM Transitions:"))
  if (allTransitions.length > 0) {
    allTransitions.forEach((t, i) => console.log(`    ${i + 1}. ${t}`))
  } else {
    console.log(c("dim", "    No stage transitions occurred"))
  }
  
  if (finalResult) {
    console.log(c("bright", "\n📊 Final State:"))
    console.log(formatStateCompact(finalResult.state))
    
    const isSuccess = finalResult.state.stage === "DONE" && 
                      finalResult.state.execution.payment_status === "completed"
    
    if (isSuccess) {
      console.log(c("green", "\n✅ SCENARIO PASSED"))
      console.log(c("green", `   Stage: ${finalResult.state.stage}`))
      console.log(c("green", `   Order ID: ${finalResult.state.execution.order_id}`))
      console.log(c("green", `   Payment: ${finalResult.state.execution.payment_status}`))
      await cleanup()
      process.exit(0)
    } else if (finalResult.state.stage === "FAILED") {
      console.log(c("red", "\n❌ SCENARIO FAILED"))
      console.log(c("red", `   Stage: ${finalResult.state.stage}`))
      console.log(c("red", `   Error: ${finalResult.state.execution.error || "Unknown"}`))
      await cleanup()
      process.exit(1)
    } else {
      console.log(c("yellow", "\n⚠️  SCENARIO INCOMPLETE"))
      console.log(c("yellow", `   Stage: ${finalResult.state.stage}`))
      console.log(c("yellow", `   More input may be needed`))
      await cleanup()
      process.exit(1)
    }
  } else {
    console.log(c("red", "\n❌ SCENARIO FAILED - No results"))
    await cleanup()
    process.exit(1)
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  
  // Check for scenario mode
  const scenarioIndex = args.indexOf("--scenario")
  if (scenarioIndex !== -1 && args[scenarioIndex + 1]) {
    await runScenario(args[scenarioIndex + 1]!)
    return
  }
  
  // List scenarios
  if (args.includes("--list")) {
    console.log(c("bright", "\nAvailable Scenarios:\n"))
    for (const [key, scenario] of Object.entries(SCENARIOS)) {
      console.log(`  ${c("cyan", key.padEnd(12))} - ${scenario.name}`)
      console.log(`  ${" ".repeat(12)}   ${c("dim", scenario.description)}`)
    }
    console.log()
    return
  }
  
  // Interactive mode
  await runInteractive()
}

main().catch(console.error)
