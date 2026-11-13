/**
 * Fresh onchain Testnet proof using ephemeral, faucet-funded NEAR accounts.
 *
 * SECURITY: No secret keys are printed, committed, or uploaded as an artifact.
 * These accounts are intentionally disposable TESTNET accounts. A user-owned
 * contract should be created separately for a later Mainnet demonstration.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair } = nearAPI;
const networkId = 'testnet';
const rootId = ('rewindproof-' + Date.now().toString(36) + '-' + randomBytes(6).toString('hex') + '.testnet');
const contractId = 'rewind.' + rootId;
const recipientId = 'winner.' + rootId;
const keyPair = KeyPair.fromRandom('ed25519');
const publicKey = keyPair.getPublicKey().toString();
const endpoints = ['https://helper.testnet.near.org/account', 'https://helper.nearprotocol.com/account'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nearAmount = (n) => BigInt(n) * 10n ** 24n;
const tiny = 10n ** 22n; // 0.01 NEAR

async function faucetAccount() {
  const payload = JSON.stringify({ newAccountId: rootId, newAccountPublicKey: publicKey });
  const problems = [];
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      if (response.ok) return;
      problems.push(url + ': HTTP ' + response.status + ' ' + body.slice(0, 200));
    } catch (error) { problems.push(url + ': ' + String(error)); }
  }
  throw new Error('Testnet faucet could not create a funded account: ' + problems.join('; '));
}

async function main() {
  console.log('Creating an ephemeral funded Testnet account through the NEAR faucet.');
  await faucetAccount();

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(networkId, rootId, keyPair);
  const near = await connect({
    networkId, keyStore, nodeUrl: 'https://rpc.testnet.near.org',
  });
  const root = await near.account(rootId);
  let ready = false;
  for (let i = 0; i < 25; i++) {
    try { await root.state(); ready = true; break; } catch { await sleep(1_000); }
  }
  if (!ready) throw new Error('Faucet account not visible at finality');

  // Create two independent subaccounts owned by the disposable root key.
  await root.createAccount(contractId, keyPair.getPublicKey(), nearAmount(2));
  await root.createAccount(recipientId, keyPair.getPublicKey(), nearAmount(2));
  await keyStore.setKey(networkId, contractId, keyPair);
  await keyStore.setKey(networkId, recipientId, keyPair);

  const contract = await near.account(contractId);
  const receiver = await near.account(recipientId);
  await contract.deployContract(readFileSync('target/wasm32-unknown-unknown/release/rewind_escrow.wasm'));
  await contract.functionCall({ contractId, methodName: 'new', args: { owner_id: contractId }, gas: 40_000_000_000_000n });

  const view = (methodName, args) => contract.viewFunction({ contractId, methodName, args });
  const send = (methodName, args, deposit = 0n) =>
    root.functionCall({ contractId, methodName, args, gas: 60_000_000_000_000n, attachedDeposit: deposit });

  console.log('REWIND_TESTNET_CONTRACT=' + contractId);

  const created0 = await send('create_transfer', { recipient: recipientId }, tiny);
  let first = await view('get_transfer', { transfer_id: '0' });
  assert.equal(first.status, 'Pending');
  assert.equal(first.amount, tiny.toString());
  assert.equal(BigInt(first.expires_at_ms) - BigInt(first.created_at_ms), 60_000n);

  const cancelled = await send('cancel', { transfer_id: '0' });
  first = await view('get_transfer', { transfer_id: '0' });
  assert.equal(first.status, 'Cancelled', 'Refund must be confirmed onchain');
  console.log('REFUND_TX=' + cancelled.transaction.hash);

  const created1 = await send('create_transfer', { recipient: recipientId }, tiny);
  const second = await view('get_transfer', { transfer_id: '1' });
  assert.equal(second.status, 'Pending');

  const remaining = Number(second.expires_at_ms) - Date.now() + 4_000;
  if (remaining > 0) await sleep(remaining);
  const release = await receiver.functionCall({
    contractId, methodName: 'release', args: { transfer_id: '1' },
    gas: 60_000_000_000_000n,
  });
  const delivered = await view('get_transfer', { transfer_id: '1' });
  assert.equal(delivered.status, 'Released', 'Delivery must be confirmed onchain');
  assert.equal(await view('get_total_reserved', {}), '0');
  console.log('DELIVERY_TX=' + release.transaction.hash);
  console.log('REWIND_TESTNET_PROOF=PASS');
  console.log('TESTNET_EXPLORER=https://testnet.nearblocks.io/address/' + contractId);

  const lines = [
    '## Verified fixed-60-second REWIND Testnet contract',
    '- Account: \`' + contractId + '\`',
    '- Created first: \`' + created0.transaction.hash + '\`',
    '- Cancelled first: \`' + cancelled.transaction.hash + '\`',
    '- Created second: \`' + created1.transaction.hash + '\`',
    '- Delivered second: \`' + release.transaction.hash + '\`',
    '- Reserved after settlement: 0',
    '- Public explorer: https://testnet.nearblocks.io/address/' + contractId,
    '- WARNING: Disposable test account, not a user-owned Mainnet deployment.',
    '',
  ];
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs/promises');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }
}

await main();
