import nearAPI from 'near-api-js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { scanAndRelease } from './scan.mjs';

const { connect, keyStores, KeyPair } = nearAPI;
const networkId = process.env.NEAR_NETWORK_ID || 'testnet';
const contractId = process.env.NEAR_CONTRACT_ID;
const pollMs = Math.max(5_000, Number(process.env.POLL_INTERVAL_MS || 10_000));
if (!['testnet', 'mainnet'].includes(networkId)) throw new Error('Invalid NEAR_NETWORK_ID');
if (!contractId || !Number.isFinite(pollMs)) throw new Error('Missing contract ID or invalid interval');
if (networkId === 'mainnet' && process.env.ENABLE_MAINNET_KEEPER !== 'I_ACCEPT_MAINNET_RISK') {
  throw new Error('Mainnet keeper requires deliberate owner approval');
}

async function ensureTestnetKeeper() {
  const path = process.env.KEEPER_CREDENTIALS_FILE || '/data/rewind-keeper.json';
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (!saved.accountId?.endsWith('.testnet') || !saved.privateKey?.startsWith('ed25519:')) {
      throw new Error('Invalid persisted Testnet keeper credentials');
    }
    return saved;
  }
  if (process.env.ALLOW_TESTNET_FAUCET_KEEPER !== 'true') {
    throw new Error('Set keeper credentials or explicitly enable Testnet faucet bootstrap');
  }
  const wallet = KeyPair.fromRandom('ed25519');
  const accountId = 'rewind-keeper-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex') + '.testnet';
  const payload = JSON.stringify({ newAccountId: accountId, newAccountPublicKey: wallet.getPublicKey().toString() });
  let funded = false;
  for (const url of ['https://helper.testnet.near.org/account', 'https://helper.nearprotocol.com/account']) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) { funded = true; break; }
    } catch { /* try the backup faucet */ }
  }
  if (!funded) throw new Error('Cannot fund the Testnet release worker. Configure an existing account.');
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  writeFileSync(temp, JSON.stringify({ accountId, privateKey: wallet.toString() }), { mode: 0o600 });
  renameSync(temp, path);
  return { accountId, privateKey: wallet.toString() };
}

const credentials = process.env.KEEPER_ACCOUNT_ID && process.env.KEEPER_PRIVATE_KEY
  ? { accountId: process.env.KEEPER_ACCOUNT_ID, privateKey: process.env.KEEPER_PRIVATE_KEY }
  : networkId === 'testnet' ? await ensureTestnetKeeper()
    : (() => { throw new Error('Mainnet keeper requires explicit account credentials'); })();

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey(networkId, credentials.accountId, KeyPair.fromString(credentials.privateKey));
const near = await connect({
  networkId, keyStore,
  nodeUrl: process.env.NEAR_RPC_URL || 'https://rpc.' + networkId + '.near.org',
});
const account = await near.account(credentials.accountId);
for (let retry = 0; retry < 30; retry++) {
  try { await account.state(); break; } catch (e) {
    if (retry === 29) throw new Error('Keeper account not found onchain: ' + String(e));
    await new Promise(r => setTimeout(r, 1_000));
  }
}
console.info('REWIND release keeper active on ' + networkId + ', account ' + credentials.accountId);
while (true) {
  try {
    const result = await scanAndRelease({ account, contractId });
    if (result.attempted || result.failed) console.info('Delivery scan:', result);
  } catch (error) {
    console.error('Release scan failed:', String(error));
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
