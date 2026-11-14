import { NearConnector, type ConnectorAction } from '@hot-labs/near-connect'
import type { FinalExecutionOutcome } from './near-types'
import { selectRewindNetwork, networkSwitchHref, canUseProtectedTransfers, type RewindNetwork } from './networks'
import { buildProtectedSendTransaction, buildCancelTransaction, buildReleaseTransaction } from '../sdk/index'
import { buildMainnetCandidateSendTransaction } from '../sdk/mainnet-candidate'
import { verifyMainnetContract } from './mainnet-attestation'
import type { Transfer } from './types'
import type { WalletPopup } from './wallet-popup'
import {
  hasBitgetInAppWallet, isBitgetInAppBrowser, getBitgetMobileAccountId, connectBitgetMobile,
  disconnectBitgetMobile, signWithBitgetMobile,
} from './bitget-injected'

export { formatNear } from './amount'

const networkId: RewindNetwork = selectRewindNetwork(
  typeof window !== 'undefined' ? window.location.search : '',
  import.meta.env.VITE_NEAR_NETWORK_ID || 'testnet',
)
// Keep Testnet and Mainnet account IDs and signed transactions isolated.
// Mainnet is disabled unless a separately vetted deployment is configured.
const contractId = networkId === 'testnet'
  ? (import.meta.env.VITE_NEAR_CONTRACT_ID || '')
  : (import.meta.env.VITE_NEAR_MAINNET_CONTRACT_ID || '')
const mainnetExpectedCodeHash = import.meta.env.VITE_MAINNET_EXPECTED_CODE_HASH || ''
const mainnetReleaseApproved = import.meta.env.VITE_ENABLE_MAINNET_PAYMENTS === 'true'
// Runtime selection must not reuse a Testnet build-time RPC on Mainnet.
const nodeUrl = networkId === 'mainnet'
  ? 'https://rpc.mainnet.fastnear.com'
  : (import.meta.env.VITE_NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com')
// Use MyNearWallet's real app host. The previous generic near.org wallet URL
// was incompatible with this wallet selector connector.
const explorerUrl = networkId === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'

// NEAR Foundation recommends the sandboxed near-connect wallet connector.
// Wallet executors are isolated from the dApp; injected Bitget uses a separate
// direct path so its in-app browser does not redirect to a web login.
const connector = new NearConnector({
  network: networkId,
  features: { signAndSendTransaction: true },
  footerBranding: null,
})
let selectedWalletId = ''
let selectedWalletName = ''
connector.on('wallet:signIn', ({ wallet }) => {
  selectedWalletId = wallet.manifest.id
  selectedWalletName = wallet.manifest.name
})
connector.on('wallet:signOut', () => {
  selectedWalletId = ''
  selectedWalletName = ''
})

export function getSelectedWalletId(): string {
  return selectedWalletId
}

export function getSelectedWalletName(): string {
  if (getBitgetMobileAccountId(networkId)) return 'Bitget Wallet'
  return selectedWalletName || 'your connected wallet'
}

/** Near Connect manages its own popup during an explicit wallet gesture. */
export function prepareWalletApproval(): WalletPopup { return null }
export function finishWalletApproval(_popup: WalletPopup): void { /* managed by connector */ }

export async function getAccountId() {
  if (!isProtectedPaymentEnabled()) return ''
  const injectedAccount = getBitgetMobileAccountId(networkId)
  if (injectedAccount) return injectedAccount
  try {
    const { wallet, accounts } = await connector.getConnectedWallet()
    selectedWalletId = wallet.manifest.id
    selectedWalletName = wallet.manifest.name
    return accounts[0]?.accountId || ''
  } catch {
    return ''
  }
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
  return canUseProtectedTransfers(
    networkId, contractId, mainnetReleaseApproved, mainnetExpectedCodeHash,
  )
}

async function assertLiveMainnetContract(): Promise<void> {
  if (networkId === 'mainnet') {
    await verifyMainnetContract({
      contractId, expectedCodeHash: mainnetExpectedCodeHash, rpcUrl: nodeUrl,
    })
  }
}

export async function connectWallet() {
  assertPaymentsEnabled()
  await assertLiveMainnetContract()
  // Bitget's official wallet-selector adapter intentionally returns null on
  // mobile. Use its documented injected NEAR provider inside Bitget's dApp
  // browser instead of redirecting the user to an unrelated wallet website.
  if (hasBitgetInAppWallet()) {
    await connectBitgetMobile(contractId, networkId)
    return
  }
  if (isBitgetInAppBrowser()) {
    throw new Error(
      'Bitget Wallet did not provide a NEAR account in this browser. Select a compatible NEAR ' +
      (networkId === 'mainnet' ? 'Mainnet' : 'Testnet') +
      ' account in Bitget, then reload.'
    )
  }
  // Open the modern NEAR wallet chooser. Never request a signing key on connect;
  // payable function calls continue to require the wallet's own approval.
  const wallet = await connector.connect()
  selectedWalletId = wallet.manifest.id
  selectedWalletName = wallet.manifest.name
}

export async function signOut() {
  if (getBitgetMobileAccountId(networkId)) {
    await disconnectBitgetMobile()
  } else {
    await connector.disconnect()
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
  const tx = networkId === 'mainnet'
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
  // Re-verify before each signed transaction; a stale browser tab must not
  // sign through a changed Mainnet deployment.
  await assertLiveMainnetContract()
  const action: ConnectorAction = {
    type: 'FunctionCall',
    params: {
      methodName, args, gas: gas.toString(), deposit: deposit.toString(),
    },
  }
  if (getBitgetMobileAccountId(networkId)) {
    return signWithBitgetMobile(networkId, contractId, [action])
  }
  const wallet = await connector.wallet()
  const outcome = await wallet.signAndSendTransaction({
    network: networkId,
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
    throw new Error('Mainnet payments are not enabled. A verified Mainnet escrow contract, approved code hash and production release approval are required. Select Testnet to try protected transfers.')
  }
  if (!contractId) throw new Error('Compatible Testnet contract is not configured')
}
