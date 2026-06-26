// ============================================================================
// Coffee Menu Types
// ============================================================================

export type DrinkOption = {
  id: string
  name: string
  price: number // Additional cost in USDT
  aliases?: string[] // Alternative names (e.g., Spanish translations)
}

export type DrinkCategory = "espresso" | "espresso-milk" | "cold" | "extras"

export type Drink = {
  id: string
  name: string
  description: string
  category: DrinkCategory
  price: number // Price in USDT
  availableOptions: string[] // Option IDs that can be added
  imageUrl?: string
  available: boolean
  aliases?: string[] // Alternative names (e.g., Spanish translations)
}

export type CoffeeMenu = {
  drinks: Drink[]
  options: DrinkOption[]
}

// ============================================================================
// Order Types
// ============================================================================

export type OrderItem = {
  drinkId: string
  options: string[] // Option IDs
  quantity: number
}

export type FulfillmentMode = "delivery" | "pickup"

export type Fulfillment = {
  mode: FulfillmentMode
  address?: string // Required for delivery
  store?: string // Required for pickup
  instructions?: string
}

export type OrderStatus = 
  | "pending_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "completed"
  | "cancelled"

export type Order = {
  id: string
  items: OrderItem[]
  fulfillment: Fulfillment
  customerName: string
  subtotal: number
  deliveryFee: number
  total: number
  currency: string
  status: OrderStatus
  paymentProof?: string
  createdAt: string
  updatedAt: string
}

// ============================================================================
// Quote Types
// ============================================================================

export type QuoteRequest = {
  items: OrderItem[]
  fulfillment: Fulfillment
}

export type QuoteLineItem = {
  drinkId: string
  drinkName: string
  options: { id: string; name: string; price: number }[]
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type Quote = {
  items: QuoteLineItem[]
  subtotal: number
  deliveryFee: number
  total: number
  currency: string
  validUntil: string // ISO timestamp
}

// ============================================================================
// Create Order Types
// ============================================================================

export type CreateOrderRequest = {
  items: OrderItem[]
  fulfillment: Fulfillment
  customerName: string
  idempotencyKey?: string
}

// ============================================================================
// x402 Payment Types
// ============================================================================

export type X402PaymentRequirements = {
  amount: number
  currency: string
  recipient: string
  network: string
  validUntil: string
  orderId: string
  nonce: string
  lightningInvoice?: string // BOLT11 invoice for Lightning payments
}

export type X402PaymentProof = {
  signature: string
  payerAddress: string
  timestamp: string
  nonce: string
}

// ============================================================================
// API Response Types
// ============================================================================

export type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

export type PaymentRequiredResponse = {
  success: false
  error: "payment_required"
  paymentRequirements: X402PaymentRequirements
}

// ============================================================================
// Store Types
// ============================================================================

export type Store = {
  id: string
  name: string
  address: string
  city: string
  hours: string
  available: boolean
}

