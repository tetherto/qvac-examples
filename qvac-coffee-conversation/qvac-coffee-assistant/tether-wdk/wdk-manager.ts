/**
 * Tether WDK Manager for Coffee Assistant
 * Manages multi-chain wallets (Ethereum, Bitcoin, Solana, TRON)
 */

import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import WalletManagerTron from '@tetherto/wdk-wallet-tron'
import WalletManagerSpark from '@tetherto/wdk-wallet-spark'
import * as fs from 'fs'
import * as path from 'path'

// Network configuration based on NETWORK_MODE environment variable
const NETWORK_MODE = process.env.NETWORK_MODE || 'testnet'
const IS_MAINNET = NETWORK_MODE === 'mainnet'

// Default RPC endpoints for each network mode
const RPC_DEFAULTS = {
  testnet: {
    ethereum: 'https://sepolia.drpc.org',
    solana: 'https://api.devnet.solana.com',
    tron: 'https://nile.trongrid.io',
    bitcoin: { network: 'testnet' as const, host: 'blockstream.info', port: 143 }
  },
  mainnet: {
    ethereum: 'https://eth.drpc.org',
    solana: 'https://api.mainnet-beta.solana.com',
    tron: 'https://api.trongrid.io',
    bitcoin: { network: 'mainnet' as const, host: 'blockstream.info', port: 143 }
  }
}

export interface WDKConfig {
  seedPhrase?: string
  networks?: {
    ethereum?: string
    bitcoin?: { network: 'mainnet' | 'testnet'; host: string; port: number }
    solana?: { rpcUrl: string; wsUrl?: string }
    tron?: string
    spark?: { network: 'MAINNET' | 'SIGNET' | 'REGTEST' }
  }
}

export interface WalletAccount {
  chain: string
  address: string
  balance: string
  account: any // The actual WDK account object
}

/**
 * Tether WDK Manager
 * Handles multi-chain wallet operations
 */
export class TetherWDKManager {
  private wdk: any
  private seedPhrase: string
  private accounts: Map<string, any> = new Map()
  private dataDir: string
  private sparkWallet?: WalletManagerSpark
  private sparkAccounts: Map<number, any> = new Map()
  private sparkUnavailable: boolean = false
  private sparkUnavailableReason?: string
  private sparkRetryAfter?: Date

  constructor(config: WDKConfig = {}) {
    this.dataDir = path.join(process.cwd(), 'data')
    
    // Load or generate seed phrase
    this.seedPhrase = config.seedPhrase || this.loadOrGenerateSeedPhrase()

    // Get network defaults based on NETWORK_MODE
    const defaults = IS_MAINNET ? RPC_DEFAULTS.mainnet : RPC_DEFAULTS.testnet
    
    // Allow environment variable overrides
    const ethRpc = process.env.ETH_RPC_URL || config.networks?.ethereum || defaults.ethereum
    const solRpc = process.env.SOLANA_RPC_URL || config.networks?.solana?.rpcUrl || defaults.solana
    const tronRpc = process.env.TRON_RPC_URL || config.networks?.tron || defaults.tron
    const btcNetwork = process.env.BTC_NETWORK === 'mainnet' ? 'mainnet' : defaults.bitcoin.network

    // Initialize WDK with wallets
    this.wdk = new WDK(this.seedPhrase)
      .registerWallet('ethereum', WalletManagerEvm as any, {
        provider: ethRpc
      })
      .registerWallet('bitcoin', WalletManagerBtc as any, config.networks?.bitcoin || {
        network: btcNetwork,
        host: 'blockstream.info',
        port: 143
      })
      .registerWallet('solana', WalletManagerSolana as any, config.networks?.solana || {
        rpcUrl: solRpc,
        wsUrl: solRpc.replace('https://', 'wss://')
      })
      .registerWallet('tron', WalletManagerTron as any, {
        provider: tronRpc
      })

    console.log(`✅ Tether WDK initialized (${NETWORK_MODE} mode)`)
    console.log(`   Ethereum: ${ethRpc}`)
    console.log(`   TRON: ${tronRpc}`)
    console.log(`   Solana: ${solRpc}`)
    console.log(`   Bitcoin: ${btcNetwork}`)
    
    // Initialize Spark wallet for Lightning Network
    this.initializeSpark(config.networks?.spark?.network)
  }
  
  /**
   * Initialize Spark wallet for Lightning Network payments
   */
  private initializeSpark(network?: 'MAINNET' | 'SIGNET' | 'REGTEST') {
    try {
      // Spark networks are MAINNET / SIGNET / REGTEST. There is NO "TESTNET": older configs
      // that pass "TESTNET" hit a retired coordinator and fail to connect ("Unable to connect"),
      // so we map it to SIGNET (Spark's public test network).
      const normalize = (n?: string): 'MAINNET' | 'SIGNET' | 'REGTEST' | undefined => {
        const v = (n || '').toUpperCase()
        if (v === 'TESTNET') {
          console.warn('⚠️  Spark has no "TESTNET"; using SIGNET (its public test network) instead.')
          return 'SIGNET'
        }
        return v === 'MAINNET' || v === 'SIGNET' || v === 'REGTEST' ? v : undefined
      }

      // Priority: explicit param > SPARK_NETWORK env > NETWORK_MODE. Non-mainnet defaults to
      // SIGNET, never the invalid TESTNET.
      const sparkNetwork =
        normalize(network) ??
        normalize(process.env.SPARK_NETWORK) ??
        (IS_MAINNET ? 'MAINNET' : 'SIGNET')

      // SparkScan (when an API key is set) gives fast HTTP balance reads (btcSoftBalanceSats)
      // instead of the slow on-protocol path. It only supports MAINNET and REGTEST.
      const sparkConfig: { network: string; sparkscan?: { apiKey: string } } = { network: sparkNetwork }
      const sparkscanApiKey = process.env.SPARKSCAN_API_KEY
      if (sparkscanApiKey && (sparkNetwork === 'MAINNET' || sparkNetwork === 'REGTEST')) {
        sparkConfig.sparkscan = { apiKey: sparkscanApiKey }
      }

      this.sparkWallet = new WalletManagerSpark(this.seedPhrase, sparkConfig as any)
      console.log(`⚡ Spark wallet initialized (${sparkNetwork}${sparkConfig.sparkscan ? ' + SparkScan' : ''})`)

      // NOTE: we do NOT authenticate Spark here. Constructing the wallet is offline; the first
      // getSparkAccount() call does the network handshake. Authenticating eagerly at construction
      // is what crashed the demo in mock mode: the SIGNET coordinator is unreachable, the Spark SDK
      // then retries auth in the background and throws uncaught SparkAuthenticationErrors that kill
      // the whole voice UI. Prewarming is now an explicit, real-mode-only opt-in (prewarmSpark()),
      // and both server processes install a crash guard so a payment-path failure can never take
      // the conversation down. Mock mode never touches Spark at all.
    } catch (error) {
      console.error('⚠️  Failed to initialize Spark wallet:', error)
      console.log('   Lightning Network payments will not be available')
    }
  }

  /**
   * Establish the Spark auth connection ahead of the first payment (background, best-effort).
   * Opt-in: only the server boot path calls this, and only when USE_REAL_PAYMENTS=true, so mock
   * mode never authenticates Spark. Returns the in-flight promise so callers can attach their own
   * handling; it also swallows its own failure so an unhandled rejection can never crash the host.
   */
  prewarmSpark(): Promise<void> {
    if (!this.sparkWallet) return Promise.resolve()
    return Promise.resolve()
      .then(() => this.getSparkAccount(1)) // shop account (index 1) mints the invoices
      .then(() => { console.log('⚡ Spark connection prewarmed') })
      .catch((e: any) => { console.log(`⚡ Spark prewarm skipped: ${e?.message || e}`) })
  }
  
  /**
   * Check if Spark wallet is available
   */
  isSparkAvailable(): boolean {
    if (!this.sparkWallet) return false
    if (this.sparkUnavailable) {
      // Check if we should retry (after 60 seconds)
      if (this.sparkRetryAfter && new Date() > this.sparkRetryAfter) {
        console.log('⚡ Retrying Spark connection after cooldown...')
        this.sparkUnavailable = false
        this.sparkUnavailableReason = undefined
      } else {
        return false
      }
    }
    return true
  }

  /**
   * Get the reason why Spark is unavailable
   */
  getSparkUnavailableReason(): string | undefined {
    return this.sparkUnavailableReason
  }

  /**
   * Mark Spark as unavailable to prevent repeated connection attempts
   */
  private markSparkUnavailable(reason: string): void {
    this.sparkUnavailable = true
    this.sparkUnavailableReason = reason
    // Retry after 60 seconds
    this.sparkRetryAfter = new Date(Date.now() + 60000)
    console.warn(`⚠️  Spark marked as unavailable for 60 seconds: ${reason}`)
  }

  /**
   * Reset Spark unavailable state (call when connectivity is restored)
   */
  resetSparkAvailability(): void {
    this.sparkUnavailable = false
    this.sparkUnavailableReason = undefined
    this.sparkRetryAfter = undefined
    // Clear cached accounts so they can be re-initialized
    this.sparkAccounts.clear()
    console.log('⚡ Spark availability reset - will retry on next request')
  }

  /**
   * Get Spark account for Lightning Network operations
   * Throws an error if Spark is not available or authentication fails
   */
  async getSparkAccount(index: number = 0): Promise<any> {
    if (!this.sparkWallet) {
      throw new Error('Spark wallet not initialized. Lightning Network not available.')
    }
    
    // Check if Spark was recently marked unavailable
    if (this.sparkUnavailable) {
      if (this.sparkRetryAfter && new Date() > this.sparkRetryAfter) {
        console.log('⚡ Retrying Spark connection after cooldown...')
        this.sparkUnavailable = false
        this.sparkUnavailableReason = undefined
      } else {
        throw new Error(`Spark network temporarily unavailable: ${this.sparkUnavailableReason || 'Connection failed'}`)
      }
    }
    
    // Check if account is already cached for this index
    if (!this.sparkAccounts.has(index)) {
      console.log(`⚡ Creating Spark account for index ${index}...`)
      try {
        const account = await this.sparkWallet.getAccount(index)
        this.sparkAccounts.set(index, account)
        
        // Log the address to verify if indices create different addresses
        try {
          const address = await account.getAddress()
          console.log(`⚡ Spark account ${index} address: ${address}`)
        } catch (err) {
          console.warn(`Could not get address for Spark account ${index}`)
        }
      } catch (error) {
        // Handle Spark authentication/connection errors gracefully
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isAuthError = errorMessage.includes('Authentication') || 
                           errorMessage.includes('SparkAuthenticationError') ||
                           errorMessage.includes('Unable to connect') ||
                           errorMessage.includes('Transport error')
        
        if (isAuthError) {
          // Mark Spark as unavailable to prevent cascading failures
          this.markSparkUnavailable(errorMessage)
          throw new Error(`Spark network unavailable: Authentication failed. Check your internet connection.`)
        }
        
        // Re-throw other errors
        throw error
      }
    }
    
    return this.sparkAccounts.get(index)
  }
  
  /**
   * Get Spark wallet address
   */
  async getSparkAddress(index: number = 0): Promise<string> {
    const account = await this.getSparkAccount(index)
    return await account.getAddress()
  }
  
  /**
   * Get Spark balance in satoshis
   */
  async getSparkBalance(index: number = 0): Promise<bigint> {
    const account = await this.getSparkAccount(index)
    return await account.getBalance()
  }

  /**
   * Load or generate seed phrase
   */
  private loadOrGenerateSeedPhrase(): string {
    // Env override: WDK_SEED_PHRASE lets the wallet travel entirely in the .env, so a demo can be
    // provisioned by dropping in a single .env file (no seed file to ship). Takes priority.
    const envSeed = process.env.WDK_SEED_PHRASE?.trim()
    if (envSeed) {
      console.log('📂 Loaded seed phrase from WDK_SEED_PHRASE env')
      return envSeed
    }

    const seedFile = path.join(this.dataDir, 'tether-wdk-seed.json')

    try {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
      }

      // Check if seed file exists
      if (fs.existsSync(seedFile)) {
        const data = JSON.parse(fs.readFileSync(seedFile, 'utf-8'))
        console.log('📂 Loaded existing seed phrase from file')
        return data.seedPhrase
      } else {
        // Generate new seed phrase
        const newSeedPhrase = WDK.getRandomSeedPhrase()
        
        // Save to file
        fs.writeFileSync(
          seedFile,
          JSON.stringify({ 
            seedPhrase: newSeedPhrase,
            created: new Date().toISOString()
          }, null, 2)
        )
        
        console.log('🆕 Generated new seed phrase and saved to file')
        console.log('⚠️  IMPORTANT: Backup your seed phrase from:', seedFile)
        
        return newSeedPhrase
      }
    } catch (error) {
      console.error('Error managing seed phrase:', error)
      throw error
    }
  }

  /**
   * Get seed phrase (be careful with this!)
   */
  getSeedPhrase(): string {
    return this.seedPhrase
  }

  /**
   * Get account for specific chain
   */
  async getAccount(chain: string, index: number = 0): Promise<any> {
    const cacheKey = `${chain}-${index}`
    
    if (this.accounts.has(cacheKey)) {
      return this.accounts.get(cacheKey)
    }

    const account = await this.wdk.getAccount(chain, index)
    this.accounts.set(cacheKey, account)
    
    return account
  }

  /**
   * Get address for specific chain
   */
  async getAddress(chain: string, index: number = 0): Promise<string> {
    const account = await this.getAccount(chain, index)
    return await account.getAddress()
  }

  /**
   * Get balance for specific chain
   */
  async getBalance(chain: string, index: number = 0): Promise<string> {
    const account = await this.getAccount(chain, index)
    const balance = await account.getBalance()
    return balance.toString()
  }

  /**
   * Get all wallet information
   */
  async getAllWallets(): Promise<WalletAccount[]> {
    const chains = ['ethereum', 'bitcoin', 'solana', 'tron']
    const wallets: WalletAccount[] = []

    for (const chain of chains) {
      try {
        const account = await this.getAccount(chain, 0)
        const address = await account.getAddress()
        const balance = await account.getBalance()

        wallets.push({
          chain,
          address,
          balance: balance.toString(),
          account
        })
      } catch (error) {
        console.error(`Error getting ${chain} wallet:`, error)
        wallets.push({
          chain,
          address: 'Error',
          balance: '0',
          account: null
        })
      }
    }

    return wallets
  }

  /**
   * Send native transaction on specific chain (TRX, ETH, SOL, etc.)
   */
  async sendTransaction(
    chain: string, 
    params: { to: string; value: bigint | string; data?: string },
    index: number = 0
  ): Promise<any> {
    const account = await this.getAccount(chain, index)
    
    console.log(`💸 Sending native transaction on ${chain}...`)
    console.log(`   To: ${params.to}`)
    console.log(`   Value: ${params.value.toString()}`)

    const result = await account.sendTransaction(params)
    
    console.log(`✅ Transaction sent!`)
    console.log(`   Hash: ${result.hash || result.signature || result.txid}`)

    return result
  }

  /**
   * Send token transfer (TRC-20, ERC-20, SPL tokens)
   * This is the correct method for sending USDT!
   */
  async sendTokenTransfer(
    chain: string,
    params: { token: string; recipient: string; amount: bigint | string },
    index: number = 0
  ): Promise<any> {
    const account = await this.getAccount(chain, index)
    
    console.log(`💸 Sending token transfer on ${chain}...`)
    console.log(`   Token: ${params.token}`)
    console.log(`   To: ${params.recipient}`)
    console.log(`   Amount: ${params.amount.toString()}`)

    // Use the 'transfer' method for token transfers (TRC-20, ERC-20)
    if (typeof account.transfer === 'function') {
      const result = await account.transfer({
        token: params.token,
        recipient: params.recipient,
        amount: params.amount
      })
      
      console.log(`✅ Token transfer sent!`)
      console.log(`   Hash: ${result.hash || result.signature || result.txid}`)
      
      return result
    } else {
      // Fallback for chains that don't have a separate transfer method
      console.log(`⚠️  Chain ${chain} doesn't have a dedicated transfer method, using sendTransaction`)
      return await account.sendTransaction({
        to: params.recipient,
        value: params.amount,
        data: params.token // Some chains encode token in data
      })
    }
  }

  /**
   * Estimate transaction cost
   */
  async estimateTransaction(
    chain: string,
    params: { to: string; value: bigint | string; data?: string },
    index: number = 0
  ): Promise<any> {
    const account = await this.getAccount(chain, index)
    
    try {
      const quote = await account.quoteSendTransaction(params)
      return {
        fee: quote.fee.toString(),
        feeInWei: quote.fee,
        estimatedCost: quote.fee
      }
    } catch (error) {
      console.error(`Error estimating ${chain} transaction:`, error)
      return {
        fee: '0',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Sign message on specific chain
   * Note: WDK wallet accounts use sign() method, not signMessage()
   */
  async signMessage(chain: string, message: string, index: number = 0): Promise<string> {
    const account = await this.getAccount(chain, index)
    
    // WDK wallet accounts use sign() method
    if (typeof account.sign === 'function') {
      return await account.sign(message)
    }
    
    // Fallback for older versions or unsupported chains
    if (typeof account.signMessage === 'function') {
      return await account.signMessage(message)
    }
    
    // Last resort: Create a mock signature (for testing/mock mode)
    const address = await account.getAddress()
    console.log(`⚠️  sign() method not available for ${chain}, using mock signature`)
    return `mock_signature_${address.slice(0, 8)}_${Date.now()}`
  }

  /**
   * Get transaction history (if supported)
   */
  async getTransactionHistory(chain: string, index: number = 0, limit: number = 10): Promise<any[]> {
    const account = await this.getAccount(chain, index)
    
    try {
      if (typeof account.getTransactionHistory === 'function') {
        return await account.getTransactionHistory(limit)
      } else {
        console.log(`⚠️  Transaction history not available for ${chain}`)
        return []
      }
    } catch (error) {
      console.error(`Error getting ${chain} transaction history:`, error)
      return []
    }
  }

  /**
   * Get token balance (for chains that support tokens)
   */
  async getTokenBalance(
    chain: string, 
    tokenAddress: string, 
    index: number = 0
  ): Promise<string> {
    const account = await this.getAccount(chain, index)
    
    try {
      if (typeof account.getTokenBalance === 'function') {
        const balance = await account.getTokenBalance(tokenAddress)
        return balance.toString()
      } else {
        console.log(`⚠️  Token balance not supported for ${chain}`)
        return '0'
      }
    } catch (error) {
      console.error(`Error getting ${chain} token balance:`, error)
      return '0'
    }
  }

  /**
   * Display all wallets
   */
  async displayAllWallets(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════════╗')
    console.log('║              Tether WDK Multi-Chain Wallets                   ║')
    console.log('╚════════════════════════════════════════════════════════════════╝\n')

    const wallets = await this.getAllWallets()

    for (const wallet of wallets) {
      console.log(`🔗 ${wallet.chain.toUpperCase()}`)
      console.log(`   Address: ${wallet.address}`)
      console.log(`   Balance: ${wallet.balance} units`)
      console.log('')
    }
  }
}

/**
 * Create and export singleton instance
 */
let wdkManagerInstance: TetherWDKManager | null = null

export function getTetherWDK(config?: WDKConfig): TetherWDKManager {
  if (!wdkManagerInstance) {
    wdkManagerInstance = new TetherWDKManager(config)
  }
  return wdkManagerInstance
}

export function resetTetherWDK(): void {
  wdkManagerInstance = null
}
