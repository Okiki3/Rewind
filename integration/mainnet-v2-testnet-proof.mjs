/**
 * REWIND V2: fresh, real-chain Testnet proof for the exact isolated Mainnet
 * candidate WASM and V2 ABI. This script cannot interact with Mainnet.
 *
 * The disposable private key exists only in GitHub Actions process memory.
 * Never print it, commit it, upload it or re-use these temporary accounts.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nearAPI from 'near-api-js';
import { scanMainnetDueTransfers } from '../keeper/scan-mainnet.mjs';

const { connect, keyStores, KeyPair } = nearAPI;
const networkId = 'testnet';
const runId = Date.now().toString(36) + '-' + randomBytes(4).toString('hex');
const rootId = 'rewind-v2-' + runId + '.testnet';
const contractId = 'escrow.' + rootId;
const recipientId = 'receiver.' + rootId;
const missingRecipient = 'absent.' + rootId;
const contractWasm = 'contract-mainnet/target/wasm32-unknown-unknown/release/rewind_escrow_mainnet_candidate.wasm';
const wasm = readFileSync(contractWasm);
const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
const rootKey = KeyPair.fromRandom('ed25519');
const testnetRpc = 'https://rpc.testnet.fastnear.com';
const endpointList = ['https://helper.testnet.near.org/account', 'https://helper.nearprotocol.com/account'];
const amount = 10n ** 23n; // protected principal = 0.1 Testnet NEAR
const storageFee = 2n * 10n ** 22n; // 0.02 Testnet NEAR (NON-REFUNDABLE)
const tgas = 70_000_000_000_000n;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const oneNear = 10n ** 24n;

function base58FromSha256(bytes) {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let encoded = '';
  while (n > 0n) { encoded = chars[Number(n % 58n)] + encoded; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; encoded = '1' + encoded; }
  return encoded;
}

async function createFaucetAccount() {
  const payload = JSON.stringify({
    newAccountId: rootId,
    newAccountPublicKey: rootKey.getPublicKey().toString(),
  });
  const errors = [];
  for (const url of endpointList) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: payload, signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) return;
      errors.push(url + ' HTTP ' + res.status + ': ' + (await res.text()).slice(0, 120));
    } catch (err) {
      errors.push(url + ' ' + String(err));
    }
  }
  throw Error('No Testnet faucet available: ' + errors.join('; '));
}

async function recordSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

async function waitForFinalStatus(view, transferId, expected, timeoutMs = 45_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await view('get_transfer', { transfer_id: String(transferId) });
    if (last?.status === expected) return last;
    if (!['Pending', 'Refunding', 'Releasing', 'DeliveryFailed', 'RefundFailed'].includes(last?.status)) {
      throw Error('Unexpected terminal status for ' + transferId + ': ' + String(last?.status));
    }
    await sleep(1_500);
  }
  throw Error('Timed out waiting for onchain callback ' + transferId +
    ' to become ' + expected + ' (last=' + String(last?.status) + ')');
}

async function main() {
  assert(rootId.endsWith('.testnet') && contractId.endsWith('.testnet'));
  console.log('REWIND_V2_DEPLOYMENT_TEST=START; Testnet only; ephemeral keys');
  await createFaucetAccount();

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, rootId, rootKey);
  const near = await connect({ networkId, nodeUrl: testnetRpc, keyStore });
  const sender = await near.account(rootId);

  let funded = false;
  for (let n = 0; n < 30; n++) {
    try { await sender.state(); funded = true; break; } catch { await sleep(1_000); }
  }
  if (!funded) throw Error('Faucet account not yet visible onchain');

  // The faucet provides 10 test tokens. Contract gets independent operating
  // reserve; the receiver is funded separately. No Mainnet account is used.
  await sender.createAccount(contractId, rootKey.getPublicKey(), 5n * oneNear);
  await sender.createAccount(recipientId, rootKey.getPublicKey(), oneNear);
  await keyStore.setKey(networkId, contractId, rootKey);
  await keyStore.setKey(networkId, recipientId, rootKey);
  const contract = await near.account(contractId);
  const recipient = await near.account(recipientId);

  await contract.deployContract(wasm);
  await contract.functionCall({
    contractId, methodName: 'new', args: { owner_id: contractId },
    gas: tgas, attachedDeposit: 0n,
  });
  const state = await contract.state();
  const codeHash = base58FromSha256(createHash('sha256').update(wasm).digest());
  assert.equal(state.code_hash, codeHash, 'Deployed Testnet code hash must exactly match locally built WASM');
  const view = (methodName, args = {}) =>
    sender.viewFunction({ contractId, methodName, args });
  const send = (methodName, args, deposit = 0n) =>
    sender.functionCall({ contractId, methodName, args, gas: tgas, attachedDeposit: deposit });

  assert.equal(await view('get_storage_fee'), storageFee.toString());
  assert.equal(await view('get_min_payment'), (oneNear / 100n).toString());
  assert.equal(await view('get_max_payment'), (2n * oneNear).toString());
  assert.equal(await view('get_total_reserved'), '0');
  assert.equal(await view('is_paused'), true, 'New Mainnet candidate must block deposits by default');
  await assert.rejects(() => send('create_transfer', {
    recipient: recipientId, transfer_amount: amount.toString(),
  }, amount + storageFee), 'Unaudited, newly deployed escrow must reject deposits');
  console.log('REWIND_V2_DEFAULT_PAUSED_ON_REAL_CHAIN=PASS');
  await contract.functionCall({
    contractId, methodName: 'set_paused', args: { paused: false },
    gas: tgas, attachedDeposit: 0n,
  });
  assert.equal(await view('is_paused'), false, 'Only test's contract owner enables Testnet payments');
  console.log('REWIND_V2_CONTRACT=' + contractId);
  console.log('REWIND_V2_CODE_HASH=' + codeHash);
  console.log('REWIND_V2_WASM_SHA256=' + wasmSha256);
  console.log('REWIND_V2_DEPLOYED_CODE_VERIFIED=PASS');

  // The new ABI rejects omission of the explicitly disclosed storage fee.
  await assert.rejects(() => send('create_transfer',
    { recipient: recipientId, transfer_amount: amount.toString() }, amount));
  await assert.rejects(() => send('create_transfer',
    { recipient: recipientId, transfer_amount: (3n * oneNear).toString() },
    3n * oneNear + storageFee));
  assert.equal(await view('get_transfer_count'), '0');
  console.log('REWIND_V2_FEE_AND_PAYMENT_CAP_ONCHAIN=PASS');

  // Real signed payment 0: sender can cancel; all refunds are onchain.
  const create0 = await send('create_transfer', {
    recipient: recipientId, transfer_amount: amount.toString(),
  }, amount + storageFee);
  const t0 = await view('get_transfer', { transfer_id: '0' });
  assert.equal(t0.status, 'Pending');
  assert.equal(t0.amount, amount.toString());
  assert.equal(BigInt(t0.expires_at_ms) - BigInt(t0.created_at_ms), 60_000n);
  await assert.rejects(() => recipient.functionCall({
    contractId, methodName: 'cancel', args: { transfer_id: '0' },
    gas: tgas, attachedDeposit: 0n,
  }), 'Recipient cannot cancel sender-owned funds');
  await assert.rejects(() => recipient.functionCall({
    contractId, methodName: 'release', args: { transfer_id: '0' },
    gas: tgas, attachedDeposit: 0n,
  }), 'Permissionless release cannot settle early');
  const cancel0 = await send('cancel', { transfer_id: '0' });
  await waitForFinalStatus(view, '0', 'Cancelled');
  assert.equal(await view('get_total_reserved'), '0');
  console.log('REWIND_V2_REAL_REFUND=PASS; tx=' + cancel0.transaction.hash);

  // Real payment 1: expiry and delivery triggered by the keeper scanner.
  // Real payment 2: intentionally missing recipient demonstrates refund
  // recovery after a failed outbound payout.
  const create1 = await send('create_transfer', {
    recipient: recipientId, transfer_amount: amount.toString(),
  }, amount + storageFee);
  const create2 = await send('create_transfer', {
    recipient: missingRecipient, transfer_amount: amount.toString(),
  }, amount + storageFee);
  const t1 = await view('get_transfer', { transfer_id: '1' });
  const t2 = await view('get_transfer', { transfer_id: '2' });
  assert.equal(t1.status, 'Pending');
  assert.equal(t2.status, 'Pending');
  assert.equal(await view('get_total_reserved'), (2n * amount).toString());

  await contract.functionCall({
    contractId, methodName: 'set_paused', args: { paused: true },
    gas: tgas, attachedDeposit: 0n,
  });
  assert.equal(await view('is_paused'), true);
  await assert.rejects(() => send('create_transfer', {
    recipient: recipientId, transfer_amount: amount.toString(),
  }, amount + storageFee));
  console.log('REWIND_V2_OWNER_PAUSE_ONCHAIN=PASS');

  const deadline = Math.max(Number(t1.expires_at_ms), Number(t2.expires_at_ms));
  if (deadline > Date.now()) await sleep(deadline - Date.now() + 2_000);

  // No user/recipient release click: the actual bounded keeper code polls
  // and submits permissionless release transactions on NEAR Testnet.
  let released = false, failedDelivery = false;
  let cursor = 0;
  for (let n = 0; n < 22; n++) {
    const keeperResult = await scanMainnetDueTransfers({
      account: recipient, contractId, cursor,
      pageSize: 30, maxCursorPages: 2, recentPages: 1,
      logger: { info: (message) => console.log(message), warn: (message) => console.warn(message) },
    });
    cursor = keeperResult.nextCursor;
    const after1 = await view('get_transfer', { transfer_id: '1' });
    const after2 = await view('get_transfer', { transfer_id: '2' });
    released = after1.status === 'Released';
    failedDelivery = after2.status === 'DeliveryFailed';
    if (released && failedDelivery) break;
    await sleep(3_000);
  }
  assert(released, 'Onchain keeper must deliver to the intended recipient');
  assert(failedDelivery, 'Missing recipient must fail safely');
  assert.equal(await view('get_total_reserved'), amount.toString(),
    'Failed delivery must remain reserved for sender refund');
  console.log('REWIND_V2_REAL_KEEPER_DELIVERY=PASS');

  // Release failure after deadline MUST remain refundable to original sender.
  const refund2 = await send('cancel', { transfer_id: '2' });
  await waitForFinalStatus(view, '2', 'Cancelled');
  assert.equal(await view('get_total_reserved'), '0');
  assert.equal((await view('get_transfers_for_account',
    { account_id: rootId, limit: 10 })).length, 3);
  assert.equal(await view('is_paused'), true,
    'Owner pause must not block preexisting delivery or refunds');
  console.log('REWIND_V2_FAILED_DELIVERY_REFUND=PASS; tx=' + refund2.transaction.hash);

  const explorer = 'https://testnet.nearblocks.io/address/' + contractId;
  console.log('REWIND_V2_CREATE_REFUNDED_TX=' + create0.transaction.hash);
  console.log('REWIND_V2_CANCEL_TX=' + cancel0.transaction.hash);
  console.log('REWIND_V2_CREATE_RELEASED_TX=' + create1.transaction.hash);
  console.log('REWIND_V2_CREATE_MISSING_RECIPIENT_TX=' + create2.transaction.hash);
  console.log('REWIND_V2_FAILED_DELIVERY_REFUND_TX=' + refund2.transaction.hash);
  console.log('REWIND_V2_EXPLORER=' + explorer);
  console.log('REWIND_V2_REAL_CHAIN_PROOF=PASS');

  await recordSummary([
    '## REWIND V2 candidate: **real onchain Testnet proof**',
    '',
    'Fresh funded Testnet contract (not Mainnet): `' + contractId + '`',
    'WASM SHA-256: `' + wasmSha256 + '`',
    'NEAR deployed code hash: `' + codeHash + '`',
    '- [x] Deployed exact CI-built candidate WASM to fresh Testnet account',
    '- [x] Rejected a missing storage fee and over-cap amount',
    '- [x] Rejected third-party cancellation and early release',
    '- [x] Confirmed 60-second expiry and **onchain refund callback**',
    '- [x] Confirmed **keeper-initiated delivery after expiry**, no sender click',
    '- [x] Confirmed failed recipient delivery and subsequent sender refund',
    '- [x] Confirmed owner pause of NEW sends does not halt prior settlements',
    '- [x] Confirmed total contract escrow reserved = 0 after all payments',
    '- Refund: https://testnet.nearblocks.io/txns/' + cancel0.transaction.hash,
    '- Delivery transfer: https://testnet.nearblocks.io/txns/' + create1.transaction.hash,
    '- Recovery refund: https://testnet.nearblocks.io/txns/' + refund2.transaction.hash,
    '- Explorer: ' + explorer,
    '',
    '> These were TEST tokens. They do not establish independent security-audit approval for real NEAR.',
  ]);
}

await main();
