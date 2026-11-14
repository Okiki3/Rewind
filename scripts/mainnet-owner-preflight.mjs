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
const mobileEscrowId = 'afrolite-rewind-261114.near' // owner created from Meteor phone
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
  // Conservative spendable estimate from public NEAR RPC account state:
  // unlocked amount minus required storage stake not already covered by staked tokens.
  // Still re-check in owner's wallet immediately before signing.
  const byteCost = 10n ** 19n
  const storageLock = BigInt(owner?.storage_usage ?? 0) * byteCost
  const staked = BigInt(owner?.locked ?? '0')
  const effectiveStorageLock = storageLock > staked ? storageLock - staked : 0n
  const amount = BigInt(owner?.amount ?? '0')
  const availableEstimate = amount > effectiveStorageLock ? amount - effectiveStorageLock : 0n
  const buffer = 2n * 10n ** 22n
  const enoughFor4NearPlusGas = availableEstimate >= 4n * 10n ** 24n + buffer
  const [mobileEscrowState, mobileEscrowKeys] = await Promise.all([
    query('view_account', mobileEscrowId),
    query('view_access_key_list', mobileEscrowId),
  ])
  // Confirm whether the owner-funded mobile escrow has enough unlocked NEAR
  // for the code storage stake (~2.20 NEAR), 0.5 NEAR operating reserve
  // and a conservative buffer. Never print the private wallet's balance.
  const walletEscrowStorage = BigInt(mobileEscrowState?.storage_usage ?? 0) * byteCost
  const walletEscrowLocked = BigInt(mobileEscrowState?.locked ?? '0')
  const walletEscrowRequiredStake = walletEscrowStorage > walletEscrowLocked
    ? walletEscrowStorage - walletEscrowLocked : 0n
  const walletEscrowAmount = BigInt(mobileEscrowState?.amount ?? '0')
  const walletEscrowSpendable = walletEscrowAmount > walletEscrowRequiredStake
    ? walletEscrowAmount - walletEscrowRequiredStake : 0n
  const results = {
    checked_network: network,
    mobile_wallet_escrow_spendable_above_3_5_near: walletEscrowSpendable >= 35n * 10n ** 23n,
    mobile_wallet_escrow_spendable_above_3_8_near: walletEscrowSpendable >= 38n * 10n ** 23n,
    mobile_wallet_escrow_raw_balance_at_least_4_near: walletEscrowAmount >= 4n * 10n ** 24n,
    mobile_wallet_escrow_account_id: mobileEscrowId,
    mobile_wallet_escrow_exists: Boolean(mobileEscrowState),
    mobile_wallet_escrow_code_present: Boolean(mobileEscrowState && mobileEscrowState.code_hash !== absent),
    mobile_wallet_escrow_full_access_public_key_count: Array.isArray(mobileEscrowKeys?.keys)
      ? mobileEscrowKeys.keys.filter(x => x.access_key?.permission === 'FullAccess').length : null,
    mobile_wallet_escrow_estimated_spendable_above_4_near: Boolean(mobileEscrowState && (
      BigInt(mobileEscrowState.amount ?? '0') >
        4n * 10n ** 24n +
        (BigInt(mobileEscrowState.storage_usage ?? 0) * 10n ** 19n >
         BigInt(mobileEscrowState.locked ?? '0')
           ? BigInt(mobileEscrowState.storage_usage ?? 0) * 10n ** 19n - BigInt(mobileEscrowState.locked ?? '0')
           : 0n))),

    proposed_owner_id: ownerId,
    owner_account_exists: Boolean(owner),
    owner_has_contract_code: Boolean(owner && owner.code_hash !== absent),
    // Advisory only; reserve/gas/storage and wallet policy are NOT included.
    owner_raw_balance_above_5_1_near: Boolean(owner?.amount && BigInt(owner.amount) >= 51n * 10n ** 23n),
    owner_raw_balance_above_4_1_near: Boolean(owner?.amount && BigInt(owner.amount) >= 41n * 10n ** 23n),
    owner_estimated_spendable_above_4_02_near: enoughFor4NearPlusGas,
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
  console.log('REWIND_MOBILE_ESCROW_FUNDED_AT_LEAST_4_NEAR=' + results.mobile_wallet_escrow_raw_balance_at_least_4_near)
  console.log('REWIND_MOBILE_ESCROW_SPENDABLE_AT_LEAST_3_8_NEAR=' + results.mobile_wallet_escrow_spendable_above_3_8_near)
  console.log('REWIND_MOBILE_ESCROW_SPENDABLE_AT_LEAST_3_5_NEAR=' + results.mobile_wallet_escrow_spendable_above_3_5_near)
  console.log('REWIND_MOBILE_ESCROW_READY_TO_FUND=' +
    (results.mobile_wallet_escrow_exists &&
     results.mobile_wallet_escrow_full_access_public_key_count > 0 &&
     !results.mobile_wallet_escrow_code_present))
  const go = results.owner_account_exists &&
    (results.owner_public_full_access_key_count ?? 0) > 0 &&
    !results.escrow_account_exists

  console.log('REWIND_MAINNET_PREFLIGHT_READY_FOR_OWNER_SIGNED_ACCOUNT_CREATION=' + (go ? 'YES' : 'NO'))
  console.log('REWIND_MAINNET_OWNER_RAW_BALANCE_AT_LEAST_5_1_NEAR=' + results.owner_raw_balance_above_5_1_near)
  console.log('REWIND_MAINNET_OWNER_RAW_BALANCE_AT_LEAST_4_1_NEAR=' + results.owner_raw_balance_above_4_1_near)
  console.log('REWIND_MAINNET_OWNER_ESTIMATED_SPENDABLE_AT_LEAST_4_02_NEAR=' + results.owner_estimated_spendable_above_4_02_near)
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
