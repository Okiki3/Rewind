import type { Transfer } from './types'

interface ExplorerTransaction {
  transaction_hash?: string
  signer_account_id?: string
  receiver_account_id?: string
  block_timestamp?: string
  block?: { block_timestamp?: string }
  actions?: Array<{ action?: string; method?: string }>
  actions_agg?: { deposit?: string }
  outcomes?: { status?: boolean }
}
interface ExplorerResponse { data?: ExplorerTransaction[] }

/** Recover older transaction hashes from public NEARBlocks v3 history.
 * Never guess if multiple onchain transactions could match a payment. */
export function matchHistoricalHash(
  transfer: Transfer,
  transactions: ExplorerTransaction[],
  contractId: string,
): string | null {
  const matches = transactions.filter((tx) => {
    if (tx.signer_account_id !== transfer.sender || tx.receiver_account_id !== contractId) return false
    if (!tx.actions?.some((action) => action.action === 'FUNCTION_CALL' && action.method === 'create_transfer')) return false
    if (tx.actions_agg?.deposit !== transfer.amount || tx.outcomes?.status !== true) return false
    if (typeof tx.transaction_hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{30,64}$/.test(tx.transaction_hash)) return false
    const ns = tx.block_timestamp || tx.block?.block_timestamp
    if (!ns || !/^\d+$/.test(ns)) return false
    const transactionMs = Number(BigInt(ns) / 1_000_000n)
    const contractMs = Number(transfer.created_at_ms)
    return Math.abs(transactionMs - contractMs) <= 20_000
  })
  return matches.length === 1 ? matches[0].transaction_hash! : null
}

export async function findHistoricalHashes(
  sender: string,
  transfers: Transfer[],
  contractId: string,
  network: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, string>> {
  if (!sender || !transfers.length) return {}
  const host = network === 'testnet' ? 'https://api-testnet.nearblocks.io' : 'https://api.nearblocks.io'
  const url = host + '/v3/accounts/' + encodeURIComponent(sender) + '/txns?limit=50'
  const response = await fetcher(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(7_000),
  })
  if (!response.ok) throw new Error('Explorer history unavailable')
  const data = await response.json() as ExplorerResponse
  if (!Array.isArray(data.data)) throw new Error('Unexpected explorer response')
  const matches: Record<string, string> = {}
  for (const transfer of transfers) {
    if (transfer.sender !== sender) continue
    const hash = matchHistoricalHash(transfer, data.data, contractId)
    if (hash) matches[transfer.id] = hash
  }
  return matches
}
