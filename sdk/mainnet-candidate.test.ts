import { describe, expect, it } from 'vitest'
import { buildMainnetCandidateSendTransaction } from './mainnet-candidate'

describe('Mainnet candidate escrow transaction builder', () => {
  it('separates refundable payment from the nonrefundable 0.02 NEAR storage charge', () => {
    const tx = buildMainnetCandidateSendTransaction('rewind.near', 'alice.near', '0.5')
    expect(tx.receiverId).toBe('rewind.near')
    expect(tx.methodName).toBe('create_transfer')
    expect(tx.args).toEqual({
      recipient: 'alice.near',
      transfer_amount: '500000000000000000000000',
    })
    expect(tx.deposit).toBe('520000000000000000000000')
  })

  it('refuses Testnet contract, Testnet recipients, or contract as recipient', () => {
    expect(() => buildMainnetCandidateSendTransaction('rewind.testnet', 'alice.near', '1')).toThrow()
    expect(() => buildMainnetCandidateSendTransaction('rewind.near', 'alice.testnet', '1')).toThrow()
    expect(() => buildMainnetCandidateSendTransaction('rewind.near', 'rewind.near', '1')).toThrow()
  })

  it('enforces Mainnet candidate transfer bounds before wallet approval', () => {
    expect(() => buildMainnetCandidateSendTransaction('rewind.near', 'alice.near', '0.009')).toThrow()
    expect(() => buildMainnetCandidateSendTransaction('rewind.near', 'alice.near', '2.001')).toThrow()
    expect(buildMainnetCandidateSendTransaction('rewind.near', 'alice.near', '2').deposit)
      .toBe('2020000000000000000000000')
  })
})
