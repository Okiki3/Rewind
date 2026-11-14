import { describe, expect, it, vi } from 'vitest'
import { verifyMainnetContract } from './mainnet-attestation'

const hash = '8WFiJRVvrvySGFrsMnf3wxdpMzz4wWL8RkYSxFdW44Q'
const params = { contractId: 'rewind.near', expectedCodeHash: hash }

describe('Mainnet onchain code-hash verification', () => {
  it('allows a verified matching Mainnet contract', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { code_hash: hash } }), { status: 200 })) as unknown as typeof fetch
    await expect(verifyMainnetContract({ ...params, fetcher })).resolves.toBeUndefined()
    const body = JSON.parse((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.params).toEqual({
      request_type: 'view_account', finality: 'final', account_id: 'rewind.near',
    })
  })

  it('refuses mismatched deployed code', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ result: { code_hash: '11111111111111111111111111111111' } }))) as unknown as typeof fetch
    await expect(verifyMainnetContract({ ...params, fetcher })).rejects.toThrow('differs')
  })

  it('refuses missing contracts and missing pin configuration', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'UNKNOWN_ACCOUNT' } }))) as unknown as typeof fetch
    await expect(verifyMainnetContract({ ...params, fetcher })).rejects.toThrow('not found')
    await expect(verifyMainnetContract({ ...params, expectedCodeHash: '', fetcher })).rejects.toThrow('required')
  })
})
