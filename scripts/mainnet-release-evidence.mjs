/**
 * REWIND MAINNET RELEASE EVIDENCE (READ ONLY).
 * No private keys, signing, funding, account creation or deployment.
 * Fails if the built artifact differs from the exact WASM that already
 * completed onchain V2 settlement tests on Testnet.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const wasmPath = 'contract-mainnet/target/wasm32-unknown-unknown/release/rewind_escrow_mainnet_candidate.wasm';
const expectedWasmSha256 = '9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333';
const expectedNearCodeHash = 'BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW';
const owner = 'afrolite.near';
const escrow = 'afrolite-rewind-261114.near';
const rpc = 'https://rpc.mainnet.fastnear.com';
const absentCodeHash = '11111111111111111111111111111111';

function b58(bytes) {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let encoded = '';
  while (n > 0n) { encoded = chars[Number(n % 58n)] + encoded; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; encoded = '1' + encoded; }
  return encoded;
}

if (!existsSync(wasmPath)) throw Error('Compiled WASM missing. First build pinned contract-mainnet Cargo.lock');
const wasm = readFileSync(wasmPath);
const digest = createHash('sha256').update(wasm).digest();
const wasmSha = digest.toString('hex');
const codeHash = b58(digest);
if (wasmSha !== expectedWasmSha256 || codeHash !== expectedNearCodeHash) {
  throw Error('The candidate WASM differs from the exact bytecode that completed V2 Testnet onchain tests. Do not deploy.');
}

async function query(request_type, account_id) {
  const response = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'rewind-readonly-release-precheck',
      method: 'query', params: { request_type, account_id, finality: 'final' },
    }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Error('Mainnet RPC HTTP ' + response.status);
  const body = await response.json();
  if (body.error) {
    const cause = JSON.stringify(body.error);
    if (/UNKNOWN_ACCOUNT|does not exist|not found/i.test(cause)) return null;
    throw Error('Unexpected Mainnet RPC error: ' + cause.slice(0, 300));
  }
  return body.result;
}

const [ownerState, escrowState, keys] = await Promise.all([
  query('view_account', owner),
  query('view_account', escrow),
  query('view_access_key_list', owner),
]);
if (!ownerState) throw Error('Proposed owner account does not exist on Mainnet');
if (!Array.isArray(keys?.keys)) throw Error('Could not verify owner public keys');

const release = {
  network: 'mainnet',
  owner_account: owner,
  proposed_escrow_account: escrow,
  owner_exists: true,
  owner_has_full_access_public_key: keys.keys.some(k => k.access_key?.permission === 'FullAccess'),
  escrow_already_exists: Boolean(escrowState),
  escrow_already_contains_code: Boolean(escrowState && escrowState.code_hash !== absentCodeHash),
  candidate_wasm_sha256: wasmSha,
  candidate_near_code_hash: codeHash,
  candidate_wasm_bytes: wasm.length,
  // NEAR Mainnet nominal 10^19 yoctoNEAR/byte; this excludes state,
  // access keys, contract base storage, transaction gas and operating reserve.
  code_storage_lock_near_approx: (wasm.length / 100_000).toFixed(5),
  verified_testnet_contract: 'escrow.rewind-v2-mwgmk1yl-f997426b.testnet',
  verified_testnet_proof: 'https://github.com/Okiki3/Rewind/actions/runs/43616110769',
  independent_security_audit_completed: false,
  user_signed_owner_control_proof_completed: false,
  owner_controlled_escrow_upgrade_keys_verified: false,
  actual_mainnet_deployment_completed: false,
  mainnet_payments_enabled: false,
};

writeFileSync('rewind-mainnet-release-precheck.json', JSON.stringify(release, null, 2) + '\n');
const markdown = [
  '## Rewind Mainnet V2 release evidence (public data only)',
  '',
  '| Evidence | Result |',
  '| --- | --- |',
  '| Owner | \'\`' + owner + '\`\' |',
  '| Owner exists | ' + release.owner_exists + ' |',
  '| Owner FullAccess public key present | ' + release.owner_has_full_access_public_key + ' |',
  '| Escrow subaccount already exists | ' + release.escrow_already_exists + ' |',
  '| Pinned WASM SHA-256 | \'\`' + wasmSha + '\`\' |',
  '| Testnet-verified NEAR code hash | \'\`' + codeHash + '\`\' |',
  '| Independent contract audit | NOT DONE |',
  '| Owner wallet deployment approval | NOT DONE |',
  '| Mainnet real-money escrow | DISABLED |',
  '',
  'Source: https://github.com/Okiki3/Rewind/actions/runs/43616110769',
  '',
  '**NO signing or Mainnet transaction occurred. This precheck does not authorize real deposits.**',
].join('\n').replaceAll("'\`", "`").replaceAll("\`'", "`");
writeFileSync('rewind-mainnet-release-precheck.md', markdown + '\n');
console.log('REWIND_V2_PINNED_WASM_VERIFIED=PASS');
console.log('REWIND_V2_ACTUAL_WASM_BYTES=' + wasm.length);
console.log('REWIND_V2_WASM_ONLY_STORAGE_NEAR_APPROX=' + (wasm.length / 100_000).toFixed(5));
console.log('REWIND_MAINNET_OWNER_EXISTS=' + release.owner_exists);
console.log('REWIND_MAINNET_PUBLIC_FULLACCESS_PRESENT=' + release.owner_has_full_access_public_key);
console.log('REWIND_MAINNET_ESCROW_ACCOUNT_EXISTS=' + release.escrow_already_exists);
console.log('REWIND_MAINNET_SIGNING_OR_DEPLOYMENT=NONE');
console.log('REWIND_MAINNET_GO_LIVE=BLOCKED_INDEPENDENT_AUDIT_AND_OWNER_APPROVAL');
if (!release.owner_has_full_access_public_key) process.exitCode = 1;
