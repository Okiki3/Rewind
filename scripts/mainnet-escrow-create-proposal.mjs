/**
 * Builds a read-only, unsigned Mainnet escrow creation proposal for Meteor.
 * User supplies a NEW public key generated and securely retained in their
 * private keychain/wallet. Never input private key or seed phrase.
 *
 * Usage (NO SIGNING, NO TRANSFERS):
 * REWIND_ESCROW_NEW_PUBLIC_KEY=ed25519:... REWIND_ESCROW_INITIAL_NEAR=5 \
 *   node scripts/mainnet-escrow-create-proposal.mjs
 */
import { writeFileSync } from 'node:fs';
import { createUnsignedEscrowProposal, OWNER_ID, ESCROW_ID } from './escrow-unsigned-proposal.mjs';

const rpc = 'https://rpc.mainnet.fastnear.com';
async function query(request_type, account_id) {
  const response = await fetch(rpc, {
    method: 'POST', headers: { 'content-type':'application/json' },
    body: JSON.stringify({jsonrpc:'2.0',id:'rewind-safe-escrow-proposal',
      method:'query',params:{request_type,account_id,finality:'final'}}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Mainnet RPC HTTP '+response.status);
  const payload = await response.json();
  if (payload.error) {
    if (/UNKNOWN_ACCOUNT|does not exist|not found/i.test(JSON.stringify(payload.error))) return null;
    throw Error('RPC error: '+JSON.stringify(payload.error).slice(0,300));
  }
  if (!payload.result) throw Error('Missing account response');
  return payload.result;
}
const publicKey = process.env.REWIND_ESCROW_NEW_PUBLIC_KEY;
const fundingNear = process.env.REWIND_ESCROW_INITIAL_NEAR;
if (!publicKey || !fundingNear) {
  console.error('Missing a separately secured NEW escrow PUBLIC key or approved funding amount.');
  console.error('Do not use a secret key, seed phrase or existing afrolite.near public key.');
  process.exitCode = 2;
} else {
  const [owner, escrow, ownerKeys] = await Promise.all([
    query('view_account',OWNER_ID),
    query('view_account',ESCROW_ID),
    query('view_access_key_list',OWNER_ID),
  ]);
  if (!owner) throw Error('Owner account not found on Mainnet');
  if (escrow) throw Error('Escrow account ALREADY EXISTS. Do not attempt to recreate/fund it.');
  if (!Array.isArray(ownerKeys?.keys)) throw Error('Could not confirm public owner keys');
  const keys = ownerKeys.keys.map(x => x.public_key);
  const proposal = createUnsignedEscrowProposal({publicKey,fundingNear,ownerPublicKeys:keys});
  const funding = BigInt(proposal.actions[1].params.deposit);
  const reserveForOwner = 10n ** 23n;
  const accountBalance = BigInt(owner.amount ?? '0');
  if (accountBalance < funding + reserveForOwner) {
    throw Error('Owner account public balance is below requested funding plus 0.1 NEAR buffer; no transaction proposed.');
  }
  const details = {
    ...proposal,
    escrowAccountNotYetCreated: true,
    keyCustodyConfirmed: false,
    needsOwnerMeteorApproval: true,
    deploymentRequiresSeparateEscrowSigningKey: true,
    caution: 'Review ALL actions and the exact public key in your wallet before signing. This JSON does not sign, submit, or fund anything.',
  };
  writeFileSync('rewind-escrow-unsigned-create.json',JSON.stringify(details,null,2)+'\n',{mode:0o600});
  console.log('REWIND_ESCROW_CREATE_PROPOSAL_VERIFIED=PASS');
  console.log('REWIND_OWNER_ACCOUNT='+OWNER_ID);
  console.log('REWIND_NEW_ESCROW_ACCOUNT='+ESCROW_ID);
  console.log('REWIND_ACCOUNT_CREATION_TRANSACTION=UNSIGNED');
  console.log('REWIND_FUNDS_TRANSFERRED=NONE');
  console.log('Unsigned proposal written to rewind-escrow-unsigned-create.json');
}
