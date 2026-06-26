import QRCode from 'qrcode'
import qrcodeTerminal from 'qrcode-terminal'

export interface OrderQRData {
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
  /**
   * Optional convenience field for UIs. If not provided, it will be computed.
   */
  receiptUrl?: string
}

export interface ReceiptPayloadV1 {
  v: 1
  orderId: string
  customerName?: string
  timestamp: string
  currency?: string
  total?: number
  items: Array<{
    drink: string
    extras?: string[]
  }>
  tx?: {
    hash?: string
    explorerUrl?: string
  }
}

// Callback for UI integration - set by the UI server
let qrCodeCallback: ((data: OrderQRData, imageDataUrl: string) => void) | null = null

/**
 * Set a callback to receive QR codes for UI display
 */
export function setQRCodeCallback(callback: ((data: OrderQRData, imageDataUrl: string) => void) | null): void {
  qrCodeCallback = callback
}

/**
 * Check if QR code generation is enabled via environment variable
 */
function isQRCodeEnabled(): boolean {
  const enabled = process.env.ENABLE_QR_CODE
  if (!enabled) {
    return false // Default to disabled
  }
  return enabled.toLowerCase() === 'true' || enabled === '1'
}

/**
 * Display QR code in terminal (ASCII art)
 */
export function displayQRInTerminal(data: string): void {
  console.log('\n╔════════════════════════════════════════╗')
  console.log('║        📱 ORDER QR CODE 📱              ║')
  console.log('╚════════════════════════════════════════╝\n')
  
  qrcodeTerminal.generate(data, { small: true }, (qrcode) => {
    console.log(qrcode)
  })
  
  console.log('\n✅ Scan with your phone to view order details')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

/**
 * Generate QR code as base64 data URL (for embedding in UI)
 */
export async function generateQRCodeDataURL(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    width: 200,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })
}

/**
 * Generate QR code data from order information
 */
export function encodeReceiptPayload(payload: ReceiptPayloadV1): string {
  const json = JSON.stringify(payload)
  const base64 = Buffer.from(json, 'utf8').toString('base64')
  // base64url (RFC 4648 §5) without padding
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function getReceiptBaseUrl(): string {
  const base = process.env.ORDER_QR_RECEIPT_BASE_URL || 'http://localhost:3470'
  return base.replace(/\/+$/g, '')
}

export function createReceiptPayloadV1(orderData: OrderQRData): ReceiptPayloadV1 {
  return {
    v: 1,
    orderId: orderData.orderId,
    customerName: orderData.customerName,
    timestamp: orderData.timestamp,
    currency: orderData.currency,
    total: orderData.total,
    items: orderData.items,
    ...(orderData.txHash || orderData.txLink
      ? {
          tx: {
            ...(orderData.txHash ? { hash: orderData.txHash } : {}),
            ...(orderData.txLink ? { explorerUrl: orderData.txLink } : {}),
          },
        }
      : {}),
  }
}

export function createOrderQRData(orderData: OrderQRData): { qrContent: string; receiptUrl: string } {
  const payload = createReceiptPayloadV1(orderData)
  const encoded = encodeReceiptPayload(payload)
  const receiptUrl = `${getReceiptBaseUrl()}/#p=${encoded}`
  return { qrContent: receiptUrl, receiptUrl }
}

/**
 * Main function to display order QR code
 * Shows in terminal and sends to UI callback if registered
 * Note: Always generates for UI callback even if ENABLE_QR_CODE is not set
 */
export async function showOrderQRCode(orderData: OrderQRData): Promise<void> {
  const { qrContent, receiptUrl } = createOrderQRData(orderData)
  
  // Display in terminal only if explicitly enabled
  if (isQRCodeEnabled()) {
    displayQRInTerminal(qrContent)
  }
  
  // Always send to UI callback if registered (UI always wants to show QR)
  if (qrCodeCallback) {
    try {
      const imageDataUrl = await generateQRCodeDataURL(qrContent)
      qrCodeCallback({ ...orderData, receiptUrl: orderData.receiptUrl || receiptUrl }, imageDataUrl)
    } catch (error) {
      console.error('Failed to generate QR code for UI:', error)
    }
  } else if (!isQRCodeEnabled()) {
    // Only show the hint if there's no UI callback AND QR is disabled
    console.log('\n💡 QR code generation is disabled (set ENABLE_QR_CODE=true in .env to enable)')
  }
}
