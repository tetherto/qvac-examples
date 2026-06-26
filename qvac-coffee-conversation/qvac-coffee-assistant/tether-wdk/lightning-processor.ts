/**
 * Lightning Network Payment Processor using Tether WDK Spark
 * Handles Lightning invoice generation, payment, and tracking
 */

import { TetherWDKManager } from './wdk-manager'

export interface LightningInvoice {
  invoice: string
  amountSats: number
  memo?: string
  expiresAt?: Date
}

export interface LightningPaymentStatus {
  settled: boolean
  amount?: number
  settledAt?: Date
  pending?: boolean
}

export interface SparkInvoice {
  invoice: string
  amountSats: number
  memo?: string
  expiryTime?: Date
}

export interface LightningTransfer {
  id: string
  type: 'lightning_send' | 'lightning_receive' | 'spark' | 'bitcoin'
  amount: number
  timestamp: Date
  memo?: string
  status: 'pending' | 'completed' | 'failed'
}

/**
 * Lightning Network Payment Processor
 */
export class LightningPaymentProcessor {
  private wdkManager: TetherWDKManager
  private sparkAccount?: any
  private initializationError?: string
  private isInitialized: boolean = false

  constructor(wdkManager: TetherWDKManager) {
    this.wdkManager = wdkManager
  }

  /**
   * Check if Lightning processor is available
   */
  isAvailable(): boolean {
    return this.isInitialized && this.sparkAccount !== undefined && !this.initializationError
  }

  /**
   * Get initialization error message if any
   */
  getInitializationError(): string | undefined {
    return this.initializationError
  }

  /**
   * Initialize Lightning processor
   * Does not throw - sets availability flag instead
   */
  async initialize(): Promise<boolean> {
    try {
      this.sparkAccount = await this.wdkManager.getSparkAccount(0)
      this.isInitialized = true
      this.initializationError = undefined
      console.log('⚡ Lightning payment processor initialized')
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.initializationError = errorMessage
      this.isInitialized = true // Mark as initialized (attempted) to avoid repeated attempts
      console.warn('⚠️  Lightning processor initialization failed:', errorMessage)
      console.warn('   Lightning Network payments will not be available until connectivity is restored.')
      return false
    }
  }

  /**
   * Ensure initialized - attempts lazy initialization if not yet done
   * Returns false if Spark is not available
   */
  private async ensureInitialized(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    return this.isAvailable()
  }

  /**
   * Create Lightning invoice for receiving BTC payment
   */
  async createLightningInvoice(params: {
    amountSats: number
    memo?: string
  }): Promise<LightningInvoice> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      throw new Error(`Lightning Network not available: ${this.initializationError || 'Spark wallet not initialized'}`)
    }

    const invoiceData = await this.sparkAccount.createLightningInvoice({
      amountSats: params.amountSats,
      memo: params.memo || 'Coffee order payment'
    })

    // Handle different invoice formats from Spark SDK
    const invoiceString = typeof invoiceData.invoice === 'string'
      ? invoiceData.invoice
      : invoiceData.encodedInvoice || invoiceData.invoice?.encodedInvoice || JSON.stringify(invoiceData.invoice)

    return {
      invoice: invoiceString,
      amountSats: params.amountSats,
      memo: params.memo,
      expiresAt: invoiceData.expiresAt ? new Date(invoiceData.expiresAt) : undefined
    }
  }

  /**
   * Create Spark invoice (zero fees)
   */
  async createSparkInvoice(params: {
    amountSats: number
    memo?: string
    expiryMinutes?: number
  }): Promise<SparkInvoice> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      throw new Error(`Lightning Network not available: ${this.initializationError || 'Spark wallet not initialized'}`)
    }

    const expiryTime = new Date(Date.now() + (params.expiryMinutes || 5) * 60000)

    const invoiceData = await this.sparkAccount.createSparkSatsInvoice({
      amount: params.amountSats,
      memo: params.memo || 'Coffee order payment',
      expiryTime
    })

    return {
      invoice: invoiceData,
      amountSats: params.amountSats,
      memo: params.memo,
      expiryTime
    }
  }

  /**
   * Check Lightning invoice payment status
   * Note: checkLightningPayment may not be available in all Spark SDK versions
   */
  async checkLightningPayment(invoice: string): Promise<LightningPaymentStatus> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      console.warn('Lightning payment check skipped: Spark not available')
      return {
        settled: false,
        pending: true
      }
    }

    try {
      // Check if the method exists
      if (typeof this.sparkAccount.checkLightningPayment === 'function') {
        const status = await this.sparkAccount.checkLightningPayment(invoice)
        return {
          settled: status.settled || false,
          amount: status.amount,
          settledAt: status.settledAt ? new Date(status.settledAt) : undefined,
          pending: !status.settled
        }
      } else if (typeof this.sparkAccount.getLightningInvoiceStatus === 'function') {
        // Try alternative method name
        const status = await this.sparkAccount.getLightningInvoiceStatus(invoice)
        return {
          settled: status.settled || status.paid || false,
          amount: status.amount,
          settledAt: status.settledAt ? new Date(status.settledAt) : undefined,
          pending: !(status.settled || status.paid)
        }
      } else {
        // Method not available - return pending status
        console.warn('Lightning payment status checking not available in this Spark SDK version')
        return {
          settled: false,
          pending: true
        }
      }
    } catch (error) {
      console.error('Failed to check Lightning payment:', error)
      return {
        settled: false,
        pending: true
      }
    }
  }

  /**
   * Check Spark invoice payment status
   */
  async checkSparkPayment(invoice: string): Promise<{ paid: boolean; timestamp?: Date }> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      console.warn('Spark payment check skipped: Spark not available')
      return { paid: false }
    }

    try {
      const statuses = await this.sparkAccount.getSparkInvoices([invoice])
      const status = statuses[0]
      
      return {
        paid: status?.paid || false,
        timestamp: status?.paidAt ? new Date(status.paidAt) : undefined
      }
    } catch (error) {
      console.error('Failed to check Spark payment:', error)
      return { paid: false }
    }
  }

  /**
   * Pay a Lightning invoice (for sending payments)
   */
  async payLightningInvoice(params: {
    encodedInvoice: string
    maxFeeSats?: number
  }): Promise<{ success: boolean; paymentHash?: string; error?: string }> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return {
        success: false,
        error: `Lightning Network not available: ${this.initializationError || 'Spark wallet not initialized'}`
      }
    }

    try {
      const result = await this.sparkAccount.payLightningInvoice({
        invoice: params.encodedInvoice, // SDK expects 'invoice', not 'encodedInvoice'
        maxFeeSats: params.maxFeeSats || 100 // Default max fee: 100 sats
      })

      return {
        success: true,
        paymentHash: result.paymentHash
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Lightning payment failed:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Wait for Lightning payment to complete
   * Returns when payment is complete (success or failure) or timeout
   */
  async waitForPaymentCompletion(paymentId: string, options?: {
    maxAttempts?: number
    delayMs?: number
  }): Promise<{
    complete: boolean
    status?: string
    success?: boolean
    paymentPreimage?: string
  }> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return { complete: false, status: 'Spark not available' }
    }

    const maxAttempts = options?.maxAttempts || 10
    const delayMs = options?.delayMs || 1000

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      
      try {
        const sendRequest = await this.sparkAccount.getLightningSendRequest(paymentId)
        
        if (sendRequest) {
          const status = sendRequest.status
          
          // Success states
          if (status === 'TRANSFER_COMPLETED' || status === 'LIGHTNING_PAYMENT_SUCCEEDED') {
            return {
              complete: true,
              status,
              success: true,
              paymentPreimage: sendRequest.paymentPreimage
            }
          }
          
          // Failure states
          if (status === 'TRANSFER_FAILED' || 
              status === 'LIGHTNING_PAYMENT_FAILED' ||
              status === 'USER_TRANSFER_VALIDATION_FAILED') {
            return {
              complete: true,
              status,
              success: false
            }
          }
        }
      } catch (error) {
        console.error(`Attempt ${attempt}: Failed to check payment status`, error)
      }
    }

    return { complete: false }
  }

  /**
   * Get Lightning/Spark transaction history
   */
  async getTransfers(params?: {
    direction?: 'all' | 'incoming' | 'outgoing'
    limit?: number
    skip?: number
  }): Promise<LightningTransfer[]> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      console.warn('Get transfers skipped: Spark not available')
      return []
    }

    try {
      const transfers = await this.sparkAccount.getTransfers({
        direction: params?.direction || 'all',
        limit: params?.limit || 50,
        skip: params?.skip || 0
      })

      return transfers.map((t: any) => ({
        id: t.id || t.hash || 'unknown',
        type: this.determineTransferType(t),
        amount: t.amount || t.value || 0,
        timestamp: new Date(t.timestamp || Date.now()),
        memo: t.memo || t.description,
        status: t.status || 'completed'
      }))
    } catch (error) {
      console.error('Failed to get transfers:', error)
      return []
    }
  }

  /**
   * Get Spark balance in satoshis
   */
  async getBalance(): Promise<{ sats: bigint; btc: number }> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return { sats: BigInt(0), btc: 0 }
    }

    try {
      const balanceSats = await this.sparkAccount.getBalance()
      return {
        sats: balanceSats,
        btc: Number(balanceSats) / 100000000
      }
    } catch (error) {
      console.error('Failed to get Spark balance:', error)
      return { sats: BigInt(0), btc: 0 }
    }
  }

  /**
   * Get Spark wallet address
   */
  async getAddress(): Promise<string> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return 'Not available'
    }

    try {
      return await this.sparkAccount.getAddress()
    } catch (error) {
      console.error('Failed to get Spark address:', error)
      return 'Not available'
    }
  }

  /**
   * Generate Bitcoin L1 deposit address
   */
  async getDepositAddress(): Promise<string> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return 'Not available'
    }

    try {
      return await this.sparkAccount.getStaticDepositAddress()
    } catch (error) {
      console.error('Failed to get deposit address:', error)
      return 'Not available'
    }
  }

  /**
   * Claim Bitcoin L1 deposit
   */
  async claimDeposit(txId: string): Promise<{ success: boolean; walletLeaves?: any; error?: string }> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return {
        success: false,
        error: `Lightning Network not available: ${this.initializationError || 'Spark wallet not initialized'}`
      }
    }

    try {
      const walletLeaves = await this.sparkAccount.claimStaticDeposit(txId)
      return {
        success: true,
        walletLeaves
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Deposit claim failed:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Withdraw to Bitcoin L1
   */
  async withdrawToBitcoin(params: {
    address: string
    amountSats: number
  }): Promise<{ success: boolean; withdrawalId?: string; error?: string }> {
    const available = await this.ensureInitialized()
    if (!available || !this.sparkAccount) {
      return {
        success: false,
        error: `Lightning Network not available: ${this.initializationError || 'Spark wallet not initialized'}`
      }
    }

    try {
      // Get withdrawal fee quote first
      const feeQuote = await this.sparkAccount.quoteWithdraw({
        withdrawalAddress: params.address,
        amountSats: params.amountSats
      })

      console.log(`Withdrawal fee quote: ${feeQuote.fee} sats`)

      // Execute withdrawal
      const withdrawal = await this.sparkAccount.withdraw({
        onchainAddress: params.address,
        amountSats: params.amountSats
      })

      return {
        success: true,
        withdrawalId: withdrawal.id
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Withdrawal failed:', errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }
  }

  /**
   * Determine transfer type from transfer object
   */
  private determineTransferType(transfer: any): 'lightning_send' | 'lightning_receive' | 'spark' | 'bitcoin' {
    if (transfer.type) {
      if (transfer.type.includes('lightning')) {
        return transfer.direction === 'outgoing' ? 'lightning_send' : 'lightning_receive'
      }
      if (transfer.type.includes('spark')) return 'spark'
      if (transfer.type.includes('bitcoin') || transfer.type.includes('btc')) return 'bitcoin'
    }
    
    // Fallback based on direction
    return transfer.direction === 'outgoing' ? 'lightning_send' : 'lightning_receive'
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.sparkAccount = undefined
    console.log('⚡ Lightning payment processor disposed')
  }
}

export default LightningPaymentProcessor

