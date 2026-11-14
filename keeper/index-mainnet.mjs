/**
 * Mainnet worker CANDIDATE. Explicitly gated; do not deploy without verified
 * contract ownership, audited WASM, dedicated keeper funds and monitoring.
 * Existing Testnet keeper remains unchanged.
 */
import nearAPI from 'near-api-js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scanMainnetDueTransfers } from './scan-mainnet.mjs';

const { connect, keyStores, KeyPair } = nearAPI;

if (process.env.NEAR_NETWORK_ID !== 'mainnet') {
  throw new Error('This worker can only run on the explicitly configured Mainnet');
}
if (process.env.ENABLE_MAINNET_KEEPER !== 'I_ACCEPT_MAINNET_RISK' ||
    process.env.MAINNET_RELEASE_APPROVED !== 'REVIEWED_AND_AUTHORIZED') {
  throw new Error('Mainnet keeper requires deliberate, separate release approvals');
}

const contractId = process.env.NEAR_CONTRACT_ID || '';
const accountId = process.env.KEEPER_ACCOUNT_ID || '';
const privateKey = process.env.KEEPER_PRIVATE_KEY || '';
const expectedHash = process.env.MAINNET_EXPECTED_CODE_HASH || '';
const rpcUrl = process.env.NEAR_RPC_URL || 'https://rpc.mainnet.fastnear.com';
const cursorFile = process.env.KEEPER_CURSOR_FILE || '/data/rewind-mainnet-keeper-cursor.json';
const pollMs = Math.max(5_000, Number(process.env.POLL_INTERVAL_MS || 10_000));
if (!contractId.endsWith('.near') || !accountId ||
    !privateKey.startsWith('ed25519:') ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(expectedHash) ||
    !Number.isFinite(pollMs)) {
  throw new Error('Missing verified contract/account/code hash/keeper credentials');
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('mainnet', accountId, KeyPair.fromString(privateKey));
const near = await connect({ networkId: 'mainnet', nodeUrl: rpcUrl, keyStore });
const account = await near.account(accountId);
await account.state();

function loadCursor() {
  try {
    if (!existsSync(cursorFile)) return 0;
    const data = JSON.parse(readFileSync(cursorFile, 'utf8'));
    if (data.contractId !== contractId || data.expectedCodeHash !== expectedHash) return 0;
    return Number.isSafeInteger(data.cursor) && data.cursor >= 0 ? data.cursor : 0;
  } catch { return 0; }
}

function saveCursor(cursor) {
  mkdirSync(dirname(cursorFile), { recursive: true });
  const tempFile = cursorFile + '.tmp';
  writeFileSync(tempFile,
    JSON.stringify({ contractId, expectedCodeHash: expectedHash, cursor }),
    { mode: 0o600 });
  renameSync(tempFile, cursorFile);
}

async function verifyDeployment() {
  const state = await near.connection.provider.query({
    request_type: 'view_account',
    account_id: contractId,
    finality: 'final',
  });
  if (state.code_hash !== expectedHash) {
    throw new Error('Escrow contract code hash changed; Mainnet keeper refusing to sign');
  }
  const fee = await account.viewFunction({
    contractId, methodName: 'get_storage_fee', args: {},
  });
  if (String(fee) !== '20000000000000000000000') {
    throw new Error('Mainnet contract storage fee differs from reviewed candidate');
  }
}

let cursor = loadCursor();
console.info('Mainnet keeper started: guarded release workflow on ' + contractId);
while (true) {
  try {
    await verifyDeployment();
    const summary = await scanMainnetDueTransfers({
      account, contractId, cursor, logger: console,
    });
    cursor = summary.nextCursor;
    saveCursor(cursor);
    if (summary.attempted || summary.failed) console.info('Mainnet settlement scan', summary);
  } catch (error) {
    console.error('Mainnet settlement scan halted: ' + String(error));
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
