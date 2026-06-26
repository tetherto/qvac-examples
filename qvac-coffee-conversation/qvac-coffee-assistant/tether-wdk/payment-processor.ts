/**
 * Payment Processor using Tether WDK
 * Handles coffee payments across multiple blockchains
 */

import { TetherWDKManager } from './wdk-manager'

export interface PaymentRequest {
  orderId: string
  customerId: string
  customerName: string
  amount: number
  currency: string
  chain: 'ethereum' | 'bitcoin' | 'solana' | 'tron'
  merchantAddress: string
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
  metadata?: Record<string, any>
}

export interface PaymentResult {
  success: boolean
  orderId: string
  transactionHash?: string
  chain: string
  amount: string
  fee?: string
  timestamp: string
  error?: string
  reason?: string
}

/**
 * Payment Processor for Coffee Orders
 */
export class TetherWDKPaymentProcessor {
  private wdkManager: TetherWDKManager

  constructor(wdkManager: TetherWDKManager) {
    this.wdkManager = wdkManager
  }

  /**
   * Process payment for coffee order
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    console.log('\n╔════════════════════════════════════════════════════════════════╗')
    console.log('║           Processing Coffee Payment with Tether WDK           ║')
    console.log('╚════════════════════════════════════════════════════════════════╝\n')

    console.log(`📋 Order ID: ${request.orderId}`)
    console.log(`💰 Amount: ${request.amount} ${request.currency}`)
    console.log(`🔗 Chain: ${request.chain.toUpperCase()}`)
    console.log(`🏪 Merchant: ${request.merchantAddress}\n`)

    try {
      // Step 1: Get customer wallet address
      const customerAddress = await this.wdkManager.getAddress(request.chain, 0)
      console.log(`✅ Customer Wallet: ${customerAddress}`)

      // Step 2: Check balance
      const balance = await this.wdkManager.getBalance(request.chain, 0)
      console.log(`✅ Current Balance: ${balance} units\n`)

      // Step 3: Convert amount to chain-specific units
      const amountInUnits = this.convertToChainUnits(request.amount, request.chain, request.currency)
      console.log(`💸 Payment Amount: ${amountInUnits.toString()} units`)

      // Step 4: Estimate transaction fee
      console.log(`📊 Estimating transaction fee...`)
      const estimate = await this.wdkManager.estimateTransaction(
        request.chain,
        {
          to: request.merchantAddress,
          value: amountInUnits
        },
        0
      )
      console.log(`✅ Estimated Fee: ${estimate.fee} units\n`)

      // Step 5: Send transaction
      console.log(`🚀 Sending payment transaction...`)
      const txResult = await this.wdkManager.sendTransaction(
        request.chain,
        {
          to: request.merchantAddress,
          value: amountInUnits
        },
        0
      )

      const txHash = txResult.hash || txResult.signature || txResult.txid

      console.log(`\n✅ Payment successful!`)
      console.log(`   Transaction: ${txHash}`)
      console.log(`   Chain: ${request.chain}`)
      console.log(`   Amount: ${amountInUnits.toString()} units\n`)

      return {
        success: true,
        orderId: request.orderId,
        transactionHash: txHash,
        chain: request.chain,
        amount: amountInUnits.toString(),
        fee: estimate.fee,
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error(`\n❌ Payment failed:`, error)

      return {
        success: false,
        orderId: request.orderId,
        chain: request.chain,
        amount: request.amount.toString(),
        timestamp: new Date().toISOString(),
        error: 'Payment failed',
        reason: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Verify payment (check transaction status)
   */
  async verifyPayment(chain: string, transactionHash: string): Promise<boolean> {
    console.log(`\n🔍 Verifying payment on ${chain}...`)
    console.log(`   Transaction: ${transactionHash}`)

    try {
      // Get transaction history to verify
      const history = await this.wdkManager.getTransactionHistory(chain, 0, 100)
      
      // Check if transaction exists in history
      const found = history.some((tx: any) => 
        tx.hash === transactionHash || 
        tx.signature === transactionHash ||
        tx.txid === transactionHash
      )

      if (found) {
        console.log(`✅ Payment verified!`)
        return true
      } else {
        console.log(`⚠️  Transaction not found in history (may still be pending)`)
        return false
      }
    } catch (error) {
      console.error(`Error verifying payment:`, error)
      return false
    }
  }

  /**
   * Convert USD amount to chain-specific units
   */
  private convertToChainUnits(amount: number, chain: string, currency: string): bigint {
    // For simplicity, assuming stable prices
    // In production, you'd use an oracle or price feed

    switch (chain) {
      case 'ethereum':
        // Assuming USDT on Ethereum (6 decimals)
        if (currency === 'USDT' || currency === 'USD') {
          return BigInt(Math.floor(amount * 1_000_000))
        }
        // Native ETH (18 decimals) - rough conversion at $3000/ETH
        return BigInt(Math.floor((amount / 3000) * 1e18))

      case 'bitcoin':
        // Satoshis (8 decimals) - rough conversion at $60000/BTC
        return BigInt(Math.floor((amount / 60000) * 1e8))

      case 'solana':
        // Lamports (9 decimals) - rough conversion at $150/SOL
        return BigInt(Math.floor((amount / 150) * 1e9))

      case 'tron':
        // Sun (6 decimals) - rough conversion at $0.15/TRX
        return BigInt(Math.floor((amount / 0.15) * 1e6))

      default:
        throw new Error(`Unsupported chain: ${chain}`)
    }
  }

  /**
   * Get supported chains
   */
  getSupportedChains(): string[] {
    return ['ethereum', 'bitcoin', 'solana', 'tron']
  }

  /**
   * Get merchant addresses for each chain
   */
  getDefaultMerchantAddresses(): Record<string, string> {
    return {
      ethereum: '0x742d35Cc6634C0532925a3b844D9C5c8b7b6e5f6e5', // Example
      bitcoin: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Example
      solana: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK', // Example
      tron: 'TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH' // Example
    }
  }
}
