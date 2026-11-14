import assert from 'node:assert/strict'

// Read-only onchain health check. Never signs or sends any transfer.
const rpcUrl = 'https://rpc.testnet.fastnear.com'
const contractId = 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet'
async function rpc(params) {
  const res = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'https://afrolitehub.com' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'rewind-health', method: 'query', params }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json()
  if (!res.ok || data.error || !data.result) throw new Error('RPC error: '+ JSON.stringify(data.error || data).slice(0,500))
  return { result: data.result, cors: res.headers.get('access-control-allow-origin') }
}
async function view(method_name, args) {
  const { result } = await rpc({
    request_type: 'call_function', finality: 'final', account_id: contractId,
    method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  })
  return JSON.parse(Buffer.from(result.result).toString('utf8'))
}

const recipient = await rpc({ request_type: 'view_account', finality: 'final', account_id: 'afrolite.testnet' })
assert.equal(typeof recipient.result.code_hash, 'string', 'Correct recipient must exist onchain')
console.log('REAL_RECIPIENT_VERIFIED=afrolite.testnet')
console.log('CORS_ALLOW_ORIGIN='+recipient.cors)
const four = await view('get_transfer', { transfer_id: '4' })
assert.equal(four?.recipient, 'afrolite.testnet')
assert.equal(four?.sender, 'afrotest.testnet')
console.log('TRANSFER_4='+JSON.stringify({ id:four.id, recipient:four.recipient, amount:four.amount, status:four.status }))
const recent = await view('get_transfers_for_account', {
  account_id:'afrotest.testnet', from_index:'0', limit:20,
})
console.log('RECENT_SENDER_TRANSFERS='+JSON.stringify(recent.map(t=>({id:t.id,recipient:t.recipient,amount:t.amount,status:t.status}))))
console.log('RPC_HEALTH_PASS')
