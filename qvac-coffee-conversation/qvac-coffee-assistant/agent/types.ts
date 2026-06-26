// ============================================================================
// Agent Types - Agentic ReAct Architecture
// ============================================================================

// ============================================================================
// Stage Definitions
// ============================================================================

/**
 * Agent stages for the coffee ordering flow
 */
export type Stage =
  | "COLLECT_INFO"
  | "CONFIRM"
  | "EXECUTE"
  | "DONE"
  | "FAILED"

// ============================================================================
// Agent State - Canonical State Shape
// ============================================================================

/**
 * User information state
 */
export interface UserState {
  name?: string
  name_confirmed: boolean
}

/**
 * Fulfillment state - pickup only (customer collects voucher from human colleague)
 */
export interface FulfillmentState {
  mode: "pickup"
}

/**
 * Order details state
 */
export interface OrderState {
  drink?: string
  options?: string[]
}

/**
 * Payment state
 */
/**
 * Supported payment currencies
 */
export type PaymentCurrency = "sats" | "USDT" | "USDC" | "ETH"

export interface PaymentState {
  currency: PaymentCurrency
  ready: boolean
}

/**
 * Confirmation state
 */
export interface ConfirmationState {
  user_confirmed: boolean
  summary_shown: boolean
}

/**
 * Execution state - tracks order processing
 */
export interface ExecutionState {
  order_id?: string
  payment_status?: "pending" | "processing" | "completed" | "failed"
  idempotency_key?: string
  quote?: Quote
  x402_requirements?: X402Requirements
  payment_proof?: string
  error?: string
}

/**
 * Turn counter state
 */
export interface CountersState {
  turns_total: number
  max_turns_total: number
}

/**
 * Complete agent state - the canonical state machine
 */
export interface AgentState {
  stage: Stage
  user: UserState
  fulfillment: FulfillmentState
  order: OrderState
  payment: PaymentState
  confirmation: ConfirmationState
  execution: ExecutionState
  counters: CountersState
}

/**
 * Create initial agent state
 */
export const createInitialState = (
  maxTurns = 25,
  currency: PaymentCurrency = "sats"
): AgentState => ({
  stage: "COLLECT_INFO",
  user: { name_confirmed: false },
  fulfillment: { mode: "pickup" },
  order: {},
  payment: { currency, ready: false },
  confirmation: { user_confirmed: false, summary_shown: false },
  execution: {},
  counters: { turns_total: 0, max_turns_total: maxTurns },
})

// ============================================================================
// State Patch - For tool-mediated updates
// ============================================================================

/**
 * Partial state for patching via state.patch tool
 */
export interface StatePatch {
  user?: Partial<UserState>
  fulfillment?: Partial<FulfillmentState>
  order?: Partial<OrderState>
  payment?: Partial<PaymentState>
  confirmation?: Partial<ConfirmationState>
  execution?: Partial<ExecutionState>
}

// ============================================================================
// Tool System Types
// ============================================================================

/**
 * Tool names available to the agent
 */
export type ToolName =
  | "state.get"
  | "state.patch"
  | "state.missing_fields"
  | "state.advance_if_ready"
  | "state.summary"
  | "state.confirm_order"
  | "state.patch_and_check"
  | "state.start_new_order"
  // "profile.get_defaults" removed - no longer using profile defaults
  | "shop.search"
  | "shop.menu"
  | "shop.get_quote"
  | "shop.create_order"
  | "shop.create_and_pay"
  | "payments.x402_request"
  | "payments.x402_pay"
  | "payments.lightning_invoice"
  | "payments.spark_invoice"
  | "payments.check_lightning"
  | "payments.check_spark"
  | "shop.complete_with_payment"

/**
 * Tool call from LLM
 */
export interface ToolCall {
  tool: ToolName
  args: Record<string, unknown>
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  /** Short TTS-friendly response for voice output */
  tts_response?: string
  /** Flag to display menu visually in UI */
  display_menu?: boolean
}

/**
 * Tool definition with gating and execution
 */
export interface Tool {
  name: ToolName
  description: string
  parameters: ToolParameterSchema
  gate?: (state: AgentState) => string | null
  execute: (args: Record<string, unknown>, state: AgentState, context: ToolContext) => Promise<ToolResult>
}

/**
 * Tool parameter schema (JSON Schema subset)
 */
export interface ToolParameterSchema {
  type: "object"
  properties: Record<string, ToolPropertySchema>
  required?: string[]
}

export interface ToolPropertySchema {
  type: "string" | "number" | "boolean" | "object" | "array"
  description?: string
  enum?: string[]
  items?: ToolPropertySchema
  properties?: Record<string, ToolPropertySchema>
}

/**
 * Context passed to tool execution
 */
export interface ToolContext {
  coffeeShopApiUrl: string
  wdk: WDKContext | null
  wdkManager?: any  // Full TetherWDKManager for real blockchain transactions
  lightningProcessor?: any  // Lightning Network processor for instant BTC payments
  updateState: (patch: StatePatch) => void
  getState: () => AgentState
  setStage: (stage: Stage) => void
  resetAgent?: () => void  // Reset agent for new order
}

/**
 * WDK context for wallet operations
 */
export interface WDKContext {
  getAccount: () => Promise<WDKAccount>
  signMessage: (message: string) => Promise<string>
  getAddress: () => Promise<string>
  sendTransaction?: (tx: TransactionRequest) => Promise<TransactionResult>
}

export interface WDKAccount {
  address: string
  signMessage: (message: string) => Promise<string>
  getBalance?: () => Promise<string>
}

export interface TransactionRequest {
  to: string
  value: string
  data?: string
}

export interface TransactionResult {
  hash: string
  fee?: string
}

// ============================================================================
// LLM Response Types
// ============================================================================

/**
 * Single tool call for multi-tool batching
 */
export interface MultiToolCallItem {
  tool: ToolName
  args: Record<string, unknown>
}

/**
 * LLM response - single tool call, multi-tool call, or text response
 */
export type LLMResponse =
  | { type: "tool_call"; tool: ToolName; args: Record<string, unknown> }
  | { type: "multi_tool_call"; tools: MultiToolCallItem[] }
  | { type: "response"; text: string }
  | { type: "error"; message: string }

/**
 * Conversation message
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_call_id?: string
  timestamp?: string
}

// ============================================================================
// API Types - Coffee Shop
// ============================================================================

/**
 * Quote from coffee shop API
 */
export interface Quote {
  items: QuoteLineItem[]
  subtotal: number
  deliveryFee: number
  total: number
  currency: string
  validUntil: string
}

export interface QuoteLineItem {
  drinkId: string
  drinkName: string
  options: { id: string; name: string; price: number }[]
  quantity: number
  unitPrice: number
  lineTotal: number
}

/**
 * Order from coffee shop API
 */
export interface Order {
  id: string
  items: OrderItem[]
  fulfillment: OrderFulfillment
  customerName: string
  subtotal: number
  deliveryFee: number
  total: number
  currency: string
  status: string
  paymentProof?: string
  createdAt: string
  updatedAt: string
}

export interface OrderItem {
  drinkId: string
  options: string[]
  quantity: number
}

export interface OrderFulfillment {
  mode: "delivery" | "pickup"
  address?: string
  instructions?: string
}

/**
 * x402 Payment Requirements
 */
export interface X402Requirements {
  amount: number
  currency: string
  recipient: string
  network: string
  validUntil: string
  orderId: string
  nonce: string
  lightningInvoice?: string  // Lightning invoice (optional)
  sparkInvoice?: string      // Spark invoice (optional)
}

/**
 * x402 Payment Proof
 */
export interface X402PaymentProof {
  signature: string
  payerAddress: string
  timestamp: string
  nonce: string
}

// ============================================================================
// User Profile
// ============================================================================

/**
 * User profile stored on disk
 */
export interface UserProfile {
  name: string
  defaultAddress?: string
  preferredPaymentCurrency: string
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * QR code data for order display
 */
export interface OrderQRCodeData {
  orderId: string
  timestamp: string
  customerName?: string
  currency?: string
  items: Array<{
    drink: string
    extras?: string[]
  }>
  total?: number
  txHash?: string
  txLink?: string
  receiptUrl?: string
}

/**
 * Recovery context - provides details about what failed and why
 */
export interface RecoveryContext {
  toolName: string
  error: string
  recoveryType: "state.summary" | "state.confirm_order" | "missing_fields" | "generic"
  attemptNumber: number
  maxAttempts: number
}

/**
 * Agent event callbacks for real-time updates
 */
export interface AgentCallbacks {
  onToolCall?: (tool: ToolName, args: Record<string, unknown>, status: "calling" | "completed", result?: ToolResult) => void
  onStateChange?: (state: AgentState, previousStage: Stage) => void
  onLLMResponse?: (text: string, isFinal: boolean) => void
  onQRCode?: (data: OrderQRCodeData, imageDataUrl: string) => void
  onRecoveryAttempt?: (context: RecoveryContext) => void
}

/**
 * Supported languages for the agent
 */
export type SupportedLanguage = "en" | "es"

/**
 * Agent configuration
 */
export interface AgentConfig {
  maxTurns: number
  defaultCurrency: PaymentCurrency
  coffeeShopApiUrl: string
  llmModelId?: string
  wdkSeedPhrase?: string
  wdkMode?: "mock" | "testnet"
  verbose?: boolean
  callbacks?: AgentCallbacks
  language?: SupportedLanguage
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxTurns: 25,
  defaultCurrency: "sats",
  coffeeShopApiUrl: "http://localhost:3457",
  wdkMode: "mock",
  verbose: false,
}

// ============================================================================
// Agent Loop Types
// ============================================================================

/**
 * Agent turn result
 */
export interface TurnResult {
  response: string
  state: AgentState
  toolsCalled: ToolCall[]
  turnsUsed: number
  complete: boolean
  error?: string
}

/**
 * Agent session
 */
export interface AgentSession {
  id: string
  state: AgentState
  messages: Message[]
  startedAt: string
  lastActivityAt: string
}