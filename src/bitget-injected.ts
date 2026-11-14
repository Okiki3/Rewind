import type { ConnectorAction } from '@hot-labs/near-connect'
import type { FinalExecutionOutcome } from './near-types'

type BitgetError = string | { type?: string; message?: string }

interface BitgetNearProvider {
  isSignedIn(): boolean
  getAccountId(): string
  requestSignIn(args: { contractId: string; methodNames: string[] }): Promise<{ accessKey?: unknown; error?: BitgetError }>
  signOut(): Promise<unknown>
  signAndSendTransaction(args: {
    receiverId: string
    actions: ConnectorAction[]
  }): Promise<{ response?: FinalExecutionOutcome[]; error?: BitgetError }>
}

function provider(): BitgetNearProvider | null {
  if (typeof window === 'undefined') return null
  const injected = (window as Window & { bitkeep?: { near?: Partial<BitgetNearProvider> } }).bitkeep?.near
  if (!injected || typeof injected.isSignedIn !== 'function' ||
    typeof injected.getAccountId !== 'function' ||
    typeof injected.requestSignIn !== 'function' ||
    typeof injected.signAndSendTransaction !== 'function' ||
    typeof injected.signOut !== 'function') return null
  return injected as BitgetNearProvider
}

export function isMobileWalletBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isBitgetInAppBrowser(): boolean {
  if (!isMobileWalletBrowser()) return false
  const host = window as Window & { bitkeep?: unknown }
  return Boolean(host.bitkeep) || /bitget|bitkeep/i.test(navigator.userAgent)
}

export function hasBitgetInAppWallet(): boolean {
  return isMobileWalletBrowser() && provider() !== null
}

function formatProviderError(value: BitgetError | undefined): string {
  return typeof value === 'string' ? value : value?.message || value?.type || 'Wallet request declined'
}

function checkNetwork(accountId: string, networkId: string): void {
  if (networkId === 'testnet' && accountId.endsWith('.near')) {
    throw new Error('Your Bitget Wallet is using a NEAR Mainnet account. REWIND is currently a Testnet demo. Switch to a NEAR Testnet account in your wallet, or use a wallet that supports NEAR Testnet.')
  }
  if (networkId === 'mainnet' && accountId.endsWith('.testnet')) {
    throw new Error('This Bitget Wallet account belongs to Testnet, not Mainnet.')
  }
}

export function getBitgetMobileAccountId(networkId: string): string {
  if (!hasBitgetInAppWallet()) return ''
  const injected = provider()!
  try {
    if (!injected.isSignedIn()) return ''
    const id = injected.getAccountId()
    if (!id || typeof id !== 'string') return ''
    checkNetwork(id, networkId)
    return id
  } catch {
    return ''
  }
}

export async function connectBitgetMobile(contractId: string, networkId: string): Promise<string> {
  const injected = provider()
  if (!hasBitgetInAppWallet() || !injected) throw new Error('Bitget NEAR wallet is unavailable in this browser')
  if (!injected.isSignedIn() || !injected.getAccountId()) {
    const result = await injected.requestSignIn({ contractId, methodNames: [] })
    if (result?.error) throw new Error(formatProviderError(result.error))
  }
  const id = injected.getAccountId()
  if (!id || !injected.isSignedIn()) throw new Error('Bitget did not complete the NEAR wallet connection. Check that your wallet has a NEAR account selected.')
  checkNetwork(id, networkId)
  return id
}

export async function signWithBitgetMobile(
  networkId: string,
  receiverId: string,
  actions: ConnectorAction[],
): Promise<FinalExecutionOutcome> {
  const injected = provider()
  if (!hasBitgetInAppWallet() || !injected) throw new Error('Bitget NEAR wallet is no longer available')
  const id = getBitgetMobileAccountId(networkId)
  if (!id) throw new Error('Bitget Wallet is not connected to the correct NEAR network')
  // Near Connect uses the same FunctionCall action shape expected by the
  // injected Bitget NEAR wallet. Only the wallet can sign.
  const result = await injected.signAndSendTransaction({
    receiverId,
    actions,
  })
  if (result?.error) throw new Error(formatProviderError(result.error))
  const outcome = result?.response?.[0]
  if (!outcome) throw new Error('Bitget did not return a confirmed NEAR transaction. Check wallet activity before retrying.')
  return outcome
}

export async function disconnectBitgetMobile(): Promise<void> {
  const injected = provider()
  if (injected && hasBitgetInAppWallet()) await injected.signOut()
}
