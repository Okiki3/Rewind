/**
 * Creates a new REWIND testnet contract through the testnet faucet, tests actual
 * sender cancellation and post-expiry delivery, and prints a contract account ID.
 * No account private keys are printed. The original variable-window contract
 * is not upgraded or modified.
 *
 * Run only in a temporary automated Testnet proof environment.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { Worker } from 'near-workspaces';

const wasm = path.resolve('target/wasm32-unknown-unknown/release/rewind_escrow.wasm');
const worker = await Worker.init({ network: 'testnet' });
const tinyDeposit = '10000000000000000000000'; // 0.01 NEAR

try {
  const root = worker.rootAccount;
  const sender = await root.createSubAccount('sender');
  const recipient = await root.createSubAccount('recipient');
  const contract = await root.devDeploy(wasm);
  const contractId = contract.accountId;

  console.log('REWIND_TESTNET_CONTRACT=' + contractId);
  await contract.call(contract, 'new', { owner_id: contractId });

  await sender.call(contract, 'create_transfer', { recipient: recipient.accountId }, { attachedDeposit: tinyDeposit });
  let first = await contract.view('get_transfer', { transfer_id: '0' });
  assert.equal(first.status, 'Pending');
  assert.equal(first.amount, tinyDeposit);
  assert.equal(BigInt(first.expires_at_ms) - BigInt(first.created_at_ms), 60_000n);

  await sender.call(contract, 'cancel', { transfer_id: '0' });
  first = await contract.view('get_transfer', { transfer_id: '0' });
  assert.equal(first.status, 'Cancelled', 'Refund must be callback-confirmed');
  console.log('TESTNET_REFUND_CONFIRMED=transfer-0');

  await sender.call(contract, 'create_transfer', { recipient: recipient.accountId }, { attachedDeposit: tinyDeposit });
  const second = await contract.view('get_transfer', { transfer_id: '1' });
  assert.equal(second.status, 'Pending');

  // Block-clock based expiry; wait in real time on Testnet.
  const remaining = Number(second.expires_at_ms) - Date.now() + 5_000;
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  await recipient.call(contract, 'release', { transfer_id: '1' });

  const released = await contract.view('get_transfer', { transfer_id: '1' });
  assert.equal(released.status, 'Released', 'Delivery must be callback-confirmed');
  assert.equal(await contract.view('get_total_reserved'), '0');
  console.log('TESTNET_DELIVERY_CONFIRMED=transfer-1');
  console.log('REWIND_TESTNET_PROOF=PASS');
  console.log('TESTNET_CONTRACT_EXPLORER=https://testnet.nearblocks.io/address/' + contractId);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs/promises');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, [
      '## New REWIND fixed-60-second Testnet contract',
      '',
      '- Account: ' + contractId,
      '- Send + refund: verified',
      '- Send + release: verified',
      '- Total reserved: 0',
      '- Explorer: https://testnet.nearblocks.io/address/' + contractId,
      '- Note: this is an automated testnet account. Deploy a user-owned mainnet account separately.',
      '',
    ].join('\n'));
  }
} finally {
  await worker.tearDown();
}
