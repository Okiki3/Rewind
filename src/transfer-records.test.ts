import { describe, expect, it } from 'vitest'
import type { Transfer } from './types'
import {
  identifyCreatedPayment, findNewTransfer, recordKey, loadPaymentRecords,
  storePaymentHash, formatPaymentTime,
} from './transfer-records'

const sample: Transfer = {
  id: '8', sender: 'afrotest.testnet', recipient: 'afrolite.testnet',
  amount: '100000000000000000000000', created_at_ms: String(Date.now() - 3_000),
  expires_at_ms: String(Date.now() + 57_000), status: 'Pending', settled_at_ms: null,
}
const hash = '5RN3qgGTjnqJHNwd4PF6mtooYNdTSMDPsq4hDPBhQDXJ'

describe('NEAR transfer receipt and status', () => {
  it('shows a new transfer immediately from onchain SuccessValue when event logs are missing', () => {
    const result = identifyCreatedPayment({
      transaction: { hash },
      status: { SuccessValue: btoa(JSON.stringify(sample)) },
      receipts_outcome: [],
    })
    expect(result).toEqual({ id: '8', transfer: sample, hash })
    expect(result.transfer?.expires_at_ms).toBe(sample.expires_at_ms)
  })
  it('uses TRANSFER_CREATED event logs when wallet omits function return', () => {
    const result = identifyCreatedPayment({
      transaction: { hash }, status: { SuccessValue: '' },
      receipts_outcome: [{ outcome: { logs: ['TRANSFER_CREATED:8'] } }],
    })
    expect(result).toEqual({ id: '8', transfer: null, hash })
  })
  it('does not claim a failed contract execution was confirmed', () => {
    expect(() => identifyCreatedPayment({ status: { Failure: { ActionError: 'rejected' } } })).toThrow(/rejected the payment/)
  })
  it('finds a new payment from onchain history when wallet supplies neither ID source', () => {
    const found = findNewTransfer([sample], new Set(['7']), sample.sender, sample.recipient, sample.amount, Number(sample.created_at_ms) + 1000)
    expect(found?.id).toBe('8')
    expect(findNewTransfer([sample, { ...sample, id: '9' }], new Set(), sample.sender, sample.recipient, sample.amount, Number(sample.created_at_ms) + 1000)).toBe(null)
  })
  it('stores exact transaction hashes only for the matching wallet and network', () => {
    const memory: Record<string, string> = {}
    const storage = { getItem: (k: string) => memory[k] ?? null, setItem: (k: string, v: string) => { memory[k] = v } }
    const key = recordKey('testnet', 'rewind.testnet', 'afrotest.testnet')
    storePaymentHash(storage, key, '8', hash)
    expect(loadPaymentRecords(storage, key)).toEqual({ 8: hash })
    expect(loadPaymentRecords(storage, recordKey('mainnet','rewind.near','afrotest.near'))).toEqual({})
  })
  it('renders actual timestamps, without guessing unsettled times', () => {
    expect(formatPaymentTime(null)).toBe('Not yet completed')
    expect(formatPaymentTime(sample.created_at_ms)).not.toContain('Unavailable')
  })
})
