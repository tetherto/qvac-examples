// ============================================================================
// QVAC Filler Phrases - Personal Assistant Context
// ============================================================================

import type { ToolName } from "../agent/types"

/**
 * Initial filler phrases - played immediately when user finishes speaking
 */
export const QVAC_INITIAL_FILLERS = [
  "One moment, I'll see what I can do.",
  "Sure! Let me help you with that.",
  "Processing your request.",
  "Give me a second.",
  "Let me look into that.",
  "Sure, let me check.",
]

/**
 * Extended processing phrases - played if processing takes longer
 */
export const QVAC_EXTENDED_FILLERS = [
  "I'm still working on your request.",
  "Almost there, just a moment longer.",
  "Still processing, won't be long now.",
  "Bear with me, almost done.",
  "Still working on it.",
  "Taking a bit longer than usual.",
  "Just finishing up.",
]

/**
 * Stage-specific fillers
 */
export const QVAC_STAGE_FILLERS: Record<string, string[]> = {
  COLLECT_INFO: [
    "Let me note that down.",
    "Got it, updating the order.",
    "Adding that to your request.",
  ],
  CONFIRM: [
    "Let me prepare your order summary.",
    "Putting together the details.",
  ],
  EXECUTE: [
    "Processing your payment.",
    "Sending your order through.",
    "Finalizing your order.",
    "Connecting to BitCafe.",
  ],
}

/**
 * Tool-specific calling phrases - personal assistant framing
 */
export const QVAC_TOOL_CALLING_FILLERS: Partial<Record<ToolName, string[]>> = {
  "shop.search": [
    "Let me search for coffee shops nearby.",
    "Looking for coffee shops in the area.",
    "Searching for options near you.",
    "Let me see what's around.",
    "Finding coffee shops for you.",
  ],
  "shop.menu": [
    "One moment, looking at the options available.",
  ],
  "shop.get_quote": [
    "Let me get the price for that.",
    "Calculating your total now.",
    "Getting a quote from BitCafe.",
  ],
  "shop.create_order": [
    "Creating your order now.",
    "Submitting your order.",
    "Placing your order.",
  ],
  "shop.create_and_pay": [
    "Processing your order and payment now.",
    "Setting up your order and payment.",
    "Handling your order, one moment.",
  ],
  "payments.x402_pay": [
    "Submitting payment on chain now.",
    "Initiating the blockchain payment.",
    "Sending your payment through.",
    "Processing the transaction.",
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

}

/**
 * Tool completion phrases
 */
export const QVAC_TOOL_COMPLETED_FILLERS: Partial<Record<ToolName, string[]>> = {
  "shop.search": [
    "Found some options.",
    "Got some results.",
  ],
  "shop.menu": [
    "Got the menu.",
    "Here's what they have.",
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
    "All done! Order is ready.",
    "Confirmation received.",
  ],
  "shop.create_order": [
    "Order submitted to BitCafe.",
  ],
  "state.confirm_order": [
    "Order confirmed, proceeding to payment.",
  ],
}

/**
 * Payment status fillers
 */
export const QVAC_PAYMENT_STATUS_FILLERS: Record<string, string[]> = {
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

/**
 * Recovery attempt fillers - played when the agent needs to retry after an error
 * These are context-specific based on what failed
 */
export const QVAC_RECOVERY_FILLERS: Record<string, string[]> = {
  // When state.summary wasn't called before confirm
  "state.summary": [
    "Oops, I skipped a step. Let me show you the order summary first.",
    "Hold on, I need to show you the order details first. Let me fix that.",
    "My mistake, let me pull up your order summary before we proceed.",
  ],
  // When state.confirm_order wasn't called before payment
  "state.confirm_order": [
    "One moment, I need to confirm your order first. Let me get that sorted.",
    "Let me confirm the order details before processing payment.",
    "Almost there, just need to lock in your order first.",
  ],
  // When fields are missing
  "missing_fields": [
    "Looks like I'm missing some details. Let me gather that information.",
    "I need a bit more information before we can continue.",
    "One moment, let me fill in the missing details.",
  ],
  // Generic recovery
  "generic": [
    "Oops, something went wrong. Let me try that again.",
    "Hold on, let me fix that and try again.",
    "Small hiccup, let me get that right.",
    "Let me try a different approach.",
  ],
}

/**
 * Combined export for easy use
 */
export const QVAC_FILLER_PHRASES = {
  INITIAL: QVAC_INITIAL_FILLERS,
  EXTENDED: QVAC_EXTENDED_FILLERS,
  STAGE: QVAC_STAGE_FILLERS,
  TOOL_CALLING: QVAC_TOOL_CALLING_FILLERS,
  TOOL_COMPLETED: QVAC_TOOL_COMPLETED_FILLERS,
  PAYMENT_STATUS: QVAC_PAYMENT_STATUS_FILLERS,
  RECOVERY: QVAC_RECOVERY_FILLERS,
}
