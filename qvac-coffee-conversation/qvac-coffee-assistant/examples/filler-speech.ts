// ============================================================================
// Filler Speech System - Fill silences during processing
// ============================================================================

import { textToSpeech } from "@qvac/sdk"
import { spawn } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { platform } from "os"
import type { ToolName, ToolResult } from "../agent/types"

// ============================================================================
// Filler Phrase Pools
// ============================================================================

/**
 * Initial filler phrases - played immediately when processing starts (fallback)
 */
export const INITIAL_FILLERS = [
  "One moment please.",
  "Let me process that for you.",
  "Just a moment.",
  "Processing your request.",
  "Give me a second.",
  "Working on it.",
  "Let me check on that.",
]

/**
 * Extended processing phrases - played if processing takes longer than expected
 */
export const EXTENDED_FILLERS = [
  "I'm still working on your request.",
  "Almost there, just a moment longer.",
  "Still processing, won't be long now.",
  "Bear with me, almost done.",
  "Still working on it.",
  "Taking a bit longer than usual.",
  "Just finishing up.",
]

/**
 * Stage-specific fillers for different processing stages (secondary fallback)
 */
export const STAGE_FILLERS: Record<string, string[]> = {
  COLLECT_INFO: [
    "Let me note that down.",
    "Got it, updating your order.",
    "Adding that to your order.",
  ],
  CONFIRM: [
    "Let me prepare your order summary.",
    "Putting together the details.",
  ],
  EXECUTE: [
    "Processing your payment.",
    "Sending your order through.",
    "Finalizing your order.",
    "Connecting to the coffee shop.",
  ],
}

// ============================================================================
// Tool-Specific Filler Phrases (Priority 1)
// ============================================================================

/**
 * Phrases spoken when a specific tool is being called
 */
export const TOOL_CALLING_FILLERS: Partial<Record<ToolName, string[]>> = {
  "shop.menu": [
    "Sure, let me check the menu now.",
    "Let me look at what's available.",
    "Checking our menu for you.",
    "One moment, pulling up the menu.",
  ],
  "shop.get_quote": [
    "Let me get the price for that.",
    "Calculating your total now.",
    "Getting a quote for your order.",
  ],
  "shop.create_order": [
    "Creating your order now.",
    "Submitting your order to the coffee shop.",
    "Placing your order.",
  ],
  "shop.create_and_pay": [
    "Processing your order and payment now.",
    "Setting up your order and payment.",
    "Handling your order, one moment.",
  ],
  "payments.x402_pay": [
    "Processing payment now.",
    "Initiating the payment.",
    "Sending your payment through.",
    "Handling the payment transaction.",
  ],
  "shop.complete_with_payment": [
    "Finalizing your order with payment.",
    "Completing the transaction.",
    "Almost done, confirming your order.",
  ],
  "state.summary": [
    "Let me summarize your order.",
    "Preparing your order summary.",
    "Getting the details together.",
  ],
  "state.confirm_order": [
    "Confirming your order now.",
    "Locking in your order details.",
  ],
  "state.patch": [
    "Updating your order.",
    "Noted, making that change.",
  ],
  "state.patch_and_check": [
    "Updating your order details.",
    "Making those changes now.",
  ],
  // profile.get_defaults removed - no longer using profile defaults
}

/**
 * Phrases spoken when a specific tool completes successfully
 */
export const TOOL_COMPLETED_FILLERS: Partial<Record<ToolName, string[]>> = {
  "shop.menu": [
    "Got the menu.",
    "Here's what we have.",
  ],
  "payments.x402_pay": [
    "Payment sent, waiting for confirmation.",
    "Payment submitted successfully.",
  ],
  "shop.complete_with_payment": [
    "Payment confirmed, order complete!",
    "All done! Your order is confirmed.",
    "Confirmation received, you're all set.",
  ],
  "shop.create_and_pay": [
    "Order and payment confirmed!",
    "All done! Order is on its way.",
    "Confirmation received.",
  ],
  "shop.create_order": [
    "Order submitted.",
  ],
  "state.confirm_order": [
    "Order confirmed, proceeding to payment.",
  ],
}

/**
 * Special phrases for payment status transitions
 */
export const PAYMENT_STATUS_FILLERS: Record<string, string[]> = {
  pending: [
    "Payment is pending.",
    "Awaiting payment processing.",
  ],
  processing: [
    "Payment is being processed.",
    "Waiting for payment confirmation.",
    "Transaction in progress.",
  ],
  completed: [
    "Payment confirmed!",
    "Payment successful!",
    "Confirmation received.",
  ],
  failed: [
    "There was an issue with the payment.",
    "Payment couldn't be processed.",
  ],
}

// ============================================================================
// Spanish Filler Phrase Pools
// ============================================================================

/**
 * Spanish initial filler phrases - played immediately when processing starts
 */
export const INITIAL_FILLERS_ES = [
  "Un momento por favor.",
  "Déjame procesar eso.",
  "Solo un momento.",
  "Procesando tu solicitud.",
  "Dame un segundo.",
  "Trabajando en ello.",
  "Déjame verificar eso.",
]

/**
 * Spanish extended processing phrases - played if processing takes longer
 */
export const EXTENDED_FILLERS_ES = [
  "Todavía estoy trabajando en tu solicitud.",
  "Casi listo, solo un momento más.",
  "Aún procesando, no tardará mucho.",
  "Ten paciencia, casi termino.",
  "Aún trabajando en ello.",
  "Está tardando un poco más de lo usual.",
  "Ya casi termino.",
]

/**
 * Spanish stage-specific fillers
 */
export const STAGE_FILLERS_ES: Record<string, string[]> = {
  COLLECT_INFO: [
    "Déjame anotarlo.",
    "Entendido, actualizando tu pedido.",
    "Agregando eso a tu pedido.",
  ],
  CONFIRM: [
    "Déjame preparar el resumen de tu pedido.",
    "Organizando los detalles.",
  ],
  EXECUTE: [
    "Procesando tu pago.",
    "Enviando tu pedido.",
    "Finalizando tu pedido.",
    "Conectando con la cafetería.",
  ],
}

/**
 * Spanish tool-specific calling fillers
 */
export const TOOL_CALLING_FILLERS_ES: Partial<Record<ToolName, string[]>> = {
  "shop.menu": [
    "Claro, déjame revisar el menú.",
    "Déjame ver qué hay disponible.",
    "Revisando nuestro menú.",
    "Un momento, buscando el menú.",
  ],
  "shop.get_quote": [
    "Déjame calcular el precio.",
    "Calculando tu total ahora.",
    "Obteniendo el precio de tu pedido.",
  ],
  "shop.create_order": [
    "Creando tu pedido ahora.",
    "Enviando tu pedido a la cafetería.",
    "Colocando tu pedido.",
  ],
  "shop.create_and_pay": [
    "Procesando tu pedido y pago ahora.",
    "Configurando tu pedido y pago.",
    "Manejando tu pedido, un momento.",
  ],
  "payments.x402_pay": [
    "Procesando el pago ahora.",
    "Iniciando el pago.",
    "Enviando tu pago.",
    "Manejando la transacción de pago.",
  ],
  "shop.complete_with_payment": [
    "Finalizando tu pedido con el pago.",
    "Completando la transacción.",
    "Casi listo, confirmando tu pedido.",
  ],
  "state.summary": [
    "Déjame resumir tu pedido.",
    "Preparando el resumen de tu pedido.",
    "Organizando los detalles.",
  ],
  "state.confirm_order": [
    "Confirmando tu pedido ahora.",
    "Asegurando los detalles de tu pedido.",
  ],
  "state.patch": [
    "Actualizando tu pedido.",
    "Entendido, haciendo ese cambio.",
  ],
  "state.patch_and_check": [
    "Actualizando los detalles de tu pedido.",
    "Haciendo esos cambios ahora.",
  ],
  // profile.get_defaults removed - no longer using profile defaults
}

/**
 * Spanish tool completion fillers
 */
export const TOOL_COMPLETED_FILLERS_ES: Partial<Record<ToolName, string[]>> = {
  "shop.menu": [
    "Tengo el menú.",
    "Esto es lo que tenemos.",
  ],
  "payments.x402_pay": [
    "Pago enviado, esperando confirmación.",
    "Pago enviado exitosamente.",
  ],
  "shop.complete_with_payment": [
    "Pago confirmado, pedido completo!",
    "Listo! Tu pedido está confirmado.",
    "Confirmación recibida, todo listo.",
  ],
  "shop.create_and_pay": [
    "Pedido y pago confirmados!",
    "Listo! Tu pedido está en camino.",
    "Confirmación recibida.",
  ],
  "shop.create_order": [
    "Pedido enviado.",
  ],
  "state.confirm_order": [
    "Pedido confirmado, procediendo al pago.",
  ],
}

/**
 * Spanish payment status fillers
 */
export const PAYMENT_STATUS_FILLERS_ES: Record<string, string[]> = {
  pending: [
    "El pago está pendiente.",
    "Esperando procesamiento del pago.",
  ],
  processing: [
    "El pago está siendo procesado.",
    "Esperando confirmación del pago.",
    "Transacción en progreso.",
  ],
  completed: [
    "Pago confirmado!",
    "Pago exitoso!",
    "Confirmación recibida.",
  ],
  failed: [
    "Hubo un problema con el pago.",
    "El pago no pudo ser procesado.",
  ],
}

// ============================================================================
// Language Helper Function
// ============================================================================

export type SupportedLanguage = "en" | "es"

/**
 * Get filler phrase pools for a specific language
 */
export const getFillers = (language: SupportedLanguage = "en") => ({
  INITIAL: language === "es" ? INITIAL_FILLERS_ES : INITIAL_FILLERS,
  EXTENDED: language === "es" ? EXTENDED_FILLERS_ES : EXTENDED_FILLERS,
  STAGE: language === "es" ? STAGE_FILLERS_ES : STAGE_FILLERS,
  TOOL_CALLING: language === "es" ? TOOL_CALLING_FILLERS_ES : TOOL_CALLING_FILLERS,
  TOOL_COMPLETED: language === "es" ? TOOL_COMPLETED_FILLERS_ES : TOOL_COMPLETED_FILLERS,
  PAYMENT_STATUS: language === "es" ? PAYMENT_STATUS_FILLERS_ES : PAYMENT_STATUS_FILLERS,
})

// ============================================================================
// Audio Utilities (for filler playback)
// ============================================================================

const createWavHeader = (dataLength: number, sampleRate = 22050): Buffer => {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataLength, 40)
  return header
}

const int16ArrayToBuffer = (int16Array: number[]): Buffer => {
  const buffer = Buffer.alloc(int16Array.length * 2)
  for (let i = 0; i < int16Array.length; i++) {
    const value = int16Array[i] ?? 0
    buffer.writeInt16LE(value, i * 2)
  }
  return buffer
}

// ============================================================================
// Filler Speech Manager
// ============================================================================

export interface FillerSpeechConfig {
  /** TTS model ID to use for speech synthesis */
  ttsModelId: string
  /** Delay before playing initial filler (ms) - default 800ms */
  initialDelay?: number
  /** Base time before first extended filler (ms) - default 6000ms */
  extendedInterval?: number
  /** How much to increase the interval each time (ms) - default 3000ms */
  extendedIntervalIncrement?: number
  /** Whether to use stage-specific fillers when available */
  useStageFillers?: boolean
  /** Whether to use tool-specific fillers when available (default: true) */
  useToolFillers?: boolean
  /** Enable verbose logging */
  verbose?: boolean
}

/**
 * Context for the current filler session
 */
export interface FillerContext {
  stage?: string
  tool?: ToolName
  toolStatus?: "calling" | "completed"
  paymentStatus?: string
}

export class FillerSpeechManager {
  private ttsModelId: string
  private initialDelay: number
  private extendedInterval: number
  private extendedIntervalIncrement: number
  private useStageFillers: boolean
  private useToolFillers: boolean
  private verbose: boolean

  private isActive = false
  private currentProcess: ReturnType<typeof spawn> | null = null
  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private extendedTimer: ReturnType<typeof setTimeout> | null = null
  private usedPhrases = new Set<string>()
  private extendedCount = 0  // Track how many extended fillers have played
  private currentContext: FillerContext = {}

  // Pre-synthesized audio cache for faster playback
  private audioCache = new Map<string, Buffer>()

  constructor(config: FillerSpeechConfig) {
    this.ttsModelId = config.ttsModelId
    this.initialDelay = config.initialDelay ?? 800
    this.extendedInterval = config.extendedInterval ?? 6000
    this.extendedIntervalIncrement = config.extendedIntervalIncrement ?? 3000
    this.useStageFillers = config.useStageFillers ?? true
    this.useToolFillers = config.useToolFillers ?? true
    this.verbose = config.verbose ?? false
  }

  /**
   * Pre-synthesize common filler phrases for faster playback
   */
  async prewarmCache(): Promise<void> {
    if (this.verbose) console.log("🔊 Pre-warming filler speech cache...")

    const phrasesToCache = [
      ...INITIAL_FILLERS.slice(0, 3),
      ...EXTENDED_FILLERS.slice(0, 2),
      // Add common tool-specific phrases
      ...(TOOL_CALLING_FILLERS["shop.menu"]?.slice(0, 1) || []),
      ...(TOOL_CALLING_FILLERS["payments.x402_pay"]?.slice(0, 1) || []),
      ...(TOOL_COMPLETED_FILLERS["shop.create_and_pay"]?.slice(0, 1) || []),
    ]

    for (const phrase of phrasesToCache) {
      try {
        const audio = await this.synthesize(phrase)
        this.audioCache.set(phrase, audio)
      } catch (error) {
        if (this.verbose) {
          console.warn(`⚠️ Failed to cache: "${phrase}"`, error)
        }
      }
    }

    if (this.verbose) {
      console.log(`✅ Cached ${this.audioCache.size} filler phrases`)
    }
  }

  /**
   * Start playing filler speech during processing
   * @param context Optional context for contextual fillers (stage, tool, etc.)
   */
  start(context?: FillerContext | string): void {
    if (this.isActive) return
    this.isActive = true

    // Handle legacy string argument (stage only)
    if (typeof context === "string") {
      this.currentContext = { stage: context }
    } else {
      this.currentContext = context || {}
    }

    if (this.verbose) {
      console.log(`🔊 Filler speech started`, this.currentContext)
    }

    // Schedule initial filler
    this.initialTimer = setTimeout(() => {
      if (!this.isActive) return
      this.playFiller("initial")
    }, this.initialDelay)
  }

  /**
   * Update the current context (e.g., when a new tool is called)
   * This allows changing what fillers are used mid-session
   */
  updateContext(context: Partial<FillerContext>): void {
    this.currentContext = { ...this.currentContext, ...context }
    if (this.verbose) {
      console.log(`🔊 Filler context updated`, this.currentContext)
    }
  }

  /**
   * Speak a filler for a specific tool being called
   * Use this when you want immediate feedback for a tool call
   */
  async speakForToolCall(tool: ToolName): Promise<void> {
    if (!this.useToolFillers) return
    
    const phrases = TOOL_CALLING_FILLERS[tool]
    if (!phrases || phrases.length === 0) return

    const phrase = this.pickUnusedPhrase(phrases)
    if (this.verbose) {
      console.log(`🗣️ [Tool Call] ${tool}: ${phrase}`)
    }
    
    try {
      await this.speak(phrase)
    } catch (error) {
      if (this.verbose) {
        console.warn("⚠️ Tool filler playback error:", error)
      }
    }
  }

  /**
   * Speak a filler for a specific tool completing
   * Use this to announce completion of important operations
   */
  async speakForToolComplete(tool: ToolName, result?: ToolResult): Promise<void> {
    if (!this.useToolFillers) return
    
    // Only speak for successful completions by default
    if (result && !result.success) return

    const phrases = TOOL_COMPLETED_FILLERS[tool]
    if (!phrases || phrases.length === 0) return

    const phrase = this.pickUnusedPhrase(phrases)
    if (this.verbose) {
      console.log(`🗣️ [Tool Complete] ${tool}: ${phrase}`)
    }
    
    try {
      await this.speak(phrase)
    } catch (error) {
      if (this.verbose) {
        console.warn("⚠️ Tool completion filler playback error:", error)
      }
    }
  }

  /**
   * Speak a filler for a payment status change
   */
  async speakForPaymentStatus(status: string): Promise<void> {
    const phrases = PAYMENT_STATUS_FILLERS[status]
    if (!phrases || phrases.length === 0) return

    const phrase = this.pickUnusedPhrase(phrases)
    if (this.verbose) {
      console.log(`🗣️ [Payment Status] ${status}: ${phrase}`)
    }
    
    try {
      await this.speak(phrase)
    } catch (error) {
      if (this.verbose) {
        console.warn("⚠️ Payment status filler playback error:", error)
      }
    }
  }

  /**
   * Stop all filler speech and clear timers
   */
  stop(): void {
    if (!this.isActive) return
    this.isActive = false

    if (this.verbose) {
      console.log("🔊 Filler speech stopped")
    }

    // Clear timers
    if (this.initialTimer) {
      clearTimeout(this.initialTimer)
      this.initialTimer = null
    }
    if (this.extendedTimer) {
      clearTimeout(this.extendedTimer)
      this.extendedTimer = null
    }

    // Kill any playing audio
    this.stopPlayback()

    // Reset state for next session
    this.usedPhrases.clear()
    this.extendedCount = 0
  }

  /**
   * Check if filler speech is currently active
   */
  isPlaying(): boolean {
    return this.isActive
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Pick a phrase from a pool that hasn't been used recently
   */
  private pickUnusedPhrase(pool: string[]): string {
    const availablePhrases = pool.filter(p => !this.usedPhrases.has(p))
    const phrase = availablePhrases.length > 0
      ? availablePhrases[Math.floor(Math.random() * availablePhrases.length)]!
      : pool[Math.floor(Math.random() * pool.length)]!

    this.usedPhrases.add(phrase)

    // Limit memory of used phrases
    if (this.usedPhrases.size > 15) {
      const oldest = this.usedPhrases.values().next().value
      if (oldest) this.usedPhrases.delete(oldest)
    }

    return phrase
  }

  /**
   * Build the phrase pool based on current context
   * Priority: tool-specific → stage-specific → generic
   */
  private buildPhrasePool(type: "initial" | "extended"): string[] {
    const { stage, tool, toolStatus } = this.currentContext

    if (type === "extended") {
      // Extended fillers are always generic (waiting messages)
      return EXTENDED_FILLERS
    }

    // For initial fillers, build pool with priority ordering
    const pool: string[] = []

    // Priority 1: Tool-specific fillers (if enabled and available)
    if (this.useToolFillers && tool) {
      if (toolStatus === "completed") {
        const toolCompletedPhrases = TOOL_COMPLETED_FILLERS[tool]
        if (toolCompletedPhrases) {
          pool.push(...toolCompletedPhrases)
        }
      } else {
        // Default to "calling" status
        const toolCallingPhrases = TOOL_CALLING_FILLERS[tool]
        if (toolCallingPhrases) {
          pool.push(...toolCallingPhrases)
        }
      }
    }

    // Priority 2: Stage-specific fillers (if enabled and available)
    if (this.useStageFillers && stage && STAGE_FILLERS[stage]) {
      pool.push(...STAGE_FILLERS[stage]!)
    }

    // Priority 3: Generic initial fillers (always available as fallback)
    pool.push(...INITIAL_FILLERS)

    return pool
  }

  private async playFiller(type: "initial" | "extended"): Promise<void> {
    if (!this.isActive) return

    // Build phrase pool based on current context and priority
    const pool = this.buildPhrasePool(type)
    const phrase = this.pickUnusedPhrase(pool)

    if (this.verbose) {
      const contextStr = this.currentContext.tool 
        ? `tool:${this.currentContext.tool}` 
        : this.currentContext.stage 
          ? `stage:${this.currentContext.stage}` 
          : "generic"
      console.log(`🗣️ [Filler ${type}] (${contextStr}) ${phrase}`)
    }

    try {
      await this.speak(phrase)

      // Schedule next extended filler with progressive delay
      if (this.isActive) {
        this.scheduleNextExtendedFiller()
      }
    } catch (error) {
      if (this.verbose) {
        console.warn("⚠️ Filler playback error:", error)
      }
    }
  }

  /**
   * Schedule the next extended filler with progressive delay
   * Delay = extendedInterval + (extendedCount * extendedIntervalIncrement)
   * e.g., with defaults: 6s, 9s, 12s, 15s, ...
   */
  private scheduleNextExtendedFiller(): void {
    if (!this.isActive) return

    const delay = this.extendedInterval + (this.extendedCount * this.extendedIntervalIncrement)
    this.extendedCount++

    if (this.verbose) {
      console.log(`🔊 Next filler in ${delay / 1000}s`)
    }

    this.extendedTimer = setTimeout(() => {
      if (this.isActive) {
        this.playFiller("extended")
      }
    }, delay)
  }

  private async synthesize(text: string): Promise<Buffer> {
    const result = textToSpeech({
      modelId: this.ttsModelId,
      text,
      inputType: "text",
      stream: false,
    })

    const audioBuffer = await result.buffer
    const audioData = int16ArrayToBuffer(audioBuffer)
    return Buffer.concat([createWavHeader(audioData.length), audioData])
  }

  private async speak(text: string): Promise<void> {
    if (!this.isActive) return

    // Check cache first
    let wavBuffer = this.audioCache.get(text)
    if (!wavBuffer) {
      wavBuffer = await this.synthesize(text)
    }

    await this.playAudio(wavBuffer)
  }

  private playAudio(audioBuffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isActive) {
        resolve()
        return
      }

      const tempFile = `/tmp/filler-${Date.now()}.wav`
      writeFileSync(tempFile, audioBuffer)

      const currentPlatform = platform()
      let audioPlayer: string
      let args: string[]

      switch (currentPlatform) {
        case "darwin":
          audioPlayer = "afplay"
          args = [tempFile]
          break
        case "linux":
          audioPlayer = "aplay"
          args = [tempFile]
          break
        case "win32":
          audioPlayer = "powershell"
          args = ["-Command", `(New-Object Media.SoundPlayer '${tempFile}').PlaySync()`]
          break
        default:
          audioPlayer = "aplay"
          args = [tempFile]
      }

      this.currentProcess = spawn(audioPlayer, args, { stdio: "ignore" })

      this.currentProcess.on("close", (code) => {
        this.currentProcess = null
        try {
          unlinkSync(tempFile)
        } catch {
          // Ignore cleanup errors
        }
        if (code === 0 || code === null) {
          resolve()
        } else {
          reject(new Error(`Audio player exited with code ${code}`))
        }
      })

      this.currentProcess.on("error", (error) => {
        this.currentProcess = null
        try {
          unlinkSync(tempFile)
        } catch {
          // Ignore cleanup errors
        }
        reject(error)
      })
    })
  }

  private stopPlayback(): void {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM")
      this.currentProcess = null
    }
  }
}

// ============================================================================
// Convenience Functions - Wrap async operations with filler speech
// ============================================================================

/**
 * Execute an async operation while playing filler speech to fill the silence
 * 
 * @example
 * ```typescript
 * const result = await withFillerSpeech(
 *   async () => agent.processMessage(text),
 *   fillerManager,
 *   { stage: "COLLECT_INFO", tool: "shop.menu" }
 * )
 * ```
 */
export async function withFillerSpeech<T>(
  operation: () => Promise<T>,
  manager: FillerSpeechManager,
  options?: FillerContext | { stage?: string }
): Promise<T> {
  manager.start(options)
  try {
    return await operation()
  } finally {
    manager.stop()
  }
}

/**
 * Create a tool call handler that speaks contextual fillers
 * Use this with agent.setCallbacks() for automatic filler speech on tool calls
 * 
 * @example
 * ```typescript
 * const fillerManager = new FillerSpeechManager({ ttsModelId: "..." })
 * agent.setCallbacks({
 *   onToolCall: createToolCallFillerHandler(fillerManager)
 * })
 * ```
 */
export function createToolCallFillerHandler(manager: FillerSpeechManager) {
  return async (
    tool: ToolName,
    _args: Record<string, unknown>,
    status: "calling" | "completed",
    result?: ToolResult
  ) => {
    if (status === "calling") {
      // Speak immediately when tool is called
      await manager.speakForToolCall(tool)
    } else if (status === "completed") {
      // Speak completion message for important tools
      await manager.speakForToolComplete(tool, result)
    }
  }
}

/**
 * Higher-level handler that combines filler speech with payment status tracking
 * 
 * @example
 * ```typescript
 * const handler = createSmartFillerHandler(fillerManager)
 * agent.setCallbacks({
 *   onToolCall: handler.onToolCall,
 *   onStateChange: handler.onStateChange
 * })
 * ```
 */
export function createSmartFillerHandler(manager: FillerSpeechManager) {
  let lastPaymentStatus: string | undefined

  return {
    onToolCall: async (
      tool: ToolName,
      args: Record<string, unknown>,
      status: "calling" | "completed",
      result?: ToolResult
    ) => {
      console.log(`🔔 [Filler Handler] Tool: ${tool}, Status: ${status}`)
      
      if (status === "calling") {
        // Check if this tool has specific fillers
        const hasSpecificFiller = TOOL_CALLING_FILLERS[tool] && TOOL_CALLING_FILLERS[tool]!.length > 0
        console.log(`   Has specific filler: ${hasSpecificFiller}`)
        
        await manager.speakForToolCall(tool)
      } else if (status === "completed") {
        await manager.speakForToolComplete(tool, result)
      }
    },

    onStateChange: async (state: { execution?: { payment_status?: string } }) => {
      const currentStatus = state.execution?.payment_status
      if (currentStatus && currentStatus !== lastPaymentStatus) {
        console.log(`🔔 [Filler Handler] Payment status changed: ${lastPaymentStatus} -> ${currentStatus}`)
        await manager.speakForPaymentStatus(currentStatus)
        lastPaymentStatus = currentStatus
      }
    },
  }
}
