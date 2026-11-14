import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEscrowPublicKey, parseFundingYocto, createUnsignedEscrowProposal } from './escrow-unsigned-proposal.mjs';

const key = 'ed25519:11111111111111111111111111111112'; // Base58 32-byte nonzero test value
test('accepts only ed25519 public key not secret', () => {
  assert.equal(validateEscrowPublicKey(key), key);
  for (const invalid of ['secret:abc', 'ed25519:0', 'ed25519:1', '', 'ed25519:11111111111111111111111111111111']) {
    assert.throws(() => validateEscrowPublicKey(invalid));
  }
});
test('funding requires exact decimal yocto; bounds prevent accidental large transfers', () => {
  assert.equal(parseFundingYocto('5'), '5000000000000000000000000');
  assert.equal(parseFundingYocto('2.01'), '2010000000000000000000000');
  for (const invalid of ['1.99', '10.01', '-1', '1e6', 'NaN', '', '0', '1.1234567890123456789012345']) {
    assert.throws(() => parseFundingYocto(invalid));
  }
});
test('proposal cannot redirect funds or modify privileged owner key', () => {
  const plan = createUnsignedEscrowProposal({ publicKey:key, fundingNear:'5', ownerPublicKeys:[] });
  assert.equal(plan.network, 'mainnet');
  assert.equal(plan.signerId, 'afrolite.near');
  assert.equal(plan.receiverId, 'escrow.afrolite.near');
  assert.equal(plan.isSigned, false);
  assert.equal(plan.isBroadcast, false);
  assert.equal(plan.readyForPublicEscrowFunds, false);
  assert.equal(plan.actions.length, 3);
  assert.deepEqual(plan.actions[0], { type:'CreateAccount' });
  assert.deepEqual(plan.actions[1], { type:'Transfer', params: { deposit: '5000000000000000000000000' } });
  assert.deepEqual(plan.actions[2], { type:'AddKey', params:{ publicKey:key, accessKey:{permission:'FullAccess'} } });
  assert.throws(() => createUnsignedEscrowProposal({ publicKey:key, fundingNear:'5', ownerPublicKeys:[key] }));
});
