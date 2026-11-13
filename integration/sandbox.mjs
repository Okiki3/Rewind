// Executes real WASM on a local NEAR Sandbox node, including promise callbacks.
import assert from 'node:assert/strict';
import { Worker } from 'near-workspaces';
import path from 'node:path';

const wasm = path.resolve('target/wasm32-unknown-unknown/release/rewind_escrow.wasm');
const yocto = '10000000000000000000000'; // 0.01 NEAR
const worker = await Worker.init();

try {
  const root = worker.rootAccount;
  const alice = await root.createSubAccount('alice');
  const bob = await root.createSubAccount('bob');
  const contract = await root.devDeploy(wasm);
  await contract.call(contract, 'new', { owner_id: contract.accountId });

  await alice.call(contract, 'create_transfer', { recipient: bob.accountId }, { attachedDeposit: yocto });
  const first = await contract.view('get_transfer', { transfer_id: '0' });
  assert.equal(first.sender, alice.accountId);
  assert.equal(first.recipient, bob.accountId);
  assert.equal(first.amount, yocto);
  assert.equal(first.status, 'Pending');
  assert.equal(BigInt(first.expires_at_ms) - BigInt(first.created_at_ms), 60_000n);

  await assert.rejects(() => bob.call(contract, 'cancel', { transfer_id: '0' }));
  await alice.call(contract, 'cancel', { transfer_id: '0' });
  const cancelled = await contract.view('get_transfer', { transfer_id: '0' });
  assert.equal(cancelled.status, 'Cancelled', 'refund callback must succeed');

  await alice.call(contract, 'create_transfer', { recipient: bob.accountId }, { attachedDeposit: yocto });
  const second = await contract.view('get_transfer', { transfer_id: '1' });
  assert.equal(second.status, 'Pending');
  await assert.rejects(() => bob.call(contract, 'release', { transfer_id: '1' }));

  // The sandbox advances block height and the onchain timestamp; do not wait 60 seconds.
  await worker.fastForward(150);
  const latest = await contract.view('get_transfer', { transfer_id: '1' });
  assert.ok(BigInt(latest.expires_at_ms) <= BigInt(Date.now()) + 1000000000000n, 'reasonable onchain timestamp');
  await bob.call(contract, 'release', { transfer_id: '1' });
  const released = await contract.view('get_transfer', { transfer_id: '1' });
  assert.equal(released.status, 'Released', 'delivery callback must succeed');
  assert.equal(await contract.view('get_total_reserved'), '0');
  await assert.rejects(() => alice.call(contract, 'cancel', { transfer_id: '1' }));
  await assert.rejects(() => bob.call(contract, 'release', { transfer_id: '1' }));

  console.log('SANDBOX VERIFIED: funded send, unauthorized cancel rejected, 60s lock,');
  console.log('refund callback, early release rejected, post-expiry delivery callback,');
  console.log('reserved funds cleared, repeated settlement rejected.');
} finally {
  await worker.tearDown();
}
