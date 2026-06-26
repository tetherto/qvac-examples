import { menu, getDrinkById, getDrinkByNameOrAlias, getOptionById, getStoreById, stores, calculateItemPrice, DELIVERY_FEE, PICKUP_FEE } from "./data/menu"
import { getTetherWDK, type TetherWDKManager } from "../tether-wdk"
import * as path from "path"
import * as fs from "fs"
import type {
  Order,
  OrderItem,
  Quote,
  QuoteRequest,
  QuoteLineItem,
  CreateOrderRequest,
  ApiResponse,
  X402PaymentRequirements,
  X402PaymentProof,
  PaymentRequiredResponse,
  CoffeeMenu,
  Store,
} from "./types"

// ============================================================================
// Global Error Handlers - Prevent crashes from unhandled errors
// ============================================================================

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  Unhandled Promise Rejection:', reason)
  // Don't exit - log and continue
})

process.on('uncaughtException', (error) => {
  console.error('⚠️  Uncaught Exception:', error)
  // Check if it's a Spark-related error and don't crash
  const errorMessage = error instanceof Error ? error.message : String(error)
  if (errorMessage.includes('Spark') || 
      errorMessage.includes('Authentication') || 
      errorMessage.includes('Transport error') ||
      errorMessage.includes('Unable to connect')) {
    console.warn('   Spark-related error caught - server continuing...')
    return // Don't exit
  }
  // For other critical errors, you might want to exit
  // process.exit(1)
})

// ============================================================================
// Configuration
// ============================================================================

// Payment mode derived from USE_REAL_PAYMENTS
// "true" = testnet (real blockchain transactions), else mock
const USE_REAL_PAYMENTS = process.env.USE_REAL_PAYMENTS === "true"
const X402_MODE = USE_REAL_PAYMENTS ? "testnet" : "mock"

const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT ?? "0xCoffeeShop1234567890abcdef1234567890abcdef"
const PAYMENT_NETWORK = process.env.PAYMENT_NETWORK ?? "base-sepolia"
const PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY ?? "USDT"
const PAYMENT_TTL_SECONDS = 300 // 5 minutes
// This demo prices and charges ONLY in sats (satoshis, the fraction of Bitcoin).
// USD menu prices are converted to sats at a fixed, offline, deterministic demo rate
// (1 USD = 1000 sats -> $3.50 = 3500 sats). No network rate fetch, no USDT/fiat surfaced.
const SATS_PER_USD = parseInt(process.env.SATS_PER_USD ?? "1000")
const usdToSats = (usd: number): number => Math.round(usd * SATS_PER_USD)

// Public directory for static files
const PUBLIC_DIR = path.join(import.meta.dir, "public")

// ============================================================================
// Live BTC Rate Fetching (with caching)
// ============================================================================

interface BtcRateCache {
  rate: number
  timestamp: number
}

let btcRateCache: BtcRateCache | null = null
const BTC_RATE_CACHE_TTL = Infinity // Cache forever - rate doesn't change

/**
 * Fetches live BTC/USD rate from blockchain.info with caching
 * Falls back to environment variable if API fails
 */
const getBtcUsdRate = async (): Promise<number> => {
  const fallbackRate = parseInt(process.env.BTC_USD_RATE ?? "95000")
  
  // Return cached rate if available (permanent cache - never expires)
  if (btcRateCache) {
    return btcRateCache.rate
  }
  
  try {
    console.log("💱 Fetching live BTC/USD rate from blockchain.info...")
    const response = await fetch("https://blockchain.info/ticker", {
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const data = await response.json() as { USD?: { last: number } }
    const rate = data.USD?.last
    
    if (!rate || rate <= 0) {
      throw new Error("Invalid rate data")
    }
    
    // Update cache
    btcRateCache = { rate, timestamp: Date.now() }
    console.log(`✅ Live BTC rate: $${rate.toFixed(2)} (cached for 5 min)`)
    
    return rate
  } catch (error) {
    console.warn(`⚠️  Failed to fetch live BTC rate: ${error}`)
    console.log(`   Using fallback rate: $${fallbackRate}`)
    return fallbackRate
  }
}

// ============================================================================
// Tether WDK Integration (Lazy Initialization)
// ============================================================================

let wdkManager: TetherWDKManager | null = null
let wdkInitPromise: Promise<TetherWDKManager> | null = null

const getWDK = async (): Promise<TetherWDKManager> => {
  if (wdkManager) return wdkManager
  
  if (!wdkInitPromise) {
    wdkInitPromise = (async () => {
      console.log("🔐 Initializing Tether WDK...")
      wdkManager = getTetherWDK()
      return wdkManager
    })()
  }
  
  return wdkInitPromise
}

// Shop wallet addresses (merchant receiving addresses)
const SHOP_WALLETS: Record<string, string> = {
  ethereum: process.env.SHOP_WALLET_ETH ?? "0x742d35Cc6634C0532925a3b844D9C5c8b7b6e5f6",
  bitcoin: process.env.SHOP_WALLET_BTC ?? "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  solana: process.env.SHOP_WALLET_SOL ?? "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
  tron: process.env.SHOP_WALLET_TRX ?? "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
}

// Network mode from environment
const NETWORK_MODE = process.env.NETWORK_MODE ?? "testnet"
const IS_MAINNET = NETWORK_MODE === "mainnet"

// USDT contract addresses for each chain (selected based on NETWORK_MODE)
const USDT_CONTRACTS_TESTNET: Record<string, string> = {
  ethereum: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06", // USDT on Sepolia testnet
  tron: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", // USDT TRC-20 on TRON Nile testnet
  solana: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // USDT on Solana devnet
}

const USDT_CONTRACTS_MAINNET: Record<string, string> = {
  ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT on Ethereum mainnet
  tron: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT TRC-20 on TRON mainnet
  solana: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT on Solana mainnet
}

const USDT_CONTRACTS = IS_MAINNET ? USDT_CONTRACTS_MAINNET : USDT_CONTRACTS_TESTNET

// ============================================================================
// In-Memory Orders Store
// ============================================================================

const orders: Map<string, Order> = new Map()
const idempotencyKeys: Map<string, string> = new Map() // key -> orderId
let orderCounter = 1

const generateOrderId = (): string => {
  const id = `ORD-${new Date().getFullYear()}-${String(orderCounter++).padStart(4, "0")}`
  return id
}

const generateNonce = (): string => {
  return crypto.randomUUID()
}

// ============================================================================
// Lightning Address Resolution (LNURL-pay)
// ============================================================================

/**
 * Check if a string is a Lightning Address (user@domain.com format)
 */
const isLightningAddress = (address: string): boolean => {
  return address.includes('@') && address.includes('.')
}

/**
 * Resolve Lightning Address to BOLT11 invoice using LNURL-pay protocol
 */
const resolveLightningAddress = async (
  lightningAddress: string, 
  amountSats: number, 
  memo?: string
): Promise<string> => {
  console.log(`⚡ Resolving Lightning Address: ${lightningAddress}`)
  
  // Parse Lightning Address (user@domain.com)
  const [username, domain] = lightningAddress.split('@')
  if (!username || !domain) {
    throw new Error('Invalid Lightning Address format (should be user@domain.com)')
  }
  
  // Step 1: Resolve LNURL-pay endpoint
  const lnurlpayUrl = `https://${domain}/.well-known/lnurlp/${username}`
  console.log(`   Fetching LNURL-pay endpoint: ${lnurlpayUrl}`)
  
  const lnurlResponse = await fetch(lnurlpayUrl)
  if (!lnurlResponse.ok) {
    throw new Error(`Failed to resolve Lightning Address: ${lnurlResponse.statusText}`)
  }
  
  const lnurlData = await lnurlResponse.json()
  console.log(`   ✅ LNURL-pay endpoint resolved`)
  
  // Step 2: Get invoice from callback URL
  const amountMsat = amountSats * 1000  // Convert sats to millisats
  const callbackUrl = `${lnurlData.callback}?amount=${amountMsat}`
  console.log(`   Requesting invoice from callback...`)
  
  const invoiceResponse = await fetch(callbackUrl)
  if (!invoiceResponse.ok) {
    throw new Error(`Failed to get invoice: ${invoiceResponse.statusText}`)
  }
  
  const invoiceData = await invoiceResponse.json()
  
  if (invoiceData.status === 'ERROR') {
    throw new Error(invoiceData.reason || 'Failed to get invoice from Lightning Address')
  }
  
  const invoice = invoiceData.pr
  if (!invoice) {
    throw new Error('No invoice returned from Lightning Address')
  }
  
  console.log(`   ✅ Invoice received: ${invoice.substring(0, 30)}...`)
  return invoice
}

// ============================================================================
// Helper Functions
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Payment-Proof, X-Idempotency-Key",
}

const jsonResponse = <T>(data: ApiResponse<T>, status = 200): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  })
}

const paymentRequiredResponse = (requirements: X402PaymentRequirements): Response => {
  const response: PaymentRequiredResponse = {
    success: false,
    error: "payment_required",
    paymentRequirements: requirements,
  }
  return new Response(JSON.stringify(response), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Required": JSON.stringify(requirements),
      ...corsHeaders,
    },
  })
}

// ============================================================================
// Quote Calculation
// ============================================================================

const calculateQuote = async (request: QuoteRequest): Promise<Quote | { error: string }> => {
  const lineItems: QuoteLineItem[] = []
  let subtotal = 0

  for (const item of request.items) {
    // Try to find drink by ID first, then by name/alias (supports Spanish names like "café con leche")
    let drink = getDrinkById(item.drinkId)
    if (!drink) {
      drink = getDrinkByNameOrAlias(item.drinkId)
    }
    if (!drink) {
      return { error: `Drink not found: ${item.drinkId}` }
    }
    if (!drink.available) {
      return { error: `Drink not available: ${drink.name}` }
    }

    // Validate options
    const resolvedOptions: { id: string; name: string; price: number }[] = []
    for (const optionId of item.options) {
      const option = getOptionById(optionId)
      if (!option) {
        return { error: `Option not found: ${optionId}` }
      }
      if (!drink.availableOptions.includes(optionId)) {
        return { error: `Option ${option.name} not available for ${drink.name}` }
      }
      resolvedOptions.push({ id: option.id, name: option.name, price: option.price })
    }

    // Use the canonical drink ID for pricing. Default quantity to 1 (one drink per order in this
    // demo) so a missing/NaN quantity can't make lineTotal NaN -> JSON null -> "0 sats".
    const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1
    const unitPrice = calculateItemPrice(drink.id, item.options)
    const lineTotal = unitPrice * qty

    lineItems.push({
      drinkId: drink.id,
      drinkName: drink.name,
      options: resolvedOptions,
      quantity: qty,
      unitPrice,
      lineTotal,
    })

    subtotal += lineTotal
  }

  // Calculate delivery fee
  let deliveryFee = 0
  if (request.fulfillment.mode === "delivery") {
    if (!request.fulfillment.address) {
      return { error: "Delivery address is required for delivery orders" }
    }
    deliveryFee = DELIVERY_FEE
  } else if (request.fulfillment.mode === "pickup") {
    // Pickup orders don't require store selection - single store
    deliveryFee = PICKUP_FEE
  }
  // Remove this hack as it is added to reduce sats payments as we have low balance in shop wallet
  const total = (subtotal + deliveryFee )

  // Quote valid for 10 minutes
  const validUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  // Sat-only demo: always quote in satoshis at the fixed demo rate. No fiat/USDT.
  return {
    items: lineItems,
    subtotal: usdToSats(subtotal),
    deliveryFee: usdToSats(deliveryFee),
    total: usdToSats(total),
    currency: "sats",
    validUntil,
  }
}

// ============================================================================
// x402 Payment Verification
// ============================================================================

const parsePaymentProof = (header: string | null): X402PaymentProof | null => {
  if (!header) return null
  try {
    return JSON.parse(header) as X402PaymentProof
  } catch {
    return null
  }
}

const verifyPaymentProof = (
  proof: X402PaymentProof,
  requirements: X402PaymentRequirements
): boolean => {
  // In mock mode, accept any properly structured proof
  if (X402_MODE === "mock") {
    // Basic validation
    if (!proof.signature || !proof.payerAddress || !proof.timestamp || !proof.nonce) {
      return false
    }
    // Check nonce matches
    if (proof.nonce !== requirements.nonce) {
      return false
    }
    // Check timestamp is recent (within 5 minutes)
    const proofTime = new Date(proof.timestamp).getTime()
    const now = Date.now()
    if (Math.abs(now - proofTime) > 5 * 60 * 1000) {
      return false
    }
    return true
  }

  // In testnet mode, would verify actual signature on-chain
  // For now, just return true for testnet as well (placeholder)
  console.log(`[x402] Verifying payment proof in ${X402_MODE} mode`)
  return true
}

// ============================================================================
// Request Handlers
// ============================================================================

const handleGetMenu = (): Response => {
  // Sat-only demo: expose menu prices in sats (converted from the internal USD prices)
  // so the UI and the agent's fallback pricing match the sat quote. currency = "sats".
  const satMenu = {
    ...menu,
    currency: "sats",
    drinks: menu.drinks.map((d) => ({ ...d, price: usdToSats(d.price) })),
    options: menu.options.map((o) => ({ ...o, price: usdToSats(o.price) })),
  }
  return jsonResponse<CoffeeMenu>({ success: true, data: satMenu as CoffeeMenu })
}

const handleGetStores = (): Response => {
  const availableStores = stores.filter((s) => s.available)
  return jsonResponse<Store[]>({ success: true, data: availableStores })
}

const handlePostQuote = async (request: Request): Promise<Response> => {
  try {
    const body = (await request.json()) as QuoteRequest

    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return jsonResponse({ success: false, error: "At least one item is required" }, 400)
    }

    if (!body.fulfillment || !body.fulfillment.mode) {
      return jsonResponse({ success: false, error: "Fulfillment mode is required" }, 400)
    }

    const quote = await calculateQuote(body)

    if ("error" in quote) {
      return jsonResponse({ success: false, error: quote.error }, 400)
    }

    return jsonResponse<Quote>({ success: true, data: quote })
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Invalid request body",
      },
      400
    )
  }
}

const handleCreateOrder = async (request: Request): Promise<Response> => {
  try {
    const body = (await request.json()) as CreateOrderRequest
    const paymentProofHeader = request.headers.get("X-Payment-Proof")

    // Track existing order from idempotency lookup (for payment completion flow)
    let existingPendingOrder: Order | null = null
    let existingOrderIdFromIdempotency: string | null = null

    // Check idempotency key
    const idempotencyKey = request.headers.get("X-Idempotency-Key") ?? body.idempotencyKey
    if (idempotencyKey) {
      const existingOrderId = idempotencyKeys.get(idempotencyKey)
      if (existingOrderId) {
        const existingOrder = orders.get(existingOrderId)
        if (existingOrder) {
          // FIX: If payment proof is provided and order is pending_payment, continue to process payment
          // instead of returning the cached pending order
          if (paymentProofHeader && existingOrder.status === "pending_payment") {
            // Store the existing order info so we can update it below
            existingPendingOrder = existingOrder
            existingOrderIdFromIdempotency = existingOrderId
            // Continue to process the payment proof below - don't return cached order
          } else {
            return jsonResponse<Order>({ success: true, data: existingOrder })
          }
        }
      }
    }

    // Validate request
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return jsonResponse({ success: false, error: "At least one item is required" }, 400)
    }

    if (!body.fulfillment || !body.fulfillment.mode) {
      return jsonResponse({ success: false, error: "Fulfillment mode is required" }, 400)
    }

    if (!body.customerName) {
      return jsonResponse({ success: false, error: "Customer name is required" }, 400)
    }

    // Calculate quote for total
    const quote = await calculateQuote({
      items: body.items,
      fulfillment: body.fulfillment,
    })

    if ("error" in quote) {
      return jsonResponse({ success: false, error: quote.error }, 400)
    }

    // Generate order ID and nonce for payment (or reuse existing if completing a pending order)
    const orderId = existingOrderIdFromIdempotency ?? generateOrderId()
    const nonce = generateNonce()

    // Check for payment proof (already retrieved at start of function)
    const paymentProof = parsePaymentProof(paymentProofHeader)

    if (!paymentProof) {
      // No payment proof - return 402 Payment Required
      const requirements: X402PaymentRequirements = {
        amount: quote.total,
        currency: quote.currency,
        recipient: PAYMENT_RECIPIENT,
        network: PAYMENT_NETWORK,
        validUntil: new Date(Date.now() + PAYMENT_TTL_SECONDS * 1000).toISOString(),
        orderId,
        nonce,
      }

      // Generate Lightning invoice if payment is BTC/Lightning
      if (PAYMENT_NETWORK === "LIGHTNING" || quote.currency === "sats") {
        try {
          let lightningInvoice: string
          
          // Check if PAYMENT_RECIPIENT is a Lightning Address
          if (isLightningAddress(PAYMENT_RECIPIENT)) {
            console.log(`   Using Lightning Address: ${PAYMENT_RECIPIENT}`)
            lightningInvoice = await resolveLightningAddress(
              PAYMENT_RECIPIENT,
              quote.total,
              `Order ${orderId} - ${body.customerName}`
            )
            console.log(`✅ Generated Lightning invoice from Lightning Address`)
            console.log(`   Amount: ${quote.total} sats`)
            console.log(`   Invoice: ${lightningInvoice.substring(0, 30)}...`)
          } else {
            // Use WDK Spark account to generate invoice
            const wdk = await getWDK()
            const shopAccount = await wdk.getSparkAccount(1) // Shop wallet (index 1)
            console.log(`   Shop Spark account ready, creating invoice for ${quote.total} sats...`)
            
            const invoiceData = await shopAccount.createLightningInvoice({
              amountSats: quote.total,
              memo: `Order ${orderId} - ${body.customerName}`
            })
            
            // Extract the BOLT11 invoice string
            lightningInvoice = typeof invoiceData.invoice === 'string'
              ? invoiceData.invoice
              : invoiceData.encodedInvoice || invoiceData.invoice?.encodedInvoice || JSON.stringify(invoiceData.invoice)
            
            console.log(`✅ Generated Lightning invoice for order ${orderId}`)
            console.log(`   Amount: ${quote.total} sats`)
            console.log(`   Invoice: ${lightningInvoice.substring(0, 30)}...`)
          }
          
          requirements.lightningInvoice = lightningInvoice
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error(`❌ Failed to generate Lightning invoice:`, error)
          if (X402_MODE === "mock") {
            // Mock/demo mode: Spark/Lightning network is unavailable (e.g. offline). Don't hard-fail
            // the demo with a 500 - fall back to a deterministic placeholder BOLT11 so the QR still
            // shows and the order completes (verifyPaymentProof accepts any proof in mock mode).
            const tag = orderId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24)
            requirements.lightningInvoice = `lnbc${quote.total}n1demo${tag}`
            console.warn(`⚠️  Using a MOCK Lightning invoice for order ${orderId} (Spark unavailable, mock mode).`)
          } else {
            // Real-payment mode: we MUST have a genuine invoice - fail with a clear error.
            return jsonResponse(
              { success: false, error: `Lightning invoice generation failed: ${errorMsg}. Check that Spark/WDK is properly initialized or Lightning Address is valid.` },
              500
            )
          }
        }
      }

      // Store pending order
      const pendingOrder: Order = {
        id: orderId,
        items: body.items,
        fulfillment: body.fulfillment,
        customerName: body.customerName,
        subtotal: quote.subtotal,
        deliveryFee: quote.deliveryFee,
        total: quote.total,
        currency: quote.currency,
        status: "pending_payment",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      orders.set(orderId, pendingOrder)

      if (idempotencyKey) {
        idempotencyKeys.set(idempotencyKey, orderId)
      }

      return paymentRequiredResponse(requirements)
    }

    // Payment proof provided - verify it
    // For verification, we need the requirements (retrieve from pending order or recreate)
    const pendingOrder = existingPendingOrder ?? orders.get(orderId)
    const requirements: X402PaymentRequirements = {
      amount: quote.total,
      currency: quote.currency,
      recipient: PAYMENT_RECIPIENT,
      network: PAYMENT_NETWORK,
      validUntil: new Date(Date.now() + PAYMENT_TTL_SECONDS * 1000).toISOString(),
      orderId,
      nonce: paymentProof.nonce, // Use nonce from proof for verification
    }

    if (!verifyPaymentProof(paymentProof, requirements)) {
      return jsonResponse({ success: false, error: "Invalid payment proof" }, 400)
    }

    // Payment verified - create or update order
    const now = new Date().toISOString()
    const confirmedOrder: Order = pendingOrder ?? {
      id: orderId,
      items: body.items,
      fulfillment: body.fulfillment,
      customerName: body.customerName,
      subtotal: quote.subtotal,
      deliveryFee: quote.deliveryFee,
      total: quote.total,
      currency: quote.currency,
      status: "paid",
      paymentProof: paymentProofHeader ?? undefined,
      createdAt: now,
      updatedAt: now,
    }

    confirmedOrder.status = "paid"
    confirmedOrder.paymentProof = paymentProofHeader ?? undefined
    confirmedOrder.updatedAt = now

    orders.set(confirmedOrder.id, confirmedOrder)

    if (idempotencyKey) {
      idempotencyKeys.set(idempotencyKey, confirmedOrder.id)
    }

    return jsonResponse<Order>({ success: true, data: confirmedOrder }, 201)
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Invalid request body",
      },
      400
    )
  }
}

const handleGetOrderById = (id: string): Response => {
  const normalizedId = id.toUpperCase()
  const order = orders.get(normalizedId)
  if (!order) {
    return jsonResponse({ success: false, error: "Order not found" }, 404)
  }
  return jsonResponse<Order>({ success: true, data: order })
}

const handleConfirmOrder = async (id: string): Promise<Response> => {
  const normalizedId = id.toUpperCase()
  const order = orders.get(normalizedId)
  
  if (!order) {
    return jsonResponse({ success: false, error: "Order not found" }, 404)
  }

  if (order.status === "pending_payment") {
    return jsonResponse({ success: false, error: "Order has not been paid" }, 400)
  }

  if (order.status === "cancelled") {
    return jsonResponse({ success: false, error: "Order has been cancelled" }, 400)
  }

  // Update status to preparing
  if (order.status === "paid") {
    order.status = "preparing"
    order.updatedAt = new Date().toISOString()
    orders.set(normalizedId, order)
  }

  return jsonResponse<Order>({ success: true, data: order })
}

const handleGetOrders = (url: URL): Response => {
  const status = url.searchParams.get("status")
  const customerName = url.searchParams.get("customerName")?.toLowerCase()

  let results = Array.from(orders.values())

  if (status) {
    results = results.filter((o) => o.status === status)
  }

  if (customerName) {
    results = results.filter((o) => o.customerName.toLowerCase().includes(customerName))
  }

  // Sort by creation date, newest first
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return jsonResponse<Order[]>({ success: true, data: results })
}

// ============================================================================
// Wallet API Handlers
// ============================================================================

interface WalletInfo {
  chain: string
  address: string
  balance: string
  formattedBalance: string
  usdtBalance?: string
  formattedUsdtBalance?: string
}

const formatBalance = (balance: string, chain: string): string => {
  const num = BigInt(balance)
  switch (chain) {
    case "ethereum":
      return `${(Number(num) / 1e18).toFixed(6)} ETH`
    case "bitcoin":
      return `${(Number(num) / 1e8).toFixed(8)} BTC`
    case "solana":
      return `${(Number(num) / 1e9).toFixed(4)} SOL`
    case "tron":
      return `${(Number(num) / 1e6).toFixed(2)} TRX`
    default:
      return balance
  }
}

const formatUsdtBalance = (balance: string, chain: string): string => {
  const num = BigInt(balance)
  // USDT has 6 decimals on most chains
  const decimals = chain === "solana" ? 6 : 6
  const divisor = BigInt(10 ** decimals)
  const whole = num / divisor
  const fraction = num % divisor
  return `${whole}.${fraction.toString().padStart(decimals, "0").slice(0, 2)} USDT`
}

const handleGetWallet = async (): Promise<Response> => {
  try {
    const wdk = await getWDK()
    const walletInfo: WalletInfo[] = []
    
    // Add Spark Lightning balance FIRST (Customer - Index 0)
    try {
      const sparkAccount = await wdk.getSparkAccount(0)
      const sparkBalance = await sparkAccount.getBalance()
      // Handle different balance formats
      const balanceValue = typeof sparkBalance === 'object' && sparkBalance !== null
        ? (sparkBalance.confirmed || sparkBalance.total || sparkBalance.available || 0)
        : (sparkBalance || 0)
      
      walletInfo.push({
        chain: "spark",
        address: await sparkAccount.getAddress(),
        balance: balanceValue.toString(),
        formattedBalance: `${balanceValue} sats ⚡`,
      })
    } catch (err) {
      console.warn("Could not fetch Spark balance:", err)
      walletInfo.push({
        chain: "spark",
        address: "Not available",
        balance: "0",
        formattedBalance: "0 sats",
      })
    }
    
    // Fetch other wallets - tron (USDT) last
    const chains = ["ethereum", "bitcoin", "solana", "tron"]
    const wallets = await wdk.getAllWallets()
    
    for (const chain of chains) {
      const w = wallets.find(wallet => wallet.chain === chain)
      if (!w) continue
      
      const info: WalletInfo = {
        chain: w.chain,
        address: w.address,
        balance: w.balance,
        formattedBalance: formatBalance(w.balance, w.chain),
      }
      
      // Get USDT balance if the chain supports it
      const usdtContract = USDT_CONTRACTS[w.chain]
      if (usdtContract) {
        try {
          const usdtBalance = await wdk.getTokenBalance(w.chain, usdtContract, 0)
          info.usdtBalance = usdtBalance
          info.formattedUsdtBalance = formatUsdtBalance(usdtBalance, w.chain)
        } catch (err) {
          console.warn(`Could not fetch USDT balance for ${w.chain}:`, err)
          info.usdtBalance = "0"
          info.formattedUsdtBalance = "0.00 USDT"
        }
      }
      
      walletInfo.push(info)
    }
    
    return jsonResponse({ success: true, data: walletInfo })
  } catch (error) {
    console.error("Error fetching wallet info:", error)
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Failed to fetch wallet" },
      500
    )
  }
}

const handleGetWalletByChain = async (chain: string): Promise<Response> => {
  const supportedChains = ["ethereum", "bitcoin", "solana", "tron", "spark"]
  const normalizedChain = chain.toLowerCase()
  
  if (!supportedChains.includes(normalizedChain)) {
    return jsonResponse({ success: false, error: `Unsupported chain: ${chain}` }, 400)
  }
  
  // Handle Spark separately
  if (normalizedChain === "spark") {
    try {
      const wdk = await getWDK()
      const sparkAccount = await wdk.getSparkAccount(0)
      const sparkBalance = await sparkAccount.getBalance()
      // Handle different balance formats
      const balanceValue = typeof sparkBalance === 'object' && sparkBalance !== null
        ? (sparkBalance.confirmed || sparkBalance.total || sparkBalance.available || 0)
        : (sparkBalance || 0)
      
      return jsonResponse({
        success: true,
        data: {
          chain: "spark",
          address: await sparkAccount.getAddress(),
          balance: balanceValue.toString(),
          formattedBalance: `${balanceValue} sats ⚡`,
        }
      })
    } catch (error) {
      console.error("Error fetching Spark wallet:", error)
      return jsonResponse(
        { success: false, error: error instanceof Error ? error.message : "Failed to fetch Spark wallet" },
        500
      )
    }
  }
  
  try {
    const wdk = await getWDK()
    const address = await wdk.getAddress(normalizedChain, 0)
    const balance = await wdk.getBalance(normalizedChain, 0)
    
    const walletInfo: WalletInfo = {
      chain: normalizedChain,
      address,
      balance,
      formattedBalance: formatBalance(balance, normalizedChain),
    }
    
    // Get USDT balance if the chain supports it
    const usdtContract = USDT_CONTRACTS[normalizedChain]
    if (usdtContract) {
      try {
        const usdtBalance = await wdk.getTokenBalance(normalizedChain, usdtContract, 0)
        walletInfo.usdtBalance = usdtBalance
        walletInfo.formattedUsdtBalance = formatUsdtBalance(usdtBalance, normalizedChain)
      } catch (err) {
        console.warn(`Could not fetch USDT balance for ${normalizedChain}:`, err)
        walletInfo.usdtBalance = "0"
        walletInfo.formattedUsdtBalance = "0.00 USDT"
      }
    }
    
    return jsonResponse({ success: true, data: walletInfo })
  } catch (error) {
    console.error(`Error fetching ${chain} wallet:`, error)
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Failed to fetch wallet" },
      500
    )
  }
}

const handleGetShopWallet = async (): Promise<Response> => {
  try {
    const wdk = await getWDK()
    
    // Shop wallet is at index 1 (customer is index 0)
    const SHOP_WALLET_INDEX = 1
    const shopWallets: Array<{
      chain: string
      address: string
      balance?: string
      formattedBalance?: string
      usdtBalance?: string
      formattedUsdtBalance?: string
      description: string
    }> = []
    
    // Add Spark Lightning balance FIRST (Shop - Index 1)
    try {
      const sparkAccount = await wdk.getSparkAccount(SHOP_WALLET_INDEX)
      const sparkBalance = await sparkAccount.getBalance()
      // Handle different balance formats
      const balanceValue = typeof sparkBalance === 'object' && sparkBalance !== null
        ? (sparkBalance.confirmed || sparkBalance.total || sparkBalance.available || 0)
        : (sparkBalance || 0)
      
      shopWallets.push({
        chain: "spark",
        address: await sparkAccount.getAddress(),
        balance: balanceValue.toString(),
        formattedBalance: `${balanceValue} sats ⚡`,
        description: "Coffee Shop Lightning Network (Spark) receiving wallet",
      })
    } catch (err) {
      console.warn("Could not fetch Shop Spark balance:", err)
      shopWallets.push({
        chain: "spark",
        address: "Not available",
        balance: "0",
        formattedBalance: "0 sats",
        description: "Coffee Shop Lightning Network (Spark) receiving wallet",
      })
    }
    
    // Fetch other shop wallets - tron (USDT) last
    const chains = ["ethereum", "bitcoin", "solana", "tron"]
    
    for (const chain of chains) {
      const walletInfo: {
        chain: string
        address: string
        balance?: string
        formattedBalance?: string
        usdtBalance?: string
        formattedUsdtBalance?: string
        description: string
      } = {
        chain,
        address: "",
        description: `Coffee Shop ${chain.charAt(0).toUpperCase() + chain.slice(1)} receiving address`,
      }
      
      try {
        // Get the shop wallet address from WDK
        walletInfo.address = await wdk.getAddress(chain, SHOP_WALLET_INDEX)
        
        // Get native balance
        const balance = await wdk.getBalance(chain, SHOP_WALLET_INDEX)
        walletInfo.balance = balance
        walletInfo.formattedBalance = formatBalance(balance, chain)
        
        // Get USDT balance if supported
        const usdtContract = USDT_CONTRACTS[chain]
        if (usdtContract) {
          try {
            const usdtBalance = await wdk.getTokenBalance(chain, usdtContract, SHOP_WALLET_INDEX)
            walletInfo.usdtBalance = usdtBalance
            walletInfo.formattedUsdtBalance = formatUsdtBalance(usdtBalance, chain)
          } catch (err) {
            // USDT balance fetch failed, continue without it
          }
        }
      } catch (err) {
        // Fallback to configured address if WDK fails for this chain
        walletInfo.address = SHOP_WALLETS[chain] || "Not configured"
      }
      
      shopWallets.push(walletInfo)
    }
    
    return jsonResponse({ success: true, data: shopWallets })
  } catch (error) {
    // Fallback to static addresses if WDK fails entirely
    const wallets = Object.entries(SHOP_WALLETS).map(([chain, address]) => ({
      chain,
      address,
      description: `Coffee Shop ${chain.charAt(0).toUpperCase() + chain.slice(1)} receiving address`,
    }))
    
    return jsonResponse({ success: true, data: wallets })
  }
}

const handleGetShopConfig = (): Response => {
  return jsonResponse({
    success: true,
    data: {
      paymentRecipient: PAYMENT_RECIPIENT,
      paymentNetwork: PAYMENT_NETWORK,
      paymentCurrency: PAYMENT_CURRENCY,
      supportedChains: ["ethereum", "bitcoin", "solana", "tron"],
      shopWallets: SHOP_WALLETS,
      x402Mode: X402_MODE,
    },
  })
}

// ============================================================================
// Static File Serving
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const serveStaticFile = async (filePath: string): Promise<Response | null> => {
  try {
    const fullPath = path.join(PUBLIC_DIR, filePath)
    
    // Security: prevent directory traversal
    if (!fullPath.startsWith(PUBLIC_DIR)) {
      return null
    }
    
    if (!fs.existsSync(fullPath)) {
      return null
    }
    
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      // Try to serve index.html from directory
      const indexPath = path.join(fullPath, "index.html")
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath)
        return new Response(content, {
          headers: { "Content-Type": "text/html", ...corsHeaders },
        })
      }
      return null
    }
    
    const ext = path.extname(fullPath).toLowerCase()
    const contentType = MIME_TYPES[ext] || "application/octet-stream"
    
    const content = fs.readFileSync(fullPath)
    return new Response(content, {
      headers: { "Content-Type": contentType, ...corsHeaders },
    })
  } catch {
    return null
  }
}

// ============================================================================
// Main Router
// ============================================================================

const server = Bun.serve({
  // Honor the port the launcher assigns (recipe server.js passes PORT/COFFEE_SHOP_API_PORT).
  // Was hardcoded to 3457, so when the recipe moved the API to 3462 the agent (pointed at 3462)
  // got "Unable to connect" -> quote/order/QR all failed and the menu fell back to the hardcoded list.
  port: parseInt(process.env.COFFEE_SHOP_API_PORT || process.env.PORT || "3457"),
  hostname: "127.0.0.1", // local-only: never reachable from the network
  fetch: async (request) => {
    const url = new URL(request.url)
    const urlPath = url.pathname

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // API Routes
    if (urlPath.startsWith("/api/")) {
      // Menu
      if (urlPath === "/api/menu" && request.method === "GET") {
        return handleGetMenu()
      }

      // Stores
      if (urlPath === "/api/stores" && request.method === "GET") {
        return handleGetStores()
      }

      // Quote
      if (urlPath === "/api/quote" && request.method === "POST") {
        return handlePostQuote(request)
      }

      // Orders
      if (urlPath === "/api/orders") {
        if (request.method === "GET") {
          return handleGetOrders(url)
        }
        if (request.method === "POST") {
          return handleCreateOrder(request)
        }
      }

      // Order by ID
      const orderMatch = urlPath.match(/^\/api\/orders\/([^/]+)$/)
      if (orderMatch && request.method === "GET") {
        return handleGetOrderById(orderMatch[1]!)
      }

      // Confirm order
      const confirmMatch = urlPath.match(/^\/api\/orders\/([^/]+)\/confirm$/)
      if (confirmMatch && request.method === "POST") {
        return handleConfirmOrder(confirmMatch[1]!)
      }

      // ========== Wallet API Routes ==========
      
      // Customer wallet - all chains
      if (urlPath === "/api/wallet" && request.method === "GET") {
        return handleGetWallet()
      }

      // Customer wallet - specific chain
      const walletChainMatch = urlPath.match(/^\/api\/wallet\/([^/]+)$/)
      if (walletChainMatch && request.method === "GET") {
        return handleGetWalletByChain(walletChainMatch[1]!)
      }

      // Shop wallet addresses
      if (urlPath === "/api/shop/wallet" && request.method === "GET") {
        return await handleGetShopWallet()
      }

      // Shop configuration
      if (urlPath === "/api/shop/config" && request.method === "GET") {
        return handleGetShopConfig()
      }

      return jsonResponse({ success: false, error: "Not found" }, 404)
    }

    // ========== Dashboard Routes (serve HTML) ==========
    
    // Customer wallet dashboard
    if (urlPath === "/customer-wallet" || urlPath === "/customer-wallet/") {
      const staticFile = await serveStaticFile("customer-wallet.html")
      if (staticFile) return staticFile
    }

    // Shop dashboard
    if (urlPath === "/shop-dashboard" || urlPath === "/shop-dashboard/") {
      const staticFile = await serveStaticFile("shop-dashboard.html")
      if (staticFile) return staticFile
    }

    // Serve static files from public directory
    if (urlPath.startsWith("/styles/") || urlPath.endsWith(".css") || urlPath.endsWith(".js")) {
      const staticFile = await serveStaticFile(urlPath)
      if (staticFile) return staticFile
    }

    // Root - return API info with dashboard links
    if (urlPath === "/" || urlPath === "") {
      return new Response(
        JSON.stringify({
          name: "Coffee Shop API",
          version: "1.0.0",
          dashboards: {
            customerWallet: "/customer-wallet",
            shopDashboard: "/shop-dashboard",
          },
          endpoints: {
            menu: "GET /api/menu",
            stores: "GET /api/stores",
            quote: "POST /api/quote",
            orders: "GET/POST /api/orders",
            order: "GET /api/orders/:id",
            confirm: "POST /api/orders/:id/confirm",
            wallet: "GET /api/wallet",
            walletByChain: "GET /api/wallet/:chain",
            shopWallet: "GET /api/shop/wallet",
            shopConfig: "GET /api/shop/config",
          },
          realPayments: USE_REAL_PAYMENTS,
        }),
        {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      )
    }

    return jsonResponse({ success: false, error: "Not found" }, 404)
  },
})

console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                       Coffee Shop API Server                               ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${server.port}                            ║
║  API Base URL:      http://localhost:${server.port}/api                        ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Dashboards:                                                               ║
║    /customer-wallet         - Customer wallet dashboard                    ║
║    /shop-dashboard          - Coffee shop orders & wallet dashboard        ║
╠════════════════════════════════════════════════════════════════════════════╣
║  API Endpoints:                                                            ║
║    GET  /api/menu           - Get coffee menu                              ║
║    GET  /api/stores         - Get available stores                         ║
║    POST /api/quote          - Get price quote for order                    ║
║    GET  /api/orders         - List orders                                  ║
║    POST /api/orders         - Create order (x402 gated)                    ║
║    GET  /api/orders/:id     - Get order by ID                              ║
║    POST /api/orders/:id/confirm - Confirm payment received                 ║
║    GET  /api/wallet         - Get customer wallet (all chains)             ║
║    GET  /api/wallet/:chain  - Get wallet for specific chain                ║
║    GET  /api/shop/wallet    - Get shop receiving addresses                 ║
║    GET  /api/shop/config    - Get shop configuration                       ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Network Mode: ${NETWORK_MODE.padEnd(62)}║
║  Real Payments: ${(USE_REAL_PAYMENTS ? "enabled (testnet)" : "disabled (mock)").padEnd(60)}║
║  Payment Currency: ${PAYMENT_CURRENCY.padEnd(58)}║
║  Payment Recipient: ${PAYMENT_RECIPIENT.slice(0, 20)}...                                  ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Menu: ${menu.drinks.length} drinks, ${menu.options.length} options, ${stores.length} stores                                 ║
╚════════════════════════════════════════════════════════════════════════════╝
`)

