import type { Transfer, TransferStatus } from './types'

/** Transaction outcomes vary between NEAR wallet adapters. */
interface OutcomeLike {
  status?: { SuccessValue?: string; Failure?: unknown } | string
  transaction?: { hash?: string }
  receipts_outcome?: Array<{ outcome?: { logs?: string[] } }>
  transaction_outcome?: { outcome?: { logs?: string[] } }
}

export interface CreatedPayment {
  id: string | null
  transfer: Transfer | null
  hash: string | null
}

const statuses: readonly TransferStatus[] = [
  'Pending', 'Refunding', 'RefundFailed', 'Releasing', 'DeliveryFailed', 'Cancelled', 'Released',
]

const isDigits = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v)

function asTransfer(value: unknown): Transfer | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isDigits(v.id) || !isDigits(v.amount) || !isDigits(v.created_at_ms) ||
      !isDigits(v.expires_at_ms) || typeof v.sender !== 'string' ||
      typeof v.recipient !== 'string' || !statuses.includes(v.status as TransferStatus) ||
      (v.settled_at_ms !== null && !isDigits(v.settled_at_ms))) {
    return null
  }
  return value as Transfer
}

/**
 * A NEAR #[payable] create_transfer returns a JSON Transfer in SuccessValue.
 * Prefer that authoritative onchain return so the countdown starts immediately.
 * Also parse receipts/logs for connectors that omit or change return values.
 */
export function identifyCreatedPayment(outcome: OutcomeLike): CreatedPayment {
  if (outcome.status && typeof outcome.status === 'object' && 'Failure' in outcome.status) {
    throw new Error('The NEAR contract rejected the payment. Check the transaction on the explorer.')
  }
  const hash = typeof outcome.transaction?.hash === 'string' ? outcome.transaction.hash : null
  const status = outcome.status
  if (status && typeof status === 'object' && typeof status.SuccessValue === 'string' &&
      status.SuccessValue.length) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(status.SuccessValue), (c) => c.charCodeAt(0)))
      const transfer = asTransfer(JSON.parse(decoded))
      if (transfer) return { id: transfer.id, transfer, hash }
    } catch {
      // Fall back to logs (wallet connectors are not guaranteed to expose the return).
    }
  }

  const receiptLogs = (outcome.receipts_outcome || []).flatMap((r) => r.outcome?.logs || [])
  const txLogs = outcome.transaction_outcome?.outcome?.logs || []
  const event = [...receiptLogs, ...txLogs].find((log) => /^TRANSFER_CREATED:\d+$/.test(log))
  const id = event?.split(':')[1] || null
  return { id, transfer: null, hash }
}

/** A wallet might not return logs or SuccessValue. Match to a unique new chain record. */
export function findNewTransfer(
  latest: Transfer[],
  knownIds: ReadonlySet<string>,
  sender: string,
  recipient: string,
  amountYocto: string,
  submittedAtMs: number,
): Transfer | null {
  const candidates = latest.filter((item) => (
    !knownIds.has(item.id) &&
    item.sender === sender &&
    item.recipient === recipient &&
    item.amount === amountYocto &&
    Number(item.created_at_ms) >= submittedAtMs - 120_000 &&
    Number(item.created_at_ms) <= Date.now() + 30_000
  ))
  return candidates.length === 1 ? candidates[0] : null
}

export function recordKey(network: string, contract: string, account: string): string {
  return ['rewind', 'payments', network, contract, account].join(':')
}

export function loadPaymentRecords(storage: Pick<Storage, 'getItem'>, key: string): Record<string, string> {
  try {
    const raw = JSON.parse(storage.getItem(key) || '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const records: Record<string, string> = {}
    for (const [id, hash] of Object.entries(raw)) {
      if (/^\d+$/.test(id) && typeof hash === 'string' && /^[1-9A-HJ-NP-Za-km-z]{30,64}$/.test(hash)) {
        records[id] = hash
      }
    }
    return records
  } catch {
    return {}
  }
}

export function storePaymentHash(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  id: string,
  hash: string,
): Record<string, string> {
  const existing = loadPaymentRecords(storage, key)
  if (!/^\d+$/.test(id) || !/^[1-9A-HJ-NP-Za-km-z]{30,64}$/.test(hash)) return existing
  const limited = Object.fromEntries([...Object.entries(existing), [id, hash]].slice(-100))
  try { storage.setItem(key, JSON.stringify(limited)) } catch { /* private browsing may block storage */ }
  return limited
}

export function formatPaymentTime(milliseconds: string | null): string {
  if (!milliseconds || !/^\d+$/.test(milliseconds)) return 'Not yet completed'
  const date = new Date(Number(milliseconds))
  if (!Number.isFinite(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}
