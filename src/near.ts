import { actionCreators, setupWalletSelector, type FinalExecutionOutcome } from '@near-wallet-selector/core'
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet'
import { setupModal } from '@near-wallet-selector/modal-ui'
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet'
import { setupSender } from '@near-wallet-selector/sender'
import { setupNearMobileWallet } from '@near-wallet-selector/near-mobile-wallet'
import '@near-wallet-selector/modal-ui/styles.css'
import { selectRewindNetwork, networkSwitchHref, canUseProtectedTransfers, type RewindNetwork } from './networks'
import { buildProtectedSendTransaction, buildCancelTransaction, buildReleaseTransaction, parseNearAmount } from '../sdk/index'
import { buildMainnetCandidateSendTransaction } from '../sdk/mainnet-candidate'
import type { Transfer } from './types'
import { reserveWalletPopup, closeReservedWalletPopup, type WalletPopup } from './wallet-popup'
import {
  hasBitgetInAppWallet, isBitgetInAppBrowser, getBitgetMobileAccountId, connectBitgetMobile,
  disconnectBitgetMobile, signWithBitgetMobile,
} from './bitget-injected'

export { formatNear } from './amount'

const networkId: RewindNetwork = selectRewindNetwork(
  typeof window !== 'undefined' ? window.location.search : '',
  import.meta.env.VITE_NEAR_NETWORK_ID || 'testnet',
)
// The existing VITE_NEAR_CONTRACT_ID is Testnet ONLY.
// A separate explicit ?network=mainnet&demo=1 opt-in uses the V2 ABI.
const mainnetDemo = networkId === 'mainnet' &&
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1')
const contractId = networkId === 'testnet'
  ? (import.meta.env.VITE_NEAR_CONTRACT_ID || '')
  : (mainnetDemo ? 'afrolite-rewind-261114.near' : '')
// Runtime selection must not reuse a Testnet build-time RPC on Mainnet.
const nodeUrl = networkId === 'mainnet'
  ? 'https://rpc.mainnet.fastnear.com'
  : (import.meta.env.VITE_NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com')
// Use MyNearWallet's real app host. The previous generic near.org wallet URL
// was incompatible with this wallet selector connector.
const walletUrl = networkId === 'mainnet' ? 'https://app.mynearwallet.com' : 'https://testnet.mynearwallet.com'
const helperUrl = networkId === 'mainnet'
  ? 'https://helper.mainnet.near.org'
  : (import.meta.env.VITE_NEAR_HELPER_URL || 'https://helper.testnet.near.org')
const explorerUrl = networkId === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'

const selectorPromise = setupWalletSelector({
  network: { networkId, nodeUrl, helperUrl, explorerUrl, indexerUrl: '' },
  modules: [
    setupMeteorWallet(),
    setupSender(),
    setupNearMobileWallet(),
    setupMyNearWallet({ walletUrl }),
  ],
})

let walletModal: ReturnType<typeof setupModal> | null = null
let selectorCache: Awaited<typeof selectorPromise> | null = null
void selectorPromise.then((selector) => { selectorCache = selector }).catch(() => undefined)

export function getSelectedWalletId(): string {
  return selectorCache?.store.getState().selectedWalletId || ''
}

export function getSelectedWalletName(): string {
  if (getBitgetMobileAccountId(networkId)) return 'Bitget Wallet'
  const selected = getSelectedWalletId()
  if (selected === 'my-near-wallet') return 'MyNearWallet'
  if (selected === 'meteor-wallet') return 'Meteor Wallet'
  if (selected === 'sender') return 'Sender Wallet'
  return selected || 'your connected wallet'
}

/**
 * Reserve a MyNearWallet window while we're still in a direct user gesture.
 * Its connector first awaits a NEAR RPC block before calling window.open;
 * browsers often block that delayed popup unless its named window exists.
 */
export function prepareWalletApproval(): WalletPopup {
  if (getBitgetMobileAccountId(networkId)) return null
  return reserveWalletPopup(getSelectedWalletId())
}

export function finishWalletApproval(popup: WalletPopup): void {
  closeReservedWalletPopup(popup)
}

export async function getAccountId() {
  if (!isProtectedPaymentEnabled()) return ''
  const injectedAccount = getBitgetMobileAccountId(networkId)
  if (injectedAccount) return injectedAccount
  const selector = await selectorPromise
  return selector.store.getState().accounts[0]?.accountId || ''
}

export function getContractId() {
  return contractId
}

export function getNetworkId(): RewindNetwork {
  return networkId
}

export function getNetworkSwitchHref(nextNetwork: RewindNetwork): string {
  return networkSwitchHref(window.location.href, nextNetwork)
}

export function isProtectedPaymentEnabled(): boolean {
  return canUseProtectedTransfers(networkId, contractId, mainnetDemo)
}

export async function connectWallet() {
  assertPaymentsEnabled()
  // Bitget's official wallet-selector adapter intentionally returns null on
  // mobile. Use its documented injected NEAR provider inside Bitget's dApp
  // browser instead of redirecting the user to an unrelated wallet website.
  if (hasBitgetInAppWallet()) {
    await connectBitgetMobile(contractId, networkId)
    return
  }
  if (isBitgetInAppBrowser()) {
    throw new Error('Bitget Wallet did not provide a NEAR account in this browser. Select a NEAR account in Bitget and reload, or open REWIND with a wallet that supports NEAR Testnet. The selected wallet/network is not available in this browser.')
  }
  const selector = await selectorPromise
  // Other wallets still use the official NEAR chooser, including desktop
  // extensions and the NEAR Mobile Wallet connector.
  if (!walletModal) walletModal = setupModal(selector, { contractId })
  walletModal.show()
}

export async function signOut() {
  if (getBitgetMobileAccountId(networkId)) {
    await disconnectBitgetMobile()
  } else {
    const selector = await selectorPromise
    const wallet = await selector.wallet()
    await wallet.signOut()
  }
  window.location.reload()
}

export async function viewTransfer(id: string): Promise<Transfer | null> {
  assertPaymentsEnabled()
  return rpcView<Transfer | null>('get_transfer', { transfer_id: id })
}

export async function viewAccountTransfers(accountId: string): Promise<Transfer[]> {
  if (!contractId || !accountId) return []
  return rpcView<Transfer[]>('get_transfers_for_account', {
    account_id: accountId,
    from_index: '0',
    limit: 20,
  })
}

export async function createTransfer(recipient: string, amountNear: string) {
  assertPaymentsEnabled()
  if (mainnetDemo) {
    const amount = BigInt(parseNearAmount(amountNear))
    if (amount < 10n ** 22n || amount > 10n ** 23n) {
      throw new Error('Hackathon Mainnet demo supports 0.01 to 0.1 NEAR per payment, plus a 0.02 NEAR non-refundable storage fee.')
    }
  }
  const tx = mainnetDemo
    ? buildMainnetCandidateSendTransaction(contractId, recipient, amountNear)
    : buildProtectedSendTransaction(contractId, recipient, amountNear)
  return call(tx.methodName, tx.args, BigInt(tx.deposit), BigInt(tx.gas))
}

export async function cancelTransfer(id: string) {
  assertPaymentsEnabled()
  const tx = buildCancelTransaction(contractId, id)
  return call(tx.methodName, tx.args, BigInt(tx.deposit), BigInt(tx.gas))
}

export async function releaseTransfer(id: string) {
  assertPaymentsEnabled()
  const tx = buildReleaseTransaction(contractId, id)
  return call(tx.methodName, tx.args, BigInt(tx.deposit), BigInt(tx.gas))
}

async function call(methodName: string, args: object, deposit: bigint, gas: bigint): Promise<FinalExecutionOutcome> {
  assertPaymentsEnabled()
  const action = actionCreators.functionCall(methodName, args, gas, deposit)
  if (getBitgetMobileAccountId(networkId)) {
    return signWithBitgetMobile(networkId, contractId, [action])
  }
  const selector = await selectorPromise
  const wallet = await selector.wallet()
  const outcome = await wallet.signAndSendTransaction({
    signerId: await getAccountId(),
    receiverId: contractId,
    actions: [action],
  })
  if (!outcome) throw new Error('Wallet confirmation is still pending. Check the transaction after returning.')
  return outcome
}

async function rpcView<T>(methodName: string, args: object): Promise<T> {
  assertPaymentsEnabled()
  const response = await fetch(nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rewind-view',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: methodName,
        args_base64: bytesToBase64(new TextEncoder().encode(JSON.stringify(args))),
      },
    }),
  })
  const payload = await response.json() as { result?: { result: number[] }; error?: { message?: string } }
  if (!response.ok || payload.error || !payload.result) throw new Error(payload.error?.message || 'NEAR RPC view failed')
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(payload.result.result))) as T
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export function explorerTx(hash: string) {
  return `${explorerUrl}/txns/${hash}`
}

export function explorerAccount(accountId: string) {
  return `${explorerUrl}/address/${encodeURIComponent(accountId)}`
}

function assertPaymentsEnabled() {
  if (!isProtectedPaymentEnabled()) {
    throw new Error('Protected payment actions are only available in Testnet or the explicit small-value Mainnet hackathon demo.')
  }
  if (!contractId) throw new Error('Compatible contract is not configured')
}
