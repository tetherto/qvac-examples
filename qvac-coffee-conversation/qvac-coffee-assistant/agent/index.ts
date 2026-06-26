// ============================================================================
// Agentic Coffee Assistant - ReAct Loop Implementation
// ============================================================================

import { completion } from "@qvac/sdk"
import type {
  AgentState,
  AgentConfig,
  AgentCallbacks,
  StatePatch,
  Message,
  ToolCall,
  TurnResult,
  LLMResponse,
  ToolContext,
  WDKContext,
  Stage,
  ToolResult,
  ToolName,
} from "./types"
import { createInitialState, DEFAULT_AGENT_CONFIG } from "./types"
import { TOOLS, executeTool, getToolSchemas } from "./tools"
import { generateSystemPrompt, languageDirective, parseToolCall, cleanJsonResponse, sanitizeInput, getSafeFallbackResponse, type SupportedLanguage } from "./llm-adapter"

// ============================================================================
// CoffeeAgent - Main Agent Class
// ============================================================================

export class CoffeeAgent {
  private state: AgentState
  private config: AgentConfig
  private messages: Message[]
  private toolContext: ToolContext
  private verbose: boolean
  private sessionId: string
  private callbacks: AgentCallbacks
  private language: SupportedLanguage
  private menuText = ""   // the real menu, injected at start (fetched live, never hardcoded)

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config }
    this.state = createInitialState(this.config.maxTurns, this.config.defaultCurrency)
    this.messages = []
    this.verbose = config.verbose ?? false
    this.sessionId = `session-${Date.now()}`
    this.callbacks = config.callbacks ?? {}
    this.language = config.language ?? "en"

    // Initialize tool context
    this.toolContext = {
      coffeeShopApiUrl: this.config.coffeeShopApiUrl,
      wdk: null, // Will be set up separately via setupWDK
      updateState: (patch) => this.applyPatch(patch),
      getState: () => this.state,
      setStage: (stage) => {
        const previousStage = this.state.stage
        this.state.stage = stage
        this.callbacks.onStateChange?.(this.state, previousStage)
      },
    }

    // Add system message with language support (+ directive so the LLM answers natively)
    this.messages.push({
      role: "system",
      content: this.buildSystemMessage(),
      timestamp: new Date().toISOString(),
    })

    if (this.verbose) {
      console.log(`🤖 Agent initialized with session ${this.sessionId}`)
      console.log(`📊 Max turns: ${this.config.maxTurns}`)
      console.log(`🌐 Language: ${this.language}`)
    }
  }

  /**
   * Set callbacks for real-time event notifications
   */
  setCallbacks(callbacks: AgentCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Process a user message and return agent response
   */
  async processMessage(userText: string): Promise<TurnResult> {
    const startTurns = this.state.counters.turns_total

    // Security: Check for prompt injection and inappropriate content
    const sanitizationResult = sanitizeInput(userText)
    
    if (!sanitizationResult.isSafe) {
      if (this.verbose) {
        console.log(`⚠️ Security: Detected threats in input: ${sanitizationResult.threats.join(", ")}`)
      }
      
      // Get safe fallback response
      const fallbackResponse = getSafeFallbackResponse(sanitizationResult, this.language)
      if (fallbackResponse) {
        // Parse the fallback to extract the response text
        try {
          const parsed = JSON.parse(fallbackResponse)
          const responseText = parsed.response || "I can only help you order coffee. What would you like to order today?"
          
          // Add sanitized interaction to history (don't expose to LLM)
          this.messages.push({
            role: "user",
            content: "[User message filtered for security]",
            timestamp: new Date().toISOString(),
          })
          this.messages.push({
            role: "assistant",
            content: responseText,
            timestamp: new Date().toISOString(),
          })
          
          this.incrementTurnCounter()
          
          return {
            response: responseText,
            state: this.state,
            toolsCalled: [],
            turnsUsed: 1,
            complete: false,
          }
        } catch {
          // Fallback if parsing fails
        }
      }
    }

    // Add user message
    this.messages.push({
      role: "user",
      content: userText,
      timestamp: new Date().toISOString(),
    })

    // Increment turn counter
    this.incrementTurnCounter()

    if (this.verbose) {
      console.log(`\n👤 User: ${userText}`)
      console.log(`📍 Turn ${this.state.counters.turns_total}/${this.state.counters.max_turns_total}`)
    }

    // Check budget before starting
    if (this.isBudgetExceeded()) {
      return this.createBudgetExceededResponse(startTurns)
    }

    // Run ReAct loop
    const toolsCalled: ToolCall[] = []
    let response = ""

    try {
      const result = await this.runReActLoop(toolsCalled)
      response = result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.state.stage = "FAILED"
      this.state.execution.error = errMsg
      return {
        response: `I encountered an error: ${errMsg}. Please try again.`,
        state: this.state,
        toolsCalled,
        turnsUsed: this.state.counters.turns_total - startTurns,
        complete: true,
        error: errMsg,
      }
    }

    // Add assistant response to history
    this.messages.push({
      role: "assistant",
      content: response,
      timestamp: new Date().toISOString(),
    })

    // Update stage based on state
    this.updateStage()

    const complete = this.state.stage === "DONE" || this.state.stage === "FAILED"

    return {
      response,
      state: this.state,
      toolsCalled,
      turnsUsed: this.state.counters.turns_total - startTurns,
      complete,
    }
  }

  /**
   * Set up WDK context for real wallet operations
   */
  setupWDK(wdkContext: WDKContext, wdkManager?: any): void {
    this.toolContext.wdk = wdkContext
    this.toolContext.wdkManager = wdkManager
    if (this.verbose) {
      console.log("🔐 WDK context configured")
      if (wdkManager) {
        console.log("💳 Real blockchain transactions enabled")
      }
    }
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return structuredClone(this.state)
  }

  /**
   * Get conversation history
   */
  getMessages(): Message[] {
    return structuredClone(this.messages)
  }

  /**
   * Reset agent to initial state
   */
  reset(): void {
    this.state = createInitialState(this.config.maxTurns, this.config.defaultCurrency)
    this.messages = [{
      role: "system",
      content: this.buildSystemMessage(),
      timestamp: new Date().toISOString(),
    }]
    this.sessionId = `session-${Date.now()}`
    if (this.verbose) {
      console.log("🔄 Agent reset")
    }
  }

  /** The full system prompt: base prompt + the live menu + the reply-language directive. */
  private buildSystemMessage(): string {
    return generateSystemPrompt(this.language) + this.menuText + languageDirective(this.language)
  }

  private rebuildSystemMessage(): void {
    if (this.messages.length > 0 && this.messages[0].role === "system") {
      this.messages[0].content = this.buildSystemMessage()
    }
  }

  /**
   * Inject the REAL menu into the system prompt (fetched live at start, never hardcoded), so the
   * agent knows exactly what exists and instantly says "we don't have tea" instead of pretending.
   */
  setMenu(menuText: string): void {
    this.menuText = menuText || ""
    this.rebuildSystemMessage()
  }

  /**
   * Set the language the agent should REPLY in (the user-facing `response` field), and rebuild
   * the system prompt so the LLM writes natively. Called once the spoken language is detected.
   * The conversation language is auto-detected after the agent is created, so this updates it.
   */
  setResponseLanguage(language: SupportedLanguage): void {
    if (language === this.language) return
    this.language = language
    this.rebuildSystemMessage()
    if (this.verbose) console.log(`🌐 Response language set to: ${language}`)
  }

  // ==========================================================================
  // ReAct Loop
  // ==========================================================================

  /**
   * Run the ReAct loop until response or budget exceeded
   */
  private async runReActLoop(toolsCalled: ToolCall[]): Promise<string> {
    const MAX_REPAIR_ATTEMPTS = 3
    let repairAttempts = 0

    while (!this.isBudgetExceeded()) {
      // Call LLM
      const llmResponse = await this.callLLM()

      if (this.verbose) {
        console.log(`🧠 LLM response: ${llmResponse.substring(0, 200)}...`)
      }

      // Parse the response
      const parsed = parseToolCall(llmResponse)

      if (parsed.type === "error") {
        repairAttempts++
        if (repairAttempts >= MAX_REPAIR_ATTEMPTS) {
          return "I'm having trouble processing your request. Could you please try rephrasing?"
        }

        // Add error feedback and retry
        this.messages.push({
          role: "assistant",
          content: llmResponse,
          timestamp: new Date().toISOString(),
        })
        this.messages.push({
          role: "user",
          content: `Error parsing your response: ${parsed.message}. Please respond with valid JSON as specified in the instructions.`,
          timestamp: new Date().toISOString(),
        })
        this.incrementTurnCounter()
        continue
      }

      // Reset repair counter on success
      repairAttempts = 0

      // If it's a text response, return it
      if (parsed.type === "response") {
        return parsed.text
      }

      // Handle multi-tool call - execute tools in parallel
      if (parsed.type === "multi_tool_call") {
        const tools = parsed.tools

        if (this.verbose) {
          console.log(`🔧 Multi-tool call: ${tools.length} tools`)
          tools.forEach(t => console.log(`   - ${t.tool}: ${JSON.stringify(t.args)}`))
        }

        // Notify callbacks that all tools are being called
        tools.forEach(t => {
          this.callbacks.onToolCall?.(t.tool, t.args, "calling")
        })

        // Execute all tools in parallel
        const results = await Promise.all(
          tools.map(t => executeTool(t.tool, t.args, this.state, this.toolContext))
        )

        // Notify callbacks that all tools completed
        tools.forEach((t, i) => {
          this.callbacks.onToolCall?.(t.tool, t.args, "completed", results[i])
        })

        // Track all tool calls
        tools.forEach(t => {
          toolsCalled.push({ tool: t.tool, args: t.args })
        })

        if (this.verbose) {
          results.forEach((result, i) => {
            const toolInfo = tools[i]
            if (toolInfo) {
              console.log(`   ${toolInfo.tool}: ${JSON.stringify(result).substring(0, 100)}`)
            }
          })
        }

        // Capture first error in state if any tool failed
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          const toolInfo = tools[i]
          if (result && !result.success && result.error && !this.state.execution.error) {
            this.state.execution.error = result.error
            console.log(`   ❌ Tool ${toolInfo?.tool ?? 'unknown'} failed: ${result.error}`)
            break
          }
        }

        // Add multi-tool call to message history as a single exchange
        this.messages.push({
          role: "assistant",
          content: JSON.stringify({ tools: tools.map(t => ({ tool: t.tool, args: t.args })) }),
          timestamp: new Date().toISOString(),
        })
        
        // Add combined results
        const combinedResults = tools.map((t, i) => ({
          tool: t.tool,
          result: results[i],
        }))
        this.messages.push({
          role: "tool",
          content: JSON.stringify(combinedResults),
          tool_call_id: "multi_tool",
          timestamp: new Date().toISOString(),
        })

        this.incrementTurnCounter()

        // Early exit if order completed
        if (this.state.stage === "DONE") {
          return this.formatOrderCompleteMessage()
        }

        // Early exit on failure
        if (this.state.stage === "FAILED") {
          return this.formatOrderFailedMessage()
        }

        continue
      }

      // It's a single tool call - execute it
      if (parsed.type === "tool_call") {
        const toolCall: ToolCall = { tool: parsed.tool, args: parsed.args }
        toolsCalled.push(toolCall)

        if (this.verbose) {
          console.log(`🔧 Tool: ${parsed.tool}`)
          console.log(`   Args: ${JSON.stringify(parsed.args)}`)
        }

        // Notify callback that tool is being called
        this.callbacks.onToolCall?.(parsed.tool, parsed.args, "calling")

        // Execute tool
        const result = await executeTool(
          parsed.tool,
          parsed.args,
          this.state,
          this.toolContext
        )

        // Notify callback that tool completed
        this.callbacks.onToolCall?.(parsed.tool, parsed.args, "completed", result)

        if (this.verbose) {
          console.log(`   Result: ${JSON.stringify(result).substring(0, 200)}`)
        }

        // If tool failed, capture error in state
        if (!result.success && result.error && !this.state.execution.error) {
          this.state.execution.error = result.error
          console.log(`   ❌ Tool ${parsed.tool} failed: ${result.error}`)
        }

        // Add tool response to messages
        this.messages.push({
          role: "assistant",
          content: JSON.stringify({ tool: parsed.tool, args: parsed.args }),
          timestamp: new Date().toISOString(),
        })
        this.messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: parsed.tool,
          timestamp: new Date().toISOString(),
        })

        this.incrementTurnCounter()

        // Early exit if order completed - no need for another LLM call
        if (this.state.stage === "DONE") {
          return this.formatOrderCompleteMessage()
        }

        // Early exit on failure
        if (this.state.stage === "FAILED") {
          return this.formatOrderFailedMessage()
        }
      }
    }

    // Budget exceeded
    return this.formatBudgetExceededMessage()
  }

  /**
   * Call the LLM with current message history
   */
  private async callLLM(): Promise<string> {
    const history = this.messages.map(m => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }))

    const response = completion({
      modelId: this.config.llmModelId || "qwen3-4b-instruct",
      history,
      stream: false,
    })

    const text = await response.text
    return cleanJsonResponse(text)
  }

  // ==========================================================================
  // State Management
  // ==========================================================================

  /**
   * Apply a patch to the state
   */
  private applyPatch(patch: StatePatch): void {
    const previousStage = this.state.stage

    // Deep merge patch into state
    if (patch.user) {
      this.state.user = { ...this.state.user, ...patch.user }
    }
    if (patch.fulfillment) {
      this.state.fulfillment = { ...this.state.fulfillment, ...patch.fulfillment }
    }
    if (patch.order) {
      this.state.order = { ...this.state.order, ...patch.order }
    }
    if (patch.payment) {
      this.state.payment = { ...this.state.payment, ...patch.payment }
    }
    if (patch.confirmation) {
      this.state.confirmation = { ...this.state.confirmation, ...patch.confirmation }
    }
    if (patch.execution) {
      this.state.execution = { ...this.state.execution, ...patch.execution }
    }

    // Auto-update stage based on new state
    this.updateStage()

    // Notify callback of state change
    this.callbacks.onStateChange?.(this.state, previousStage)

    if (this.verbose) {
      console.log(`📝 State patched:`, JSON.stringify(patch))
      console.log(`📊 Stage now: ${this.state.stage}`)
    }
  }

  /**
   * Update stage based on current state
   */
  private updateStage(): void {
    const { state } = this

    // Check for completion
    if (state.execution.payment_status === "completed" && state.execution.order_id) {
      state.stage = "DONE"
      return
    }

    // Check for failure
    if (state.execution.payment_status === "failed" || state.execution.error) {
      state.stage = "FAILED"
      return
    }

    // Check for execution (user has confirmed, ready to execute/executing)
    if (state.confirmation.user_confirmed) {
      state.stage = "EXECUTE"
      return
    }

    // Check for confirmation (all info collected, awaiting user confirmation)
    if (state.confirmation.summary_shown) {
      state.stage = "CONFIRM"
      return
    }

    // Default to collecting info
    state.stage = "COLLECT_INFO"
  }

  // ==========================================================================
  // Turn Budget Management
  // ==========================================================================

  private incrementTurnCounter(): void {
    this.state.counters.turns_total++
  }

  private isBudgetExceeded(): boolean {
    return this.state.counters.turns_total >= this.state.counters.max_turns_total
  }

  private formatOrderCompleteMessage(): string {
    const drink = this.state.order.drink || "coffee"

    if (this.language === "es") {
      return `Tu pedido está completo. Por favor habla con mi colega humano para recoger tu voucher por un ${drink}. ¡Gracias!`
    }
    if (this.language === "fr") {
      return `Votre commande est prête ! Présentez-vous à mon collègue pour récupérer votre ${drink}. Merci !`
    }
    if (this.language === "it") {
      return `Il tuo ordine è pronto! Rivolgiti al mio collega per ritirare il tuo ${drink}. Grazie!`
    }
    return `Your order is complete! Please speak to my human colleague to pick up your voucher for a ${drink}. Thank you!`
  }

  private formatOrderFailedMessage(): string {
    // Keep the raw (English) error out of the spoken/displayed message; direct the customer to the
    // staff on site (NOT "support"). The detailed error is still in state.execution.error / logs.
    if (this.language === "es") {
      return `Lo siento, no pude completar tu pedido. Por favor, avisa al personal del mostrador y te ayudarán enseguida.`
    }
    if (this.language === "fr") {
      return `Désolé, je n'ai pas pu finaliser votre commande. Adressez-vous au personnel sur place, il s'occupera de vous tout de suite.`
    }
    if (this.language === "it") {
      return `Spiacente, non sono riuscito a completare il tuo ordine. Rivolgiti al personale al banco, ti aiuteranno subito.`
    }
    return `I'm sorry, I couldn't complete your order. Please ask a member of staff at the counter and they'll help you right away.`
  }

  private formatBudgetExceededMessage(): string {
    const missing = this.getMissingFields()
    let msg: string
    
    if (this.language === "es") {
      msg = `He alcanzado mi límite de turnos (${this.state.counters.max_turns_total} turnos).`
      if (missing.length > 0) {
        msg += ` Aún faltan: ${missing.join(", ")}.`
      }
      msg += " Por favor inicia una nueva conversación para continuar."
    } else if (this.language === "fr") {
      msg = `J'ai atteint ma limite de tours (${this.state.counters.max_turns_total} tours).`
      if (missing.length > 0) {
        msg += ` Il manque encore : ${missing.join(", ")}.`
      }
      msg += " Veuillez démarrer une nouvelle conversation pour continuer."
    } else if (this.language === "it") {
      msg = `Ho raggiunto il mio limite di turni (${this.state.counters.max_turns_total} turni).`
      if (missing.length > 0) {
        msg += ` Manca ancora: ${missing.join(", ")}.`
      }
      msg += " Avvia una nuova conversazione per continuare."
    } else {
      msg = `I've reached my turn limit (${this.state.counters.max_turns_total} turns).`
      if (missing.length > 0) {
        msg += ` Still missing: ${missing.join(", ")}.`
      }
      msg += " Please start a new conversation to continue."
    }

    return msg
  }

  private createBudgetExceededResponse(startTurns: number): TurnResult {
    this.state.stage = "FAILED"
    this.state.execution.error = "Turn budget exceeded"
    
    return {
      response: this.formatBudgetExceededMessage(),
      state: this.state,
      toolsCalled: [],
      turnsUsed: this.state.counters.turns_total - startTurns,
      complete: true,
      error: "Turn budget exceeded",
    }
  }

  private getMissingFields(): string[] {
    const missing: string[] = []
    if (!this.state.order.drink) missing.push("order.drink")
    if (!this.state.user.name) missing.push("user.name")
    return missing
  }
}

// ============================================================================
// Exports
// ============================================================================

export { createInitialState, DEFAULT_AGENT_CONFIG } from "./types"
export type { AgentState, AgentConfig, AgentCallbacks, TurnResult, Message, ToolName, ToolResult, Stage } from "./types"
