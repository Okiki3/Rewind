import { describe, expect, it } from 'vitest'
import type { Transfer } from './types'
import { matchHistoricalHash, findHistoricalHashes } from './explorer-history'

const transfer: Transfer = {
  id:'8', sender:'afrotest.testnet', recipient:'afrolite.testnet',
  amount:'100000000000000000000000',
  created_at_ms:'1794616003500', expires_at_ms:'1794616063500',
  status:'Released', settled_at_ms:'1794616070000',
}
const hash='5oM4WKDVRMRKEQwMeHVPBY21tW41Ev6AWLmnMxh5Cnaa'
const tx={
  transaction_hash:hash, signer_account_id:'afrotest.testnet',
  receiver_account_id:'rewind.testnet',
  block_timestamp:'1794616002637472040',
  actions:[{action:'FUNCTION_CALL',method:'create_transfer'}],
  actions_agg:{deposit:transfer.amount},
  outcomes:{status:true},
}
describe('historic transaction hash lookup', () => {
  it('matches the actual sender, contract, amount and receipt timestamp', () => {
    expect(matchHistoricalHash(transfer,[tx],'rewind.testnet')).toBe(hash)
  })
  it('never guesses among ambiguous identical transfers', () => {
    const another={...tx,transaction_hash:'9'.repeat(44)}
    expect(matchHistoricalHash(transfer,[tx,another],'rewind.testnet')).toBe(null)
  })
  it('ignores unrelated, failed and wrong-amount transactions', () => {
    expect(matchHistoricalHash(transfer,[{...tx,receiver_account_id:'other.testnet'}],'rewind.testnet')).toBe(null)
    expect(matchHistoricalHash(transfer,[{...tx,outcomes:{status:false}}],'rewind.testnet')).toBe(null)
    expect(matchHistoricalHash(transfer,[{...tx,actions_agg:{deposit:'1'}}],'rewind.testnet')).toBe(null)
  })
  it('fetches NEARBlocks v3 history without relying on private localStorage', async () => {
    const requested:string[]=[]
    const fetcher=async (url: string | URL | Request) => {
      requested.push(String(url))
      return {ok:true,json:async()=>({data:[tx]})} as Response
    }
    const hashes=await findHistoricalHashes('afrotest.testnet',[transfer],'rewind.testnet','testnet',fetcher as typeof fetch)
    expect(requested[0]).toContain('/v3/accounts/afrotest.testnet/txns?limit=50')
    expect(hashes).toEqual({'8':hash})
  })
})
