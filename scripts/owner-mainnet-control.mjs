#!/usr/bin/env node
/**
 * REWIND Mainnet owner pause control (Android/Termux).
 * This script NEVER stores or prints your private key.
 * Only use the FullAccess key for afrolite.near (owner), NOT the escrow key.
 */
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
// near-api-js v7 uses named Account exports; no legacy connect/keyStores.
const ACCOUNT='afrolite.near';
const CONTRACT='afrolite-rewind-261114.near';
const HASH='BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW';
const RPC='https://rpc.mainnet.fastnear.com';
const rl=createInterface({input:stdin,output:stdout});
async function rpc(request_type,account_id,method_name) {
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:'owner-control',method:'query',
      params:method_name
        ? {request_type:'call_function',account_id,method_name,args_base64:'e30=',finality:'final'}
        : {request_type,account_id,finality:'final'}}),
    signal:AbortSignal.timeout(15000)});
  const json=await response.json();
  if(!response.ok||json.error||!json.result)throw Error('NEAR RPC query failed: '+(json.error?.message||response.status));
  if(method_name)return JSON.parse(new TextDecoder().decode(Uint8Array.from(json.result.result)));
  return json.result;
}

const ask=(prompt)=>new Promise(resolve=>rl.question(prompt,resolve));
try {
  const action=(process.argv[2]||'check').toLowerCase();
  if(!['check','unpause','pause'].includes(action))throw Error('Use: node owner-mainnet-control.mjs check|unpause|pause');
  const state=await rpc('view_account',CONTRACT);
  const owner=await rpc('call_function',CONTRACT,'get_owner');
  const paused=await rpc('call_function',CONTRACT,'is_paused');
  console.log(JSON.stringify({account:CONTRACT,codeHash:state.code_hash,owner,paused},null,2));
  if(state.code_hash!==HASH || owner!==ACCOUNT)throw Error('STOP: Mainnet code hash or owner differs');
  if(action==='check')process.exit(0);
  const desired=action==='pause';
  if(paused===desired){console.log('Already in requested state. No transaction needed.');process.exit(0)}
  console.log('WARNING: this contract has not passed an independent security audit.');
  console.log('Unpausing makes the onchain create_transfer method publicly callable, even if the website is still disabled.');
  const phrase=await ask('Type '+(desired?'PAUSE MAINNET':'UNPAUSE MAINNET')+' to confirm: ');
  if(phrase!==(desired?'PAUSE MAINNET':'UNPAUSE MAINNET'))throw Error('Cancelled; no transaction submitted');
  rl.close();
  const key=await new Promise(resolve=>{
    stdout.write('Enter afrolite.near ed25519: private key (input hidden): ');
    let secret='';
    const raw=stdin.isTTY && typeof stdin.setRawMode==='function';
    if(raw)stdin.setRawMode(true);
    const onData=(chunk)=>{
      const chars=chunk.toString();
      for(const ch of chars){
        if(ch==='\r'||ch==='\n'){
          stdin.off('data',onData);
          if(raw)stdin.setRawMode(false);
          stdout.write('\n');
          resolve(secret);
          return;
        }
        if(ch==='\u0003'){if(raw)stdin.setRawMode(false);process.exit(130)}
        if(ch==='\u007f'){secret=secret.slice(0,-1);continue}
        secret+=ch;
      }
    };
    stdin.on('data',onData);
    stdin.resume();
  });
  if(!key.startsWith('ed25519:'))throw Error('Expected ed25519: private key, not a seed phrase');
  const publicKey=KeyPair.fromString(key).getPublicKey().toString();
  const keys=await rpc('view_access_key_list',ACCOUNT);
  if(!keys.keys.some(entry=>entry.public_key===publicKey&&entry.access_key?.permission==='FullAccess')) {
    throw Error('This key is not a registered FullAccess key for afrolite.near. No transaction submitted.');
  }
  const signer=new Account(ACCOUNT,new JsonRpcProvider({url:RPC}),key);
  const result=await signer.signAndSendTransaction({
    receiverId:CONTRACT,
    actions:[actions.functionCall('set_paused',{paused:desired},30_000_000_000_000n,0n)],
    waitUntil:'FINAL',throwOnFailure:true
  });
  console.log('Transaction:',result.transaction?.hash||result.transaction_outcome?.id||'submitted');
  let after=await rpc('call_function',CONTRACT,'is_paused');
  for(let n=0;n<5&&after!==desired;n++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    after=await rpc('call_function',CONTRACT,'is_paused');
  }
  console.log('Onchain paused:',after);
  if(after!==desired)throw Error('Unexpected state after transaction; verify finality before retrying');
} catch(e){console.error('STOP:',e.message);process.exitCode=1}finally{rl.close()}
