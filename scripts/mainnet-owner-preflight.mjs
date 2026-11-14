/**
 * Public-only Mainnet ownership preflight for REWIND.
 * Checks the user's proposed owner and proposed escrow subaccount via NEAR RPC.
 *
 * No keys or balances are printed. NO account creation, funding, deployment,
 * signing, contract initialization, wallet linking or Mainnet transactions.
 *
 * Public access keys do NOT establish who owns the corresponding private keys;
 * the user must separately authorize a signing challenge from their wallet.
 */
import assert from 'node:assert/strict'

const network = 'mainnet'
const ownerId = process.env.REWIND_OWNER_ACCOUNT_ID || 'afrolite.near'
const escrowId = process.env.REWIND_MAINNET_ESCROW_ACCOUNT_ID || 'escrow.afrolite.near'
const rpc = process.env.NEAR_RPC_URL || 'https://rpc.mainnet.fastnear.com'
const absent = '11111111111111111111111111111111'

assert.match(ownerId, /^[a-z0-9._-]+\.near$/)
assert.match(escrowId, /^[a-z0-9._-]+\.near$/)
assert(escrowId.endsWith('.' + ownerId), 'Contract subaccount must be below the proposed owner')
if (network !== 'mainnet' || !rpc.startsWith('https://')) throw new Error('Invalid Mainnet read-only preflight')

async function query(type, accountId) {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rewind-mainnet-owner-preflight',
      method: 'query',
      params: { request_type: type, finality: 'final', account_id: accountId },
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error('RPC returned HTTP ' + response.status)
  const json = await response.json()
  if (json.error) {
    const cause = json.error?.cause?.name || json.error?.name || json.error?.message || 'RPC_ERROR'
    if (/UNKNOWN_ACCOUNT|does not exist|not found/i.test(String(cause) + ' ' + JSON.stringify(json.error))) {
      return null
    }
    throw new Error('RPC rejected ' + type + ': ' + String(cause))
  }
  if (!json.result) throw new Error('Malformed NEAR RPC result for ' + type)
  return json.result
}

async function inspect() {
  let owner, escrow, keys
  try {
    [owner, escrow, keys] = await Promise.all([
      query('view_account', ownerId),
      query('view_account', escrowId),
      query('view_access_key_list', ownerId),
    ])
  } catch (error) {
    console.error('REWIND_MAINNET_PREFLIGHT=RPC_ERROR ' + String(error))
    process.exitCode = 1
    return
  }
  const results = {
    checked_network: network,
    proposed_owner_id: ownerId,
    owner_account_exists: Boolean(owner),
    owner_has_contract_code: Boolean(owner && owner.code_hash !== absent),
    // Advisory only; reserve/gas/storage and wallet policy are NOT included.
    owner_raw_balance_above_5_1_near: Boolean(owner?.amount && BigInt(owner.amount) >= 51n * 10n ** 23n),
    owner_raw_balance_above_4_1_near: Boolean(owner?.amount && BigInt(owner.amount) >= 41n * 10n ** 23n),
    owner_raw_balance_above_3_6_near: Boolean(owner?.amount && BigInt(owner.amount) >= 36n * 10n ** 23n),
    owner_public_full_access_key_count: Array.isArray(keys?.keys)
      ? keys.keys.filter((entry) => entry.access_key?.permission === 'FullAccess').length
      : null,
    owner_public_function_call_key_count: Array.isArray(keys?.keys)
      ? keys.keys.filter((entry) => typeof entry.access_key?.permission === 'object').length
      : null,
    proposed_escrow_account_id: escrowId,
    escrow_account_exists: Boolean(escrow),
    escrow_code_present: Boolean(escrow && escrow.code_hash !== absent),
    all_checks_read_only: true,
    created_or_deployed_anything: false,
  }

  console.log('REWIND_MAINNET_OWNER_PREFLIGHT=' + JSON.stringify(results))
  const go = results.owner_account_exists &&
    (results.owner_public_full_access_key_count ?? 0) > 0 &&
    !results.escrow_account_exists

  console.log('REWIND_MAINNET_PREFLIGHT_READY_FOR_OWNER_SIGNED_ACCOUNT_CREATION=' + (go ? 'YES' : 'NO'))
  console.log('REWIND_MAINNET_OWNER_RAW_BALANCE_AT_LEAST_5_1_NEAR=' + results.owner_raw_balance_above_5_1_near)
  console.log('REWIND_MAINNET_OWNER_RAW_BALANCE_AT_LEAST_4_1_NEAR=' + results.owner_raw_balance_above_4_1_near)
  console.log('REWIND_MAINNET_OWNER_RAW_BALANCE_AT_LEAST_3_6_NEAR=' + results.owner_raw_balance_above_3_6_near)
  console.log('REWIND_MAINNET_PREFLIGHT_NOT_A_SIGNING_OWNERSHIP_PROOF=TRUE')
  console.log('REWIND_MAINNET_PAYMENTS_ENABLED=FALSE')

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      '## REWIND Mainnet owner preflight (read-only)',
      '',
      '- Owner account: \`' + ownerId + '\`',
      '- Owner exists: **' + results.owner_account_exists + '**',
      '- Owner FullAccess public keys: **' + String(results.owner_public_full_access_key_count) + '**',
      '- Proposed independent escrow account: \`' + escrowId + '\`',
      '- Escrow already exists: **' + results.escrow_account_exists + '**',
      '- Ready for an **owner-authorized** subaccount creation: **' + (go ? 'YES' : 'NO') + '**',
      '',
      '> No keys, funding or contracts were created or deployed. Access keys do not prove the requestor controls them. Security audit and owner wallet confirmation are still required.',
      '',
    ].join('\n'))
  }

  if (!results.owner_account_exists || !Array.isArray(keys?.keys)) process.exitCode = 1
}

await inspect()
