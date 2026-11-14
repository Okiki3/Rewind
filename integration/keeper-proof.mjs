/**
 * Test the real external Railway keeper, NOT a manual release call.
 * Makes a disposable faucet-funded test wallet and submits a protected payment
 * to the already-deployed 60s contract, then polls for Delivered/Released.
 */
import nearAPI from 'near-api-js';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const contractId = process.env.NEAR_CONTRACT_ID;
if (!contractId?.endsWith('.testnet')) throw new Error('Provide a verified Testnet contract ID');
const accountId = 'rewind-keeper-proof-' + Date.now().toString(36) + '-' + randomBytes(4).toString('hex') + '.testnet';
const keyPair = nearAPI.KeyPair.fromRandom('ed25519');
const post = JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() });
const res = await fetch('https://helper.testnet.near.org/account', {
  method:'POST',headers:{'content-type':'application/json'},body:post,signal:AbortSignal.timeout(30000),
});
if (!res.ok) throw new Error('Faucet returned '+res.status+': '+(await res.text()).slice(0,200));
const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet',accountId,keyPair);
const near = await nearAPI.connect({networkId:'testnet',keyStore,nodeUrl:'https://rpc.testnet.fastnear.com'});
const sender=await near.account(accountId);
for(let i=0;i<20;i++){try{await sender.state();break;}catch(e){if(i===19)throw e;await new Promise(r=>setTimeout(r,1000));}}
const amount='10000000000000000000000';
// The existing verified test recipient account remains deployed.
const recipient='winner.rewindproof-mwfi8ufi-fa888154e57d.testnet';
const tx=await sender.functionCall({contractId,methodName:'create_transfer',args:{recipient},gas:60000000000000n,attachedDeposit:BigInt(amount)});
console.log('CREATED_TX='+tx.transaction.hash);
const match=tx.receipts_outcome.flatMap(r=>r.outcome.logs||[]).find(l=>l.startsWith('TRANSFER_CREATED:'));
if(!match)throw new Error('Transfer ID missing from onchain logs');
const id=match.split(':')[1];
console.log('TRANSFER_ID='+id);
let last;
for(let i=0;i<36;i++){
  const state=await sender.viewFunction({contractId,methodName:'get_transfer',args:{transfer_id:id}});
  last=state;
  if(state.status==='Released'){
    console.log('KEEPER_AUTOMATIC_DELIVERY=PASS');
    console.log('TRANSFER_STATUS='+state.status);
    console.log('TESTNET_CONTRACT='+contractId);
    if(process.env.GITHUB_STEP_SUMMARY){
      const fs=await import('node:fs/promises');
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
        '\n### Automatic REWIND delivery\n- Contract: '+contractId+
        '\n- Transfer ID: '+id+'\n- Creation tx: '+tx.transaction.hash+
        '\n- Keeper released without manual call: YES\n');
    }
    process.exit(0);
  }
  if(state.status==='DeliveryFailed'||state.status==='RefundFailed'||state.status==='Cancelled')throw new Error('Unexpected '+state.status);
  await new Promise(r=>setTimeout(r,5000));
}
throw new Error('Automatic delivery not observed within 180 sec; last status '+last?.status);
