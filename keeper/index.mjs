import nearAPI from 'near-api-js';
import { scanAndRelease } from './scan.mjs';

const { connect, keyStores, KeyPair } = nearAPI;
const networkId = process.env.NEAR_NETWORK_ID || 'testnet';
const contractId = process.env.NEAR_CONTRACT_ID;
const accountId = process.env.KEEPER_ACCOUNT_ID;
const privateKey = process.env.KEEPER_PRIVATE_KEY;
const pollMs = Math.max(5_000, Number(process.env.POLL_INTERVAL_MS || 10_000));
if (!['testnet', 'mainnet'].includes(networkId)) throw new Error('Invalid NEAR_NETWORK_ID');
if (networkId === 'mainnet' && process.env.ENABLE_MAINNET_KEEPER !== 'I_ACCEPT_MAINNET_RISK') {
  throw new Error('Mainnet keeper deliberately disabled. Explicit approval is required.');
}
if (!contractId || !accountId || !privateKey || !Number.isFinite(pollMs)) {
  throw new Error('Set NEAR_CONTRACT_ID, KEEPER_ACCOUNT_ID, KEEPER_PRIVATE_KEY and valid poll interval');
}
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey(networkId, accountId, KeyPair.fromString(privateKey));
const near = await connect({
  networkId, keyStore,
  nodeUrl: process.env.NEAR_RPC_URL || 'https://rpc.' + networkId + '.near.org',
});
const account = await near.account(accountId);
console.info('REWIND keeper starting for ' + networkId + ' contract ' + contractId);
while (true) {
  try {
    const result = await scanAndRelease({ account, contractId });
    if (result.attempted) console.info('Release scan:', result);
  } catch (error) {
    console.error('Keeper scan failed:', String(error));
  }
  // Delays can vary due to RPC latency and network confirmation.
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
