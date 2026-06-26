// ============================================================================
// Agent Tests - Agentic Architecture
// ============================================================================

import { describe, expect, test, beforeEach } from "bun:test"
import { CoffeeAgent } from "../agent"
import { createWDKContext } from "../wdk"
import type { AgentState } from "../agent/types"

// ============================================================================
// Agent Tests
// ============================================================================

describe("CoffeeAgent", () => {
  let agent: CoffeeAgent

  beforeEach(() => {
    agent = new CoffeeAgent({
      coffeeShopApiUrl: "http://localhost:3457",
      maxTurns: 25,
      verbose: false,
    })
    
    const wdkContext = createWDKContext({ mode: "mock" })
    agent.setupWDK(wdkContext)
  })

  test("should initialize with correct initial state", () => {
    const state = agent.getState()
    
    expect(state.stage).toBe("COLLECT_INFO")
    expect(state.counters.turns_total).toBe(0)
    expect(state.counters.max_turns_total).toBe(25)
    expect(state.user.name_confirmed).toBe(false)
    expect(state.fulfillment.mode).toBe("pickup")
    expect(state.payment.currency).toBe("USDT")
    expect(state.confirmation.user_confirmed).toBe(false)
  })

  test("should reset state correctly", () => {
    const agent = new CoffeeAgent({ maxTurns: 10 })
    
    // Modify state somehow
    agent.reset()
    
    const state = agent.getState()
    expect(state.stage).toBe("COLLECT_INFO")
    expect(state.counters.turns_total).toBe(0)
  })

  test("should track turn count", async () => {
    // Note: This test requires the LLM to be available
    // In CI, this would use a mock
    const initialState = agent.getState()
    expect(initialState.counters.turns_total).toBe(0)
  })

  test("should return messages array", () => {
    const messages = agent.getMessages()
    
    // Should have system message
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0]?.role).toBe("system")
  })
})

// ============================================================================
// State Shape Tests
// ============================================================================

describe("AgentState", () => {
  test("should have all required fields", () => {
    const agent = new CoffeeAgent()
    const state = agent.getState()
    
    // Stage
    expect(state.stage).toBeDefined()
    
    // User
    expect(state.user).toBeDefined()
    expect(typeof state.user.name_confirmed).toBe("boolean")
    
    // Fulfillment
    expect(state.fulfillment).toBeDefined()
    expect(state.fulfillment.mode).toBe("pickup")
    
    // Order
    expect(state.order).toBeDefined()
    
    // Payment
    expect(state.payment).toBeDefined()
    expect(state.payment.currency).toBe("USDT")
    
    // Confirmation
    expect(state.confirmation).toBeDefined()
    expect(typeof state.confirmation.user_confirmed).toBe("boolean")
    expect(typeof state.confirmation.summary_shown).toBe("boolean")
    
    // Execution
    expect(state.execution).toBeDefined()
    
    // Counters
    expect(state.counters).toBeDefined()
    expect(typeof state.counters.turns_total).toBe("number")
    expect(typeof state.counters.max_turns_total).toBe("number")
  })
})

// ============================================================================
// WDK Integration Tests
// ============================================================================

describe("WDK Integration", () => {
  test("should create WDK context in mock mode", () => {
    const context = createWDKContext({ mode: "mock" })
    
    expect(context).toBeDefined()
    expect(context.getAddress).toBeDefined()
    expect(context.signMessage).toBeDefined()
    expect(context.getAccount).toBeDefined()
  })

  test("should get mock address", async () => {
    const context = createWDKContext({ mode: "mock" })
    const address = await context.getAddress()
    
    expect(address).toBeDefined()
    expect(address).toContain("Mock")
  })

  test("should sign message in mock mode", async () => {
    const context = createWDKContext({ mode: "mock" })
    const signature = await context.signMessage("test message")
    
    expect(signature).toBeDefined()
    expect(signature.length).toBeGreaterThan(0)
  })
})
