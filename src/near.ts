import { actionCreators, setupWalletSelector, type FinalExecutionOutcome, type InjectedWallet } from '@near-wallet-selector/core'
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet'
import { parseNear } from './amount'
import type { Transfer } from './types'

export { formatNear } from './amount'

const networkId = import.meta.env.VITE_NEAR_NETWORK_ID || 'testnet'
const contractId = import.meta.env.VITE_NEAR_CONTRACT_ID || ''
const nodeUrl = import.meta.env.VITE_NEAR_NODE_URL || `https://rpc.${networkId}.near.org`
const walletUrl = import.meta.env.VITE_NEAR_WALLET_URL || `https://wallet.${networkId}.near.org`
const helperUrl = import.meta.env.VITE_NEAR_HELPER_URL || `https://helper.${networkId}.near.org`
const explorerUrl = networkId === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'

const selectorPromise = setupWalletSelector({
  network: { networkId, nodeUrl, helperUrl, explorerUrl, indexerUrl: '' },
  modules: [setupMyNearWallet({ walletUrl })],
})

export async function getAccountId() {
  const selector = await selectorPromise
  return selector.store.getState().accounts[0]?.accountId || ''
}

export function getContractId() {
  return contractId
}

export function getNetworkId() {
  return networkId
}

export async function connectWallet() {
  assertConfigured()
  const selector = await selectorPromise
  const wallet = await selector.wallet<InjectedWallet>('my-near-wallet')
  await wallet.signIn({ contractId })
}

export async function signOut() {
  const selector = await selectorPromise
  const wallet = await selector.wallet()
  await wallet.signOut()
  window.location.reload()
}

export async function viewTransfer(id: string): Promise<Transfer | null> {
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

export async function createTransfer(recipient: string, amountNear: string, expiresAtMs: number) {
  return call('create_transfer', { recipient, expires_at_ms: String(expiresAtMs) }, parseNear(amountNear), BigInt('30000000000000'))
}

export async function cancelTransfer(id: string) {
  return call('cancel', { transfer_id: id }, 0n, BigInt('50000000000000'))
}

export async function releaseTransfer(id: string) {
  return call('release', { transfer_id: id }, 0n, BigInt('50000000000000'))
}

async function call(methodName: string, args: object, deposit: bigint, gas: bigint): Promise<FinalExecutionOutcome> {
  assertConfigured()
  const selector = await selectorPromise
  const wallet = await selector.wallet()
  const outcome = await wallet.signAndSendTransaction({
    signerId: await getAccountId(),
    receiverId: contractId,
    actions: [actionCreators.functionCall(methodName, args, gas, deposit)],
  })
  if (!outcome) throw new Error('Wallet confirmation is still pending. Check the transaction after returning.')
  return outcome
}

async function rpcView<T>(methodName: string, args: object): Promise<T> {
  assertConfigured()
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

function assertConfigured() {
  if (!contractId) throw new Error('VITE_NEAR_CONTRACT_ID is not configured')
}
