#!/usr/bin/env node
// REWIND Android keeper setup: one restricted key, no third account.
// The escrow FullAccess secret is entered only in local Termux memory.
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ESCROW='afrolite-rewind-261114.near';
const HASH='BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW';
const RPC='https://rpc.mainnet.fastnear.com';
const ALLOWANCE=200_000_000_000_000_000_000_000n; // 0.2 NEAR for gas only
const KEY_FILE=join(homedir(),'.rewind-mainnet-keeper.key');
const META_FILE=join(homedir(),'.rewind-mainnet-keeper-pub.txt');
const provider=new JsonRpcProvider({url:RPC});
async function query(request_type,account_id,method_name){
  const result=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:'rewind-keeper',method:'query',
      params:method_name?
        {request_type:'call_function',account_id,method_name,args_base64:'e30=',finality:'final'}:
        {request_type,account_id,finality:'final'}}),
    signal:AbortSignal.timeout(15000)});
  const payload=await result.json();
  if(!result.ok||payload.error||!payload.result)throw Error(payload.error?.message||'RPC error');
  return method_name?JSON.parse(Buffer.from(payload.result.result).toString('utf8')):payload.result;
}
const scoped=(x)=>x?.FunctionCall?.receiver_id===ESCROW &&
  Array.isArray(x.FunctionCall.method_names) &&
  x.FunctionCall.method_names.length===1 &&
  x.FunctionCall.method_names[0]==='release';
const line=async(prompt,hidden=false)=>{
  if(!hidden){
    const rl=createInterface({input:stdin,output:stdout});
    try{return await new Promise(resolve=>rl.question(prompt,resolve))}finally{rl.close()}
  }
  stdout.write(prompt);
  return new Promise(resolve=>{
    let value='';stdin.setRawMode?.(true);stdin.resume();
    const listener=(data)=>{
      for(const c of data.toString()){
        if(c==='\n'||c==='\r'){
          stdin.off('data',listener);stdin.setRawMode?.(false);stdin.pause();stdout.write('\n');resolve(value);return;
        }
        if(c==='\u0003'){stdin.setRawMode?.(false);process.exit(130)}
        if(c==='\u007f'||c==='\b'){value=value.slice(0,-1)}else{value+=c}
      }
    };
    stdin.on('data',listener);
  });
};
try{
  const cmd=process.argv[2]||'check';
  if(!['create','check'].includes(cmd))throw Error('Use create or check');
  const state=await query('view_account',ESCROW);
  if(state.code_hash!==HASH)throw Error('Code hash mismatch. STOP.');
  const keys=await query('view_access_key_list',ESCROW);
  if(cmd==='check'){
    if(!existsSync(KEY_FILE)){console.log('No local keeper key yet. Run: node mainnet-keeper-setup.mjs create');process.exit(0)}
    const saved=readFileSync(KEY_FILE,'utf8').trim();
    const publicKey=KeyPair.fromString(saved).getPublicKey().toString();
    const entry=keys.keys.find(k=>k.public_key===publicKey);
    console.log(JSON.stringify({account:ESCROW,publicKey,installed:!!entry,
      restrictedToRelease:scoped(entry?.access_key?.permission)},null,2));
    process.exit(entry&&scoped(entry?.access_key?.permission)?0:1);
  }
  if(existsSync(KEY_FILE))throw Error('Keeper key already saved; run check (do not create duplicates).');
  console.log('This adds a 0.2 NEAR gas-allowance key to the ESCROW account. It can only call the release method. It cannot transfer funds, change code, or change owner/pause settings.');
  const confirmation=await line('Type ADD KEEPER KEY to continue: ');
  if(confirmation!=='ADD KEEPER KEY')throw Error('Cancelled.');
  const key=KeyPair.fromRandom('ed25519');
  const pub=key.getPublicKey().toString();
  const ownerKey=await line('Enter escrow account FullAccess ed25519: key (hidden): ',true);
  if(!ownerKey.startsWith('ed25519:'))throw Error('Expected escrow FullAccess key, not seed phrase');
  const ownerPub=KeyPair.fromString(ownerKey).getPublicKey().toString();
  const verified=(await query('view_access_key_list',ESCROW)).keys.some(k=>
    k.public_key===ownerPub && k.access_key?.permission==='FullAccess');
  if(!verified)throw Error('Signing key is not registered as escrow FullAccess. No transaction submitted.');
  writeFileSync(KEY_FILE,key.toString()+'\n',{flag:'wx',mode:0o600});
  chmodSync(KEY_FILE,0o600);
  writeFileSync(META_FILE,pub+'\n',{flag:'wx',mode:0o600});
  try{
    const signer=new Account(ESCROW,provider,ownerKey);
    const result=await signer.signAndSendTransaction({
      receiverId:ESCROW,
      actions:[actions.addFunctionCallAccessKey(key.getPublicKey(),ESCROW,['release'],ALLOWANCE)],
      waitUntil:'FINAL',throwOnFailure:true
    });
    console.log('AddKey transaction:',result.transaction?.hash||'submitted');
  }catch(e){
    console.error('Signing failed. Keeper secret retained locally to avoid generating mismatched keys. Run check; do NOT share key.');
    throw e;
  }
  const fresh=(await query('view_access_key_list',ESCROW)).keys.find(k=>k.public_key===pub);
  if(!fresh||!scoped(fresh.access_key?.permission))throw Error('Key not yet verified onchain. Run check.');
  console.log('RESTRICTED KEEPER KEY INSTALLED. Account:',ESCROW);
  console.log('Public key:',pub);
  console.log('Key file stored on this phone:',KEY_FILE);
  console.log('Only put the key file contents into Railway KEEPER_PRIVATE_KEY. Never send it to chat or GitHub.');
}catch(e){console.error('STOP:',e.message);process.exitCode=1}
