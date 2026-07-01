// ============================================================================
// Tool Registry - All tools for the agentic coffee assistant
// ============================================================================

import type {
  Tool,
  ToolName,
  ToolResult,
  ToolContext,
  AgentState,
  StatePatch,
  Quote,
  Order,
  X402Requirements,
  X402PaymentProof,
  UserProfile,
} from "./types"
// loadUserProfile import removed - no longer using profile defaults
import { showOrderQRCode } from "../utils/qrcode"

// ============================================================================
// Helper Functions
// ============================================================================

// USDT contract addresses for each chain
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

/**
 * Get the correct USDT contract address based on chain and network mode
 */
const getUsdtContract = (chain: string): string => {
  const NETWORK_MODE = process.env.NETWORK_MODE || 'testnet'
  const isMainnet = NETWORK_MODE === 'mainnet'
  const contracts = isMainnet ? USDT_CONTRACTS_MAINNET : USDT_CONTRACTS_TESTNET
  // Default to ethereum testnet if chain not found
  return contracts[chain] || contracts.ethereum || "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06"
}

const buildExplorerUrl = (txHash: string, network?: string): string => {
  const NETWORK_MODE = process.env.NETWORK_MODE || 'testnet'
  const isMainnet = NETWORK_MODE === 'mainnet'
  const net = (network || "").toLowerCase()

  if (net.includes("lightning") || net.includes("spark") || net === "sats") {
    // Lightning/Spark has no on-chain tx; point at the Spark explorer.
    return `https://www.sparkscan.io/tx/${txHash}`
  }

  if (net.includes("tron")) {
    return isMainnet 
      ? `https://tronscan.org/#/transaction/${txHash}`
      : `https://nile.tronscan.org/#/transaction/${txHash}`
  }
  
  // Ethereum/Base
  return isMainnet
    ? `https://etherscan.io/tx/${txHash}`
    : `https://sepolia.basescan.org/tx/${txHash}`
}

/**
 * Get list of missing required fields from state
 * Required: drink, name (no address needed - customer picks up voucher)
 */
export const getMissingFields = (state: AgentState): string[] => {
  const missing: string[] = []

  // Order fields
  if (!state.order.drink) missing.push("order.drink")

  // User fields
  if (!state.user.name) missing.push("user.name")

  return missing
}

/**
 * Format order summary as human-readable string
 * Note: No address needed - customer picks up voucher from human colleague
 */
export const formatOrderSummary = (state: AgentState): string => {
  const lines: string[] = []

  // Drink details
  const drink = state.order.drink || "drink"
  let drinkLine = drink
  if (state.order.options && state.order.options.length > 0) {
    drinkLine += ` with ${state.order.options.join(", ")}`
  }
  lines.push(`• ${drinkLine}`)

  // Name
  if (state.user.name) {
    lines.push(`• Name: ${state.user.name}`)
  }

  // Payment
  lines.push(`• Payment: ${state.payment.currency}`)

  return lines.join("\n")
}

/**
 * Check if state is ready for order creation
 */
export const isReadyForOrder = (state: AgentState): boolean => {
  return getMissingFields(state).length === 0 && state.confirmation.user_confirmed
}

// ============================================================================
// State Tools
// ============================================================================

export const stateGetTool: Tool = {
  name: "state.get",
  description: "Returns the full current state of the order",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, state, _context): Promise<ToolResult> => {
    return {
      success: true,
      data: state,
    }
  },
}

export const statePatchTool: Tool = {
  name: "state.patch",
  description: "Updates the state with the provided patch. Use this to record information from user messages.",
  parameters: {
    type: "object",
    properties: {
      user: {
        type: "object",
        description: "User info patch",
        properties: {
          name: { type: "string" },
          name_confirmed: { type: "boolean" },
        },
      },
      fulfillment: {
        type: "object",
        description: "Fulfillment patch",
        properties: {
          address: { type: "string" },
        },
      },
      order: {
        type: "object",
        description: "Order details patch",
        properties: {
          drink: { type: "string", description: "Drink ID (e.g. 'latte', 'cappuccino', 'americano')" },
          options: { type: "array", items: { type: "string" }, description: "Array of option IDs: 'espresso-shot', 'almond-milk', 'chocolate', 'caramel'. Example: ['almond-milk', 'caramel']" },
        },
      },
      payment: {
        type: "object",
        description: "Payment patch",
        properties: {
          ready: { type: "boolean" },
        },
      },
      confirmation: {
        type: "object",
        description: "Confirmation patch",
        properties: {
          user_confirmed: { type: "boolean" },
          summary_shown: { type: "boolean" },
        },
      },
    },
  },
  execute: async (args, _state, context): Promise<ToolResult> => {
    const patch = args as StatePatch
    context.updateState(patch)
    return {
      success: true,
      data: { patched: Object.keys(patch) },
    }
  },
}

export const stateMissingFieldsTool: Tool = {
  name: "state.missing_fields",
  description: "Returns list of missing required fields that must be collected before ordering",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, state, _context): Promise<ToolResult> => {
    const missing = getMissingFields(state)
    return {
      success: true,
      data: { missing_fields: missing, count: missing.length },
    }
  },
}

export const stateAdvanceIfReadyTool: Tool = {
  name: "state.advance_if_ready",
  description: "Advances the stage if requirements are met. Returns the new stage.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    const missing = getMissingFields(state)

    if (state.stage === "COLLECT_INFO") {
      if (missing.length === 0) {
        // updateState triggers updateStage() which auto-computes stage to CONFIRM
        context.updateState({ confirmation: { summary_shown: true } } as StatePatch)
        return {
          success: true,
          data: { 
            advanced: true, 
            new_stage: "CONFIRM",
            message: "All info collected, ready for confirmation" 
          },
        }
      }
      return {
        success: true,
        data: { 
          advanced: false, 
          current_stage: state.stage,
          missing_fields: missing 
        },
      }
    }

    if (state.stage === "CONFIRM" && state.confirmation.user_confirmed) {
      // Stage should already be EXECUTE from updateStage() when user_confirmed was set
      // Just return success - no need to call setStage again
      return {
        success: true,
        data: { 
          advanced: true, 
          new_stage: "EXECUTE",
          message: "User confirmed, ready to execute order" 
        },
      }
    }

    return {
      success: true,
      data: { 
        advanced: false, 
        current_stage: state.stage,
        reason: "Conditions not met for advancement" 
      },
    }
  },
}

export const stateSummaryTool: Tool = {
  name: "state.summary",
  description: "Returns order summary with structured data for UI display and a short TTS message. IMPORTANT: Use ONLY the tts_response field for your spoken response - the order details will be shown visually to the user.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    // Build structured order details for UI display
    const orderDetails: {
      drink: string
      options: string[]
      name: string
      subtotal?: number
      deliveryFee?: number
      total?: number
      currency?: string
    } = {
      drink: state.order.drink || "Unknown drink",
      options: state.order.options || [],
      name: state.user.name || "Customer",
    }
    
    // Fetch price quote from shop API
    let total = 0
    let currency = state.payment.currency || "sats"  // sat-only demo (overwritten by the API quote, which returns "sats")
    try {
      const quoteRequest = {
        items: [{
          drinkId: state.order.drink || "latte",
          options: state.order.options || [],
          quantity: 1,
        }],
        fulfillment: {
          mode: state.fulfillment.mode,
        },
      }

      const response = await fetch(`${context.coffeeShopApiUrl}/api/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoteRequest),
      })

      const data = await response.json() as { success: boolean; data?: { subtotal: number; deliveryFee: number; total: number; currency: string } }
      
      if (data.success && data.data) {
        orderDetails.subtotal = data.data.subtotal
        orderDetails.deliveryFee = data.data.deliveryFee
        orderDetails.total = data.data.total
        orderDetails.currency = data.data.currency
        total = data.data.total
        currency = data.data.currency
        
        // Store the quote in execution state for UI display
        context.updateState({
          execution: { quote: data.data as any },
        })
      } else if (!data.success) {
        console.error("[state.summary] Quote API returned error:", data)
      }
    } catch (err) {
      // If quote fails, try to fetch menu and calculate price locally
      console.error("[state.summary] Failed to fetch quote:", err instanceof Error ? err.message : err)
      
      try {
        const menuResponse = await fetch(`${context.coffeeShopApiUrl}/api/menu`)
        const menuData = await menuResponse.json() as { success: boolean; data?: { drinks: Array<{ id: string; price: number }>; options: Array<{ id: string; price: number }> } }
        
        if (menuData.success && menuData.data) {
          const drink = menuData.data.drinks.find(d => d.id === state.order.drink)
          let calculatedTotal = drink?.price || 0
          
          // Add option prices
          for (const optId of (state.order.options || [])) {
            const opt = menuData.data.options.find(o => o.id === optId)
            if (opt) calculatedTotal += opt.price
          }
          
          // /api/menu now returns prices already in sats, so calculatedTotal is in sats.
          const fallbackCurrency = "sats"
          const roundedTotal = Math.round(calculatedTotal)

          orderDetails.subtotal = roundedTotal
          orderDetails.total = roundedTotal
          orderDetails.currency = fallbackCurrency
          total = roundedTotal
          currency = fallbackCurrency

          context.updateState({
            execution: { quote: { subtotal: roundedTotal, deliveryFee: 0, total: roundedTotal, currency: fallbackCurrency } as any },
          })
        }
      } catch (menuErr) {
        console.error("[state.summary] Failed to fetch menu for fallback pricing:", menuErr instanceof Error ? menuErr.message : menuErr)
      }
    }

    // Mark summary as shown so state.confirm_order can proceed
    context.updateState({
      confirmation: { summary_shown: true },
    })

    // Generate the short TTS message. Sat-only demo: whole numbers + "sats".
    const formattedTotal = currency === "sats"
      ? `${Math.round(total)} sats`
      : `${total.toFixed(2)} ${currency}`
    const ttsResponse = total > 0
      ? `Here's your order summary, your total is ${formattedTotal}. Please confirm if you'd like to proceed with payment.`
      : `Here's your order summary. Please confirm if you'd like to proceed with payment.`

    return {
      success: true,
      data: {
        order_details: orderDetails,
        tts_response: ttsResponse,
        total,
        currency,
        // Include legacy summary for backwards compatibility
        summary: formatOrderSummary(state),
      },
    }
  },
}

export const stateConfirmOrderTool: Tool = {
  name: "state.confirm_order",
  description: "PREREQUISITE: state.summary MUST be called first! Call this ONLY after (1) you called state.summary AND (2) the user explicitly confirmed. Fails if state.summary was not called.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    // Check if summary was shown
    if (!state.confirmation.summary_shown) {
      return {
        success: false,
        error: "FAILED: state.summary was NOT called. You MUST call state.summary first to show the order to the user, then wait for their confirmation, then call state.confirm_order.",
      }
    }

    // Set user_confirmed
    context.updateState({
      confirmation: { user_confirmed: true },
    })

    return {
      success: true,
      data: {
        confirmed: true,
        message: "Order confirmed! You can now proceed with shop.create_order",
        next_step: "Call shop.create_order to create the order",
      },
    }
  },
}

export const statePatchAndCheckTool: Tool = {
  name: "state.patch_and_check",
  description: "PREFERRED: Patches state AND returns missing fields in one operation. Use this instead of separate state.patch + state.missing_fields calls.",
  parameters: {
    type: "object",
    properties: {
      user: {
        type: "object",
        description: "User info patch",
        properties: {
          name: { type: "string" },
          name_confirmed: { type: "boolean" },
        },
      },
      fulfillment: {
        type: "object",
        description: "Fulfillment patch",
        properties: {
          address: { type: "string" },
        },
      },
      order: {
        type: "object",
        description: "Order details patch",
        properties: {
          drink: { type: "string", description: "Drink ID (e.g. 'latte', 'cappuccino', 'americano')" },
          options: { type: "array", items: { type: "string" }, description: "Array of option IDs: 'espresso-shot', 'almond-milk', 'chocolate', 'caramel'. Example: ['almond-milk', 'caramel']" },
        },
      },
      payment: {
        type: "object",
        description: "Payment patch",
        properties: {
          ready: { type: "boolean" },
        },
      },
      confirmation: {
        type: "object",
        description: "Confirmation patch",
        properties: {
          user_confirmed: { type: "boolean" },
          summary_shown: { type: "boolean" },
        },
      },
    },
  },
  execute: async (args, _state, context): Promise<ToolResult> => {
    const patch = args as StatePatch

    // Apply the patch
    context.updateState(patch)
    let newState = context.getState()

    // Validate against the REAL menu NOW (not at order-creation) so the agent corrects the customer
    // immediately instead of accepting a phantom drink (e.g. "Nespresso", or "espresso" which is not
    // on this menu) and failing later at payment.
    let invalidDrink: string | null = null
    let rejectedOptions: string[] = []
    let allowedOptions: string[] = []
    if (newState.order?.drink) {
      try {
        const menuResp = await fetch(`${context.coffeeShopApiUrl}/api/menu`)
        const menuData = await menuResp.json() as { success: boolean; data?: { drinks: Array<{ id: string; name?: string; aliases?: string[]; availableOptions?: string[] }> } }
        const drinks = menuData?.data?.drinks || []
        // Normalize (lowercase, strip accents + non-alphanumerics) so "café latte" == "latte".
        const norm = (s: any) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "")
        const want = norm(newState.order.drink)
        const drink = drinks.find(d =>
          norm(d.id) === want ||
          (d.name && norm(d.name) === want) ||
          (Array.isArray(d.aliases) && d.aliases.some(a => norm(a) === want))
        )
        if (!drink) {
          // Drink is NOT on the menu -> remove it so we never quote/charge a phantom item.
          invalidDrink = newState.order.drink
          context.updateState({ order: { drink: "" } })
          newState = context.getState()
        } else {
          // Canonicalize to the menu id so the quote resolves cleanly.
          if (norm(drink.id) !== want) { context.updateState({ order: { drink: drink.id } }); newState = context.getState() }
          // Validate options against THIS drink's availableOptions (e.g. no chocolate on an americano).
          const opts = newState.order?.options || []
          if (opts.length > 0 && Array.isArray(drink.availableOptions)) {
            allowedOptions = drink.availableOptions
            const allowed = new Set(drink.availableOptions.map(o => o.toLowerCase()))
            const valid = opts.filter(o => allowed.has(String(o).toLowerCase()))
            rejectedOptions = opts.filter(o => !allowed.has(String(o).toLowerCase()))
            if (rejectedOptions.length > 0) {
              context.updateState({ order: { options: valid } })   // strip the unavailable options
              newState = context.getState()
            }
          }
        }
      } catch { /* menu unreachable -> skip; the order-create guard still catches it */ }
    }

    const missing = getMissingFields(newState)
    return {
      success: true,
      data: {
        patched: Object.keys(patch),
        missing_fields: missing,
        count: missing.length,
        stage: newState.stage,
        ready_for_confirmation: missing.length === 0,
        ...(invalidDrink ? {
          invalid_drink: invalidDrink,
          note: `"${invalidDrink}" is NOT on our menu, so it was NOT added to the order. Tell the customer it is not available, then call shop.menu to show what we actually have (or ask them to pick a listed drink). Do NOT keep it in the order, do NOT invent a price, and do NOT proceed to payment.`,
        } : {}),
        ...(rejectedOptions.length > 0 ? {
          rejected_options: rejectedOptions,
          allowed_options_for_drink: allowedOptions,
          note: `These add-ons are NOT available on ${newState.order.drink} and were not added: ${rejectedOptions.join(", ")}. Tell the user this drink does not offer them${allowedOptions.length ? ` (it only allows: ${allowedOptions.join(", ")})` : ""}, and offer a different drink or to continue without them. Do NOT confirm or pay with a removed option.`,
        } : {}),
      },
    }
  },
}

// ============================================================================
// Profile Tools (REMOVED - no longer using profile defaults)
// ============================================================================

// profileGetDefaultsTool removed - the coffee agent now asks for name directly
// instead of loading profile defaults

// ============================================================================
// Shop Tools
// ============================================================================


export const shopMenuTool: Tool = {
  name: "shop.menu",
  description: "Get available drinks and options from the coffee shop menu. Call this when you need to know what drinks are available or their prices. The menu will be displayed visually to the user - your response should be short like 'Here's the menu' or 'Take a look at our menu'.",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, _state, context): Promise<ToolResult> => {
    try {
      // Fetch menu from the coffee shop API
      const response = await fetch(`${context.coffeeShopApiUrl}/api/menu`)
      const data = await response.json() as { 
        success: boolean
        data?: {
          drinks: Array<{ id: string; name: string; category: string; price: number }>
          options: Array<{ id: string; name: string; price: number }>
        }
      }

      if (!data.success || !data.data) {
        // Fallback to hardcoded compact menu if API fails
        return {
          success: true,
          tts_response: "Here's the menu.",
          display_menu: true,
          data: {
            drinks: [
              { id: "specialty-espresso", name: "Specialty Espresso", category: "espresso", price: "$3.00" },
              { id: "americano", name: "Americano", category: "espresso", price: "$3.00" },
              { id: "latte", name: "Latte", category: "espresso-milk", price: "$3.50" },
              { id: "cappuccino", name: "Cappuccino", category: "espresso-milk", price: "$3.50" },
              { id: "flat-white", name: "Flat White", category: "espresso-milk", price: "$3.50" },
              { id: "macchiato", name: "Macchiato", category: "espresso-milk", price: "$3.25" },
              { id: "moccaccino", name: "Moccaccino", category: "espresso-milk", price: "$4.00" },
              { id: "hot-chocolate", name: "Hot Chocolate", category: "other", price: "$3.50" },
              { id: "iced-coffee", name: "Iced Coffee", category: "iced", price: "$3.50" },
              { id: "iced-latte", name: "Iced Latte", category: "iced", price: "$4.00" },
            ],
            options: [
              { id: "espresso-shot", name: "Extra Espresso Shot", price: "$0.50" },
              { id: "almond-milk", name: "Almond Milk", price: "$0.50" },
              { id: "chocolate", name: "Chocolate", price: "$0.50" },
              { id: "caramel", name: "Caramel", price: "$0.50" },
            ],
          },
        }
      }

      // Return menu with visual display flag
      return {
        success: true,
        tts_response: "Here's the menu.",
        display_menu: true,
        data: {
          drinks: data.data.drinks.map(d => ({
            id: d.id,
            name: d.name,
            category: d.category,
            price: `$${d.price.toFixed(2)}`,
          })),
          options: data.data.options.map(o => ({
            id: o.id,
            name: o.name,
            price: `$${o.price.toFixed(2)}`,
          })),
        },
      }
    } catch {
      // Fallback to hardcoded compact menu
      return {
        success: true,
        tts_response: "Here's the menu.",
        display_menu: true,
        data: {
          drinks: [
            { id: "specialty-espresso", name: "Specialty Espresso", category: "espresso", price: "$3.00" },
            { id: "americano", name: "Americano", category: "espresso", price: "$3.00" },
            { id: "latte", name: "Latte", category: "espresso-milk", price: "$3.50" },
            { id: "cappuccino", name: "Cappuccino", category: "espresso-milk", price: "$3.50" },
            { id: "flat-white", name: "Flat White", category: "espresso-milk", price: "$3.50" },
            { id: "macchiato", name: "Macchiato", category: "espresso-milk", price: "$3.25" },
            { id: "moccaccino", name: "Moccaccino", category: "espresso-milk", price: "$4.00" },
            { id: "hot-chocolate", name: "Hot Chocolate", category: "other", price: "$3.50" },
            { id: "iced-coffee", name: "Iced Coffee", category: "iced", price: "$3.50" },
            { id: "iced-latte", name: "Iced Latte", category: "iced", price: "$4.00" },
          ],
          options: [
            { id: "espresso-shot", name: "Extra Espresso Shot", price: "$0.50" },
            { id: "almond-milk", name: "Almond Milk", price: "$0.50" },
            { id: "chocolate", name: "Chocolate", price: "$0.50" },
            { id: "caramel", name: "Caramel", price: "$0.50" },
          ],
        },
      }
    }
  },
}

export const shopGetQuoteTool: Tool = {
  name: "shop.get_quote",
  description: "Gets a price quote for the current order from the coffee shop API",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    if (!state.order.drink) {
      return {
        success: false,
        error: "Cannot get quote without drink",
      }
    }

    try {
      const response = await fetch(`${context.coffeeShopApiUrl}/api/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            drinkId: state.order.drink,
            options: state.order.options || [],
            quantity: 1,
          }],
        fulfillment: {
          mode: "pickup",
        },
      }),
    })

      const data = await response.json() as { success: boolean; data?: Quote; error?: string }

      if (!data.success || !data.data) {
        return { success: false, error: data.error || "Failed to get quote" }
      }

      // Store quote in execution state
      context.updateState({
        execution: { quote: data.data },
      })

      return {
        success: true,
        data: {
          total: data.data.total,
          currency: data.data.currency,
          items: data.data.items,
          deliveryFee: data.data.deliveryFee,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to get quote: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const shopCreateOrderTool: Tool = {
  name: "shop.create_order",
  description: "Creates an order with the coffee shop. If it returns 402 Payment Required, call payments.x402_pay then shop.complete_with_payment.",
  parameters: {
    type: "object",
    properties: {},
  },
  // Gating: Only allow when all fields are filled and user confirmed
  gate: (state: AgentState): string | null => {
    const missing = getMissingFields(state)
    if (missing.length > 0) {
      return `Cannot create order. Missing fields: ${missing.join(", ")}. Use state.patch to fill them first.`
    }
    if (!state.confirmation.user_confirmed) {
      return "Cannot create order. You must first call state.patch with { confirmation: { user_confirmed: true } } after the user confirms."
    }
    return null
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    const idempotencyKey = state.execution.idempotency_key || 
      `order-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Store idempotency key
    context.updateState({
      execution: { idempotency_key: idempotencyKey },
    })

    try {
      const response = await fetch(`${context.coffeeShopApiUrl}/api/orders`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          items: [{
            drinkId: state.order.drink,
            options: state.order.options || [],
            quantity: 1,
          }],
          fulfillment: {
            mode: "pickup",
          },
          customerName: state.user.name,
          idempotencyKey,
        }),
      })

      // Handle 402 Payment Required
      if (response.status === 402) {
        const paymentHeader = response.headers.get("X-Payment-Required")
        let requirements: X402Requirements | null = null

        if (paymentHeader) {
          try {
            requirements = JSON.parse(paymentHeader)
          } catch {
            // Try body
          }
        }

        if (!requirements) {
          const body = await response.json() as { paymentRequirements?: X402Requirements }
          requirements = body.paymentRequirements || null
        }

        if (requirements) {
          context.updateState({
            execution: { 
              x402_requirements: requirements,
              payment_status: "pending",
            },
          })
          return {
            success: true,
            data: {
              status: "payment_required",
              requirements,
              next_step: "Call payments.x402_pay to generate payment proof, then shop.complete_with_payment to finalize",
            },
          }
        }

        return { success: false, error: "402 received but could not parse requirements" }
      }

      const data = await response.json() as { success: boolean; data?: Order; error?: string }

      if (!data.success || !data.data) {
        return { success: false, error: data.error || "Failed to create order" }
      }

      // Order created successfully - update state (updateStage() auto-advances to DONE)
      context.updateState({
        execution: {
          order_id: data.data.id,
          payment_status: "completed",
        },
      })

      // Generate and display QR code for the order
      try {
        const txHash = (state.execution as any).transaction_hash as string | undefined
        const txLink = txHash ? buildExplorerUrl(txHash, state.execution.x402_requirements?.network) : undefined
        await showOrderQRCode({
          orderId: data.data.id,
          timestamp: data.data.createdAt || new Date().toISOString(),
          customerName: state.user.name,
          currency: data.data.currency || state.payment.currency,
          items: [{
            drink: state.order.drink!,
            extras: state.order.options,
          }],
          total: data.data.total,
          ...(txHash ? { txHash, txLink } : {}),
        })
      } catch (qrError) {
        console.error("Failed to generate QR code:", qrError)
        // Don't fail the order if QR generation fails
      }

      return {
        success: true,
        data: {
          status: "created",
          order: data.data,
          message: "Order created and paid successfully!",
        },
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create order: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

export const shopCompleteWithPaymentTool: Tool = {
  name: "shop.complete_with_payment",
  description: "FINAL STEP after payments.x402_pay: Submits the order with payment proof to complete the purchase.",
  parameters: {
    type: "object",
    properties: {},
  },
  gate: (state: AgentState): string | null => {
    if (!state.execution.payment_proof) {
      return "No payment proof. Call payments.x402_pay first."
    }
    if (!state.execution.x402_requirements) {
      return "No payment requirements. Call shop.create_order first to get 402 requirements."
    }
    return null
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    const idempotencyKey = state.execution.idempotency_key || 
      `order-${Date.now()}-${Math.random().toString(36).slice(2)}`

    try {
      const response = await fetch(`${context.coffeeShopApiUrl}/api/orders`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
          "X-Payment-Proof": state.execution.payment_proof!,
        },
        body: JSON.stringify({
          items: [{
            drinkId: state.order.drink,
            options: state.order.options || [],
            quantity: 1,
          }],
          fulfillment: {
            mode: "pickup",
          },
          customerName: state.user.name,
          idempotencyKey,
        }),
      })

      // If we still get 402, something went wrong with the payment
      if (response.status === 402) {
        return {
          success: false,
          error: "Payment was not accepted. The payment proof may have expired or be invalid.",
        }
      }

      const data = await response.json() as { success: boolean; data?: Order; error?: string }

      if (!data.success || !data.data) {
        return { success: false, error: data.error || "Failed to complete order" }
      }

      // Order created successfully - update state (updateStage() auto-advances to DONE)
      context.updateState({
        execution: {
          order_id: data.data.id,
          payment_status: "completed",
        },
      })

      // Generate and display QR code for the order
      try {
        const txHash = (state.execution as any).transaction_hash as string | undefined
        const txLink = txHash ? buildExplorerUrl(txHash, state.execution.x402_requirements?.network) : undefined
        await showOrderQRCode({
          orderId: data.data.id,
          timestamp: data.data.createdAt || new Date().toISOString(),
          customerName: state.user.name,
          currency: data.data.currency || state.payment.currency,
          items: [{
            drink: state.order.drink!,
            extras: state.order.options,
          }],
          total: data.data.total,
          ...(txHash ? { txHash, txLink } : {}),
        })
      } catch (qrError) {
        console.error("Failed to generate QR code:", qrError)
        // Don't fail the order if QR generation fails
      }

        return {
          success: true,
          data: {
            status: "completed",
            order_id: data.data.id,
            message: `Order completed! Please speak to my human colleague to pick up your voucher for a ${state.order.drink}.`,
          },
        }
    } catch (error) {
      context.updateState({
        execution: { payment_status: "failed" },
      })
      return {
        success: false,
        error: `Failed to complete order: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

// ============================================================================
// Fused Shop Tools
// ============================================================================

export const shopCreateAndPayTool: Tool = {
  name: "shop.create_and_pay",
  description: "PREFERRED: Creates order and handles 402 payment automatically in one operation. Use this instead of separate shop.create_order + payments.x402_pay + shop.complete_with_payment calls.",
  parameters: {
    type: "object",
    properties: {},
  },
  gate: (state: AgentState): string | null => {
    const missing = getMissingFields(state)
    if (missing.length > 0) {
      return `Cannot create order. Missing fields: ${missing.join(", ")}. Use state.patch to fill them first.`
    }
    if (!state.confirmation.user_confirmed) {
      return "Cannot create order. You must first call state.confirm_order after the user confirms."
    }
    return null
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    const idempotencyKey = state.execution.idempotency_key || 
      `order-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Store idempotency key
    context.updateState({
      execution: { idempotency_key: idempotencyKey },
    })

    try {
      // Step 1: Create order (will likely return 402)
      const createResponse = await fetch(`${context.coffeeShopApiUrl}/api/orders`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          items: [{
            drinkId: state.order.drink,
            options: state.order.options || [],
            quantity: 1,
          }],
          fulfillment: {
            mode: "pickup",
          },
          customerName: state.user.name,
          idempotencyKey,
        }),
      })

      // If order was created directly (no payment required)
      if (createResponse.status === 200 || createResponse.status === 201) {
        const data = await createResponse.json() as { success: boolean; data?: Order; error?: string }
        
        if (data.success && data.data) {
          context.updateState({
            execution: {
              order_id: data.data.id,
              payment_status: "completed",
            },
          })

          // Generate QR code
          try {
            await showOrderQRCode({
              orderId: data.data.id,
              timestamp: data.data.createdAt || new Date().toISOString(),
              customerName: state.user.name,
              currency: data.data.currency || state.payment.currency,
              items: [{
                drink: state.order.drink!,
                extras: state.order.options,
              }],
              total: data.data.total,
            })
          } catch { /* Ignore QR errors */ }

          return {
            success: true,
            data: {
              status: "completed",
              order_id: data.data.id,
              message: `Order completed!`,
            },
          }
        }
      }

      // Step 2: Handle 402 Payment Required
      if (createResponse.status === 402) {
        const paymentHeader = createResponse.headers.get("X-Payment-Required")
        let requirements: X402Requirements | null = null

        if (paymentHeader) {
          try {
            requirements = JSON.parse(paymentHeader)
          } catch { /* Try body */ }
        }

        if (!requirements) {
          const body = await createResponse.json() as { paymentRequirements?: X402Requirements }
          requirements = body.paymentRequirements || null
        }

        if (!requirements) {
          return { success: false, error: "402 received but could not parse payment requirements" }
        }

        context.updateState({
          execution: { 
            x402_requirements: requirements,
            payment_status: "pending",
          },
        })

        // Step 3: Generate payment proof
        let proofString: string
        let transactionHash: string | undefined
        
        if (!context.wdk) {
          // Mock mode
          const mockProof: X402PaymentProof = {
            signature: `mock_sig_${Date.now()}`,
            payerAddress: "0xMockWallet",
            timestamp: new Date().toISOString(),
            nonce: requirements.nonce,
          }
          proofString = JSON.stringify(mockProof)
        } else {
          // Real WDK mode
          const USE_REAL_TRANSACTIONS = process.env.USE_REAL_PAYMENTS === "true"
          
          if (USE_REAL_TRANSACTIONS && context.wdkManager) {
            const PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY || "USDT"
            console.log(`\n💸 Sending REAL blockchain payment (fused)...`)
            console.log(`   Amount: ${requirements.amount} ${requirements.currency}`)
            console.log(`   Network: ${requirements.network}`)
            console.log(`   To: ${requirements.recipient}`)
            
            let tx: any
            let address: string
            let txHash: string
            
            // Handle Lightning/Spark payments
            if (requirements.network === "LIGHTNING" || requirements.currency === "sats") {
              console.log(`⚡ Processing Lightning payment...`)
              
              if (!requirements.lightningInvoice) {
                throw new Error("Lightning payment requires invoice but none provided")
              }
              
              // Get customer's Spark account (index 0)
              const customerAccount = await context.wdkManager.getSparkAccount(0)
              address = await customerAccount.getAddress()
              
              // Check balance
              try {
                const customerBalance = await customerAccount.getBalance()
                const balanceValue = typeof customerBalance === 'object'
                  ? (customerBalance.confirmed || customerBalance.total || customerBalance.available || 0)
                  : (customerBalance || 0)
                console.log(`   Customer balance: ${balanceValue} sats`)
                
                if (balanceValue < requirements.amount + 10) {
                  throw new Error(`Insufficient balance: ${balanceValue} sats, need ${requirements.amount + 500} sats (including fees)`)
                }
              } catch (balanceError) {
                console.warn(`   ⚠️  Could not check balance:`, balanceError)
                // Continue anyway - let payment fail with proper error if insufficient funds
              }
              
              // Extract BOLT11 invoice string
              let bolt11Invoice: string
              if (typeof requirements.lightningInvoice === 'string') {
                // Trim whitespace and ensure it's a valid BOLT11 format
                bolt11Invoice = requirements.lightningInvoice.trim()
                if (!bolt11Invoice.startsWith('lnbc') && !bolt11Invoice.startsWith('lntb') && !bolt11Invoice.startsWith('lnbcrt')) {
                  throw new Error(`Invalid BOLT11 invoice format: ${bolt11Invoice.substring(0, 20)}...`)
                }
              } else if (typeof requirements.lightningInvoice === 'object' && requirements.lightningInvoice !== null) {
                bolt11Invoice = (requirements.lightningInvoice as any).encodedInvoice || 
                               (requirements.lightningInvoice as any).invoice || 
                               String(requirements.lightningInvoice)
                bolt11Invoice = bolt11Invoice.trim()
              } else {
                throw new Error(`Invalid Lightning invoice format: ${typeof requirements.lightningInvoice}`)
              }
              
              console.log(`   Paying invoice: ${bolt11Invoice.substring(0, 30)}...`)
              console.log(`   Invoice length: ${bolt11Invoice.length}`)
              console.log(`   Invoice type: ${typeof bolt11Invoice}`)
              console.log(`   Invoice starts with: ${bolt11Invoice.substring(0, 10)}`)
              
              // Pay the Lightning invoice
              // Note: Spark SDK expects 'invoice' parameter (not 'encodedInvoice')
              const paymentParams = {
                invoice: bolt11Invoice,
                maxFeeSats: 500
              }
              console.log(`   Payment params keys: ${Object.keys(paymentParams).join(', ')}`)
              
              let payment: any
              try {
                payment = await customerAccount.payLightningInvoice(paymentParams)
              } catch (payError: any) {
                console.error(`   ❌ Payment failed:`, payError)
                console.error(`   Error message: ${payError.message}`)
                console.error(`   Error stack: ${payError.stack}`)
                throw new Error(`Lightning payment failed: ${payError.message || String(payError)}`)
              }
              
              // SparkScan indexes the on-chain TRANSFER (transfer.sparkId), NOT the Lightning send
              // request wrapper. payment.id is a Relay-style global id like
              // "SparkLightningSendRequest:<uuid>", and that uuid is the SEND REQUEST, which SparkScan
              // returns "Transaction not found" for. The explorer needs the transfer's sparkId. Prefer
              // it and strip any "Type:" prefix so the receipt + left-tab links resolve.
              const stripSparkPrefix = (v: any): string => (v == null ? "" : String(v).split(":").pop() as string)
              const rawTxId =
                payment?.transfer?.sparkId ||
                payment?.transfer?.id ||
                payment.id || payment.paymentId || payment.paymentHash || ""
              txHash = stripSparkPrefix(rawTxId) || `lightning-${Date.now()}`
              transactionHash = txHash

              console.log(`✅ Lightning payment sent!`)
              console.log(`   Explorer tx (transfer.sparkId): ${txHash}`)
              console.log(`   (payment.id was: ${payment.id})`)
              console.log(`   Amount: ${requirements.amount} sats`)
              console.log(`   Payment object keys: ${Object.keys(payment).join(', ')}`)
              
            } else {
              // Handle traditional blockchain payments (USDT, ETH, etc.)
              let chain: string = requirements.network.includes('tron') ? 'tron' : 'ethereum'
              
              try {
                if (PAYMENT_CURRENCY === "USDT") {
                  const tokenContract = getUsdtContract(chain)
                  const amountInSmallestUnit = BigInt(Math.floor(requirements.amount * 1e6))
                  
                  tx = await context.wdkManager.sendTokenTransfer(chain, {
                    token: tokenContract,
                    recipient: requirements.recipient,
                    amount: amountInSmallestUnit
                  }, 0)
                } else {
                  const decimals = chain === 'tron' ? 6 : 18
                  const amountInSmallestUnit = BigInt(Math.floor(requirements.amount * (10 ** decimals)))
                  tx = await context.wdkManager.sendTransaction(chain, {
                    to: requirements.recipient,
                    value: amountInSmallestUnit
                  }, 0)
                }
              } catch (payError: any) {
                console.error(`   ❌ Payment failed:`, payError)
                console.error(`   Error message: ${payError.message}`)
                console.error(`   Error code: ${payError.code}`)
                if (payError.transaction) {
                  console.error(`   Transaction data: ${JSON.stringify(payError.transaction)}`)
                }
                throw new Error(`Blockchain payment failed: ${payError.message || String(payError)}`)
              }
              
              address = await context.wdkManager.getAddress(chain, 0)
              txHash = tx.hash || tx.signature || tx.txid
              transactionHash = txHash
              
              console.log(`✅ Transaction sent! Hash: ${txHash}`)
              console.log(`   View: ${buildExplorerUrl(txHash, requirements.network)}`)
            }
            
            const proof: X402PaymentProof = {
              signature: txHash,
              payerAddress: address,
              timestamp: new Date().toISOString(),
              nonce: requirements.nonce,
            }
            proofString = JSON.stringify(proof)
          } else {
            // Signature-only mode
            const paymentMessage = JSON.stringify({
              amount: requirements.amount,
              currency: requirements.currency,
              recipient: requirements.recipient,
              network: requirements.network,
              orderId: requirements.orderId,
              nonce: requirements.nonce,
              timestamp: new Date().toISOString(),
            })
            
            const signature = await context.wdk.signMessage(paymentMessage)
            const address = await context.wdk.getAddress()
            
            const proof: X402PaymentProof = {
              signature,
              payerAddress: address,
              timestamp: new Date().toISOString(),
              nonce: requirements.nonce,
            }
            proofString = JSON.stringify(proof)
          }
        }

        context.updateState({
          execution: {
            payment_proof: proofString,
            payment_status: "processing",
            ...(transactionHash && { transaction_hash: transactionHash }),
          } as any,
        })

        // Step 4: Complete order with payment proof
        const completeResponse = await fetch(`${context.coffeeShopApiUrl}/api/orders`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
            "X-Payment-Proof": proofString,
          },
          body: JSON.stringify({
            items: [{
              drinkId: state.order.drink,
              options: state.order.options || [],
              quantity: 1,
            }],
            fulfillment: {
              mode: "pickup",
            },
            customerName: state.user.name,
            idempotencyKey,
          }),
        })

        if (completeResponse.status === 402) {
          context.updateState({ execution: { payment_status: "failed" } })
          return {
            success: false,
            error: "Payment was not accepted. The payment proof may have expired or be invalid.",
          }
        }

        const completeData = await completeResponse.json() as { success: boolean; data?: Order; error?: string }

        if (!completeData.success || !completeData.data) {
          context.updateState({ execution: { payment_status: "failed" } })
          return { success: false, error: completeData.error || "Failed to complete order" }
        }

        // Success!
        context.updateState({
          execution: {
            order_id: completeData.data.id,
            payment_status: "completed",
          },
        })

        // Generate QR code
        try {
          const txHash = (transactionHash || ((state.execution as any).transaction_hash as string | undefined)) as string | undefined
          const txLink = txHash ? buildExplorerUrl(txHash, requirements.network) : undefined
          await showOrderQRCode({
            orderId: completeData.data.id,
            timestamp: completeData.data.createdAt || new Date().toISOString(),
            customerName: state.user.name,
            currency: completeData.data.currency || state.payment.currency,
            items: [{
              drink: state.order.drink!,
              extras: state.order.options,
            }],
            total: completeData.data.total,
            ...(txHash ? { txHash, txLink } : {}),
          })
        } catch { /* Ignore QR errors */ }

        return {
          success: true,
          data: {
            status: "completed",
            order_id: completeData.data.id,
            message: `Order completed! Please speak to my human colleague to pick up your voucher for a ${state.order.drink}.`,
          },
        }
      }

      // Unexpected response
      const errorData = await createResponse.json().catch(() => ({})) as { error?: string }
      return { 
        success: false, 
        error: errorData.error || `Unexpected response: ${createResponse.status}` 
      }

    } catch (error) {
      context.updateState({ execution: { payment_status: "failed" } })
      return {
        success: false,
        error: `Failed to create and pay for order: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

// ============================================================================
// Payment Tools
// ============================================================================

export const paymentsX402RequestTool: Tool = {
  name: "payments.x402_request",
  description: "Parses and returns the x402 payment requirements from the last order attempt",
  parameters: {
    type: "object",
    properties: {},
  },
  gate: (state: AgentState): string | null => {
    if (!state.execution.x402_requirements) {
      return "No x402 payment requirements available. Call shop.create_order first."
    }
    return null
  },
  execute: async (_args, state, _context): Promise<ToolResult> => {
    return {
      success: true,
      data: state.execution.x402_requirements,
    }
  },
}

export const paymentsX402PayTool: Tool = {
  name: "payments.x402_pay",
  description: "Creates a payment proof for the x402 requirements using WDK wallet. In testnet mode, executes actual USDT transfer. After this succeeds, call shop.complete_with_payment to finalize the order.",
  parameters: {
    type: "object",
    properties: {},
  },
  gate: (state: AgentState): string | null => {
    if (!state.execution.x402_requirements) {
      return "No x402 payment requirements. Call shop.create_order first."
    }
    return null
  },
  execute: async (_args, state, context): Promise<ToolResult> => {
    const requirements = state.execution.x402_requirements!

    try {
      // Check if WDK is available
      if (!context.wdk) {
        // Mock mode - create a mock payment proof
        const mockProof: X402PaymentProof = {
          signature: `mock_sig_${Date.now()}`,
          payerAddress: "0xMockWallet",
          timestamp: new Date().toISOString(),
          nonce: requirements.nonce,
        }

        const proofString = JSON.stringify(mockProof)
        context.updateState({
          execution: {
            payment_proof: proofString,
            payment_status: "processing",
          },
        })

        return {
          success: true,
          data: {
            proof: mockProof,
            mode: "mock",
            next_step: "Call shop.complete_with_payment to finalize the order",
          },
        }
      }

      // Real WDK mode - send actual blockchain transaction
      const USE_REAL_TRANSACTIONS = process.env.USE_REAL_PAYMENTS === "true"
      const PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY || "USDT"
      
      if (USE_REAL_TRANSACTIONS && context.wdkManager) {
        console.log(`\n💸 Sending REAL blockchain payment...`)
        console.log(`   Amount: ${requirements.amount} ${PAYMENT_CURRENCY}`)
        console.log(`   To: ${requirements.recipient}`)
        
        // Determine chain based on network
        let chain: string
        if (requirements.network.includes('tron') || requirements.network === 'tron-nile') {
          chain = 'tron'
        } else if (requirements.network.includes('base') || requirements.network === 'base-sepolia') {
          chain = 'ethereum'
        } else {
          chain = 'ethereum'
        }
        
        let tx: any
        
        // Check if we're sending a token (USDT) or native currency (TRX, ETH, etc.)
        try {
          if (PAYMENT_CURRENCY === "USDT") {
            // USDT token transfer
            const tokenContract = getUsdtContract(chain)
            const amountInSmallestUnit = BigInt(Math.floor(requirements.amount * 1e6)) // USDT has 6 decimals
            
            console.log(`   Token: ${tokenContract} (USDT)`)
            
            tx = await context.wdkManager.sendTokenTransfer(
              chain,
              {
                token: tokenContract,
                recipient: requirements.recipient,
                amount: amountInSmallestUnit
              },
              0
            )
          } else {
            // Native currency transfer (TRX, ETH, etc.)
            let decimals: number
            if (chain === 'tron') {
              decimals = 6 // TRX has 6 decimals (sun)
            } else {
              decimals = 18 // ETH has 18 decimals (wei)
            }
            
            const amountInSmallestUnit = BigInt(Math.floor(requirements.amount * (10 ** decimals)))
            
            console.log(`   Native currency: ${PAYMENT_CURRENCY}`)
            
            tx = await context.wdkManager.sendTransaction(
              chain,
              {
                to: requirements.recipient,
                value: amountInSmallestUnit
              },
              0
            )
          }
        } catch (payError: any) {
          console.error(`   ❌ Payment failed:`, payError)
          console.error(`   Error message: ${payError.message}`)
          console.error(`   Error code: ${payError.code}`)
          if (payError.transaction) {
            console.error(`   Transaction data: ${JSON.stringify(payError.transaction)}`)
          }
          return {
            success: false,
            error: `Blockchain payment failed: ${payError.message || String(payError)}`
          }
        }
        
        const address = await context.wdkManager.getAddress(chain, 0)
        const txHash = tx.hash || tx.signature || tx.txid
        
        console.log(`✅ Transaction sent! Hash: ${txHash}`)
        console.log(`   View: ${buildExplorerUrl(txHash, requirements.network)}`)
        
        const proof: X402PaymentProof = {
          signature: txHash, // Use transaction hash as proof
          payerAddress: address,
          timestamp: new Date().toISOString(),
          nonce: requirements.nonce,
        }

        const proofString = JSON.stringify(proof)
        context.updateState({
          execution: {
            payment_proof: proofString,
            payment_status: "processing",
            transaction_hash: txHash,
          } as any,
        })

        return {
          success: true,
          data: {
            proof,
            transactionHash: txHash,
            mode: "blockchain",
            next_step: "Call shop.complete_with_payment to finalize the order",
          },
        }
      }
      
      // Fallback: Sign message only (original behavior)
      const paymentMessage = JSON.stringify({
        amount: requirements.amount,
        currency: requirements.currency,
        recipient: requirements.recipient,
        network: requirements.network,
        orderId: requirements.orderId,
        nonce: requirements.nonce,
        timestamp: new Date().toISOString(),
      })

      const signature = await context.wdk.signMessage(paymentMessage)
      const address = await context.wdk.getAddress()

      const proof: X402PaymentProof = {
        signature,
        payerAddress: address,
        timestamp: new Date().toISOString(),
        nonce: requirements.nonce,
      }

      const proofString = JSON.stringify(proof)
      context.updateState({
        execution: {
          payment_proof: proofString,
          payment_status: "processing",
        },
      })

      return {
        success: true,
        data: {
          proof,
          mode: "signature",
          next_step: "Call shop.complete_with_payment to finalize the order",
        },
      }
    } catch (error) {
      context.updateState({
        execution: { payment_status: "failed" },
      })
      return {
        success: false,
        error: `Failed to generate payment proof: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

// ============================================================================
// Lightning Network Payment Tools
// ============================================================================

/**
 * payments.lightning_invoice - Generate Lightning Network invoice for instant BTC payment
 */
export const paymentsLightningInvoiceTool: Tool = {
  name: "payments.lightning_invoice",
  description: "Generate Lightning Network invoice for instant Bitcoin payment (< 1 second, ~$0.0001 fees)",
  parameters: {
    type: "object",
    properties: {
      amount_sats: {
        type: "number",
        description: "Amount in satoshis (1 BTC = 100,000,000 sats)"
      },
      memo: {
        type: "string",
        description: "Payment memo/description (optional)"
      }
    },
    required: ["amount_sats"]
  },
  execute: async (args, state, context): Promise<ToolResult> => {
    if (!context.lightningProcessor) {
      return {
        success: false,
        error: "Lightning Network not available. Use USDT payment instead."
      }
    }

    try {
      const invoice = await context.lightningProcessor.createLightningInvoice({
        amountSats: args.amount_sats as number,
        memo: (args.memo as string) || `Order ${state.execution.order_id || 'payment'}`
      })

      // Store invoice in state
      // Note: Invoice is stored in x402_requirements by shop.create_and_pay
      // context.updateState({
      //   execution: {
      //     lightning_invoice: invoice.invoice,
      //     payment_method: 'lightning',
      //     payment_status: 'pending'
      //   }
      // })

      return {
        success: true,
        data: {
          invoice: invoice.invoice,
          amount_sats: invoice.amountSats,
          memo: invoice.memo,
          payment_method: 'lightning',
          message: `Lightning invoice generated. Show QR code for ${invoice.amountSats} sats.`
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Failed to generate Lightning invoice: ${errorMessage}`
      }
    }
  }
}

/**
 * payments.spark_invoice - Generate Spark Network invoice (zero fees!)
 */
export const paymentsSparkInvoiceTool: Tool = {
  name: "payments.spark_invoice",
  description: "Generate Spark Network invoice for Bitcoin payment with ZERO fees (< 1 second)",
  parameters: {
    type: "object",
    properties: {
      amount_sats: {
        type: "number",
        description: "Amount in satoshis"
      },
      memo: {
        type: "string",
        description: "Payment memo/description (optional)"
      },
      expiry_minutes: {
        type: "number",
        description: "Invoice expiry in minutes (default: 5)"
      }
    },
    required: ["amount_sats"]
  },
  execute: async (args, state, context): Promise<ToolResult> => {
    if (!context.lightningProcessor) {
      return {
        success: false,
        error: "Spark Network not available. Use USDT payment instead."
      }
    }

    try {
      const invoice = await context.lightningProcessor.createSparkInvoice({
        amountSats: args.amount_sats as number,
        memo: (args.memo as string) || `Order ${state.execution.order_id || 'payment'}`,
        expiryMinutes: (args.expiry_minutes as number) || 5
      })

      // Note: Invoice is stored in x402_requirements by shop.create_and_pay
      // context.updateState({
      //   execution: {
      //     spark_invoice: invoice.invoice,
      //     payment_method: 'spark',
      //     payment_status: 'pending'
      //   }
      // })

      return {
        success: true,
        data: {
          invoice: invoice.invoice,
          amount_sats: invoice.amountSats,
          memo: invoice.memo,
          payment_method: 'spark',
          message: `Spark invoice generated with ZERO fees. Show QR code for ${invoice.amountSats} sats.`
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Failed to generate Spark invoice: ${errorMessage}`
      }
    }
  }
}

/**
 * payments.check_lightning - Check if Lightning invoice has been paid
 */
export const paymentsCheckLightningTool: Tool = {
  name: "payments.check_lightning",
  description: "Check Lightning Network invoice payment status",
  parameters: {
    type: "object",
    properties: {
      invoice: {
        type: "string",
        description: "Lightning invoice to check"
      }
    },
    required: ["invoice"]
  },
  execute: async (args, _state, context): Promise<ToolResult> => {
    if (!context.lightningProcessor) {
      return { success: false, error: "Lightning Network not available" }
    }

    try {
      const status = await context.lightningProcessor.checkLightningPayment(args.invoice as string)
      
      return {
        success: true,
        data: {
          paid: status.settled,
          pending: status.pending,
          amount: status.amount,
          settled_at: status.settledAt
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Failed to check Lightning payment: ${errorMessage}`
      }
    }
  }
}

/**
 * payments.check_spark - Check if Spark invoice has been paid
 */
export const paymentsCheckSparkTool: Tool = {
  name: "payments.check_spark",
  description: "Check Spark Network invoice payment status",
  parameters: {
    type: "object",
    properties: {
      invoice: {
        type: "string",
        description: "Spark invoice to check"
      }
    },
    required: ["invoice"]
  },
  execute: async (args, _state, context): Promise<ToolResult> => {
    if (!context.lightningProcessor) {
      return { success: false, error: "Spark Network not available" }
    }

    try {
      const status = await context.lightningProcessor.checkSparkPayment(args.invoice as string)
      
      return {
        success: true,
        data: {
          paid: status.paid,
          timestamp: status.timestamp
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: `Failed to check Spark payment: ${errorMessage}`
      }
    }
  }
}

// ============================================================================
// Tool Registry
// ============================================================================

export const TOOLS: Tool[] = [
  stateGetTool,
  statePatchTool,
  stateMissingFieldsTool,
  stateAdvanceIfReadyTool,
  stateSummaryTool,
  stateConfirmOrderTool,
  statePatchAndCheckTool,
  shopMenuTool,
  shopGetQuoteTool,
  shopCreateOrderTool,
  shopCreateAndPayTool,
  paymentsX402RequestTool,
  paymentsX402PayTool,
  paymentsLightningInvoiceTool,
  paymentsSparkInvoiceTool,
  paymentsCheckLightningTool,
  paymentsCheckSparkTool,
  shopCompleteWithPaymentTool,
]

export const TOOL_MAP: Map<ToolName, Tool> = new Map(
  TOOLS.map(tool => [tool.name, tool])
)

/**
 * Get tool by name
 */
export const getTool = (name: ToolName): Tool | undefined => {
  return TOOL_MAP.get(name)
}

/**
 * Execute a tool by name
 */
export const executeTool = async (
  name: ToolName,
  args: Record<string, unknown>,
  state: AgentState,
  context: ToolContext
): Promise<ToolResult> => {
  const tool = getTool(name)
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` }
  }

  // Check gating
  if (tool.gate) {
    const gateError = tool.gate(state)
    if (gateError) {
      return { success: false, error: `Tool gated: ${gateError}` }
    }
  }

  return tool.execute(args, state, context)
}

/**
 * Get tool schemas for LLM prompt
 */
export const getToolSchemas = (): Array<{ name: string; description: string; parameters: object }> => {
  return TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}
