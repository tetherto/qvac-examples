// ============================================================================
// WDK Module Tests
// ============================================================================

import { describe, expect, test, beforeEach } from "bun:test"
import {
  // Wallet
  WDKWallet,
  createWDKWallet,
  generateSeedPhrase,
  validateSeedPhrase,
  // Mandates
  createIntentMandate,
  createCartMandate,
  createPaymentMandate,
  verifyMandate,
  // x402
  generatePaymentProof,
  serializePaymentProof,
  isPaymentRequired,
  // Context
  createWDKContext,
} from "../wdk"
import type { CartItem, CartFulfillment, X402PaymentRequirements } from "../wdk"

// ============================================================================
// Wallet Tests
// ============================================================================

describe("WDKWallet", () => {
  test("should create a wallet in mock mode", async () => {
    const wallet = createWDKWallet({ mode: "mock" })
    
    const address = await wallet.getAddress()
    expect(address).toBeDefined()
    expect(address).toContain("Mock")
  })

  test("should get account in mock mode", async () => {
    const wallet = createWDKWallet({ mode: "mock" })
    
    const account = await wallet.getAccount()
    expect(account.address).toBeDefined()
    expect(account.network).toBe("base-sepolia")
    expect(account.index).toBe(0)
  })

  test("should sign message in mock mode", async () => {
    const wallet = createWDKWallet({ mode: "mock" })
    
    const signature = await wallet.signMessage("test message")
    expect(signature).toBeDefined()
    expect(signature.startsWith("0x")).toBe(true)
  })

  test("should get balance in mock mode", async () => {
    const wallet = createWDKWallet({ mode: "mock" })
    
    const balance = await wallet.getBalance()
    expect(balance).toBeDefined()
    expect(BigInt(balance)).toBeGreaterThan(0n)
  })

  test("should send transaction in mock mode", async () => {
    const wallet = createWDKWallet({ mode: "mock" })
    
    const result = await wallet.sendTransaction({
      to: "0x1234567890123456789012345678901234567890",
      value: "1000000000000000000", // 1 ETH
    })
    
    expect(result.hash).toBeDefined()
    expect(result.status).toBe("confirmed")
  })
})

describe("Seed Phrase", () => {
  test("should generate a seed phrase", () => {
    const phrase = generateSeedPhrase()
    expect(phrase).toBeDefined()
    expect(phrase.split(" ").length).toBe(12)
  })

  test("should validate seed phrase", () => {
    const validPhrase = "abandon ability able about above absent absorb abstract absurd abuse access accident"
    expect(validateSeedPhrase(validPhrase)).toBe(true)
    
    expect(validateSeedPhrase("invalid")).toBe(false)
    expect(validateSeedPhrase("")).toBe(false)
  })
})

// ============================================================================
// Mandate Tests
// ============================================================================

describe("Mandates", () => {
  let wallet: WDKWallet

  beforeEach(() => {
    wallet = createWDKWallet({ mode: "mock" })
  })

  describe("IntentMandate", () => {
    test("should create an intent mandate", async () => {
      const mandate = await createIntentMandate(
        {
          maxSpend: 10.0,
          currency: "USDT",
          ttlMinutes: 60,
          description: "Order a large latte",
        },
        wallet
      )

      expect(mandate.id).toMatch(/^intent-/)
      expect(mandate.type).toBe("intent")
      expect(mandate.maxSpend).toBe(10.0)
      expect(mandate.currency).toBe("USDT")
      expect(mandate.signature).toBeDefined()
      expect(mandate.signedBy).toBeDefined()
    })

    test("should verify a signed intent mandate", async () => {
      const mandate = await createIntentMandate(
        {
          maxSpend: 10.0,
          currency: "USDT",
          ttlMinutes: 60,
          description: "Test",
        },
        wallet
      )

      const result = verifyMandate(mandate)
      expect(result.valid).toBe(true)
    })
  })

  describe("CartMandate", () => {
    test("should create a cart mandate", async () => {
      const items: CartItem[] = [
        {
          drinkId: "latte",
          options: ["extra-shot"],
          quantity: 1,
          unitPrice: 5.5,
        },
      ]

      const fulfillment: CartFulfillment = {
        mode: "pickup",
      }

      const mandate = await createCartMandate(
        {
          intentMandateId: "intent-test-123",
          items,
          fulfillment,
          recipient: "coffee-shop",
          store: "downtown",
          total: 7.5,
          currency: "USDT",
        },
        wallet
      )

      expect(mandate.id).toMatch(/^cart-/)
      expect(mandate.type).toBe("cart")
      expect(mandate.items).toHaveLength(1)
      expect(mandate.total).toBe(7.5)
      expect(mandate.signature).toBeDefined()
    })
  })

  describe("PaymentMandate", () => {
    test("should create a payment mandate", async () => {
      const mandate = await createPaymentMandate(
        {
          cartMandateId: "cart-test-456",
          amount: 7.5,
          currency: "USDT",
          recipient: "0xCoffeeShop123",
          network: "base-sepolia",
          ttlMinutes: 5,
          nonce: "abc123",
        },
        wallet
      )

      expect(mandate.id).toMatch(/^payment-/)
      expect(mandate.type).toBe("payment")
      expect(mandate.amount).toBe(7.5)
      expect(mandate.nonce).toBe("abc123")
      expect(mandate.signature).toBeDefined()
    })
  })

  describe("Mandate Expiration", () => {
    test("should detect expired mandate", async () => {
      // Create mandate with negative TTL
      const now = new Date()
      const mandate = await createIntentMandate(
        {
          maxSpend: 10.0,
          currency: "USDT",
          ttlMinutes: -1, // Already expired
          description: "Test",
        },
        wallet
      )

      const result = verifyMandate(mandate)
      expect(result.valid).toBe(false)
      expect(result.error).toContain("expired")
    })
  })
})

// ============================================================================
// x402 Client Tests
// ============================================================================

describe("x402 Client", () => {
  let wallet: WDKWallet

  beforeEach(() => {
    wallet = createWDKWallet({ mode: "mock" })
  })

  test("should detect 402 response", () => {
    const response402 = new Response(null, { status: 402 })
    const response200 = new Response(null, { status: 200 })

    expect(isPaymentRequired(response402)).toBe(true)
    expect(isPaymentRequired(response200)).toBe(false)
  })

  test("should generate payment proof", async () => {
    const requirements: X402PaymentRequirements = {
      amount: 5.5,
      currency: "USDT",
      recipient: "0xCoffeeShop123",
      network: "base-sepolia",
      validUntil: new Date(Date.now() + 300000).toISOString(),
      orderId: "ORD-2026-0001",
      nonce: "test-nonce-123",
    }

    const result = await generatePaymentProof(requirements, wallet)

    expect(result.success).toBe(true)
    expect(result.proof).toBeDefined()
    expect(result.proof!.payerAddress).toBeDefined()
    expect(result.proof!.nonce).toBe("test-nonce-123")
    expect(result.proof!.signature).toBeDefined()
  })

  test("should serialize payment proof", async () => {
    const requirements: X402PaymentRequirements = {
      amount: 5.5,
      currency: "USDT",
      recipient: "0xCoffeeShop123",
      network: "base-sepolia",
      validUntil: new Date(Date.now() + 300000).toISOString(),
      orderId: "ORD-2026-0001",
      nonce: "test-nonce-123",
    }

    const result = await generatePaymentProof(requirements, wallet)
    const serialized = serializePaymentProof(result.proof!)
    const parsed = JSON.parse(serialized)

    expect(parsed.signature).toBe(result.proof!.signature)
    expect(parsed.payerAddress).toBe(result.proof!.payerAddress)
    expect(parsed.nonce).toBe(result.proof!.nonce)
  })
})

// ============================================================================
// WDK Context Tests
// ============================================================================

describe("WDK Context", () => {
  test("should create WDK context in mock mode", () => {
    const context = createWDKContext({ mode: "mock" })

    expect(context).toBeDefined()
    expect(context.getAddress).toBeDefined()
    expect(context.signMessage).toBeDefined()
    expect(context.getAccount).toBeDefined()
  })

  test("should get address from context", async () => {
    const context = createWDKContext({ mode: "mock" })
    const address = await context.getAddress()

    expect(address).toBeDefined()
    expect(address).toContain("Mock")
  })

  test("should sign message from context", async () => {
    const context = createWDKContext({ mode: "mock" })
    const signature = await context.signMessage("test message")

    expect(signature).toBeDefined()
    expect(signature.length).toBeGreaterThan(0)
  })

  test("should get account from context", async () => {
    const context = createWDKContext({ mode: "mock" })
    const account = await context.getAccount()

    expect(account.address).toBeDefined()
    expect(account.signMessage).toBeDefined()
  })
})
