#!/usr/bin/env node
/**
 * REWIND Mainnet owner pause control (Android/Termux).
 * This script NEVER stores or prints your private key.
 * Only use the FullAccess key for afrolite.near (owner), NOT the escrow key.
 */
import nearAPI from 'near-api-js';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
const { connect, keyStores, KeyPair } = nearAPI;
const ACCOUNT='afrolite.near';
const CONTRACT='afrolite-rewind-261114.near';
const HASH='BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW';
const RPC='https://rpc.mainnet.fastnear.com';
const rl=createInterface({input:stdin,output:stdout});
const ask=(prompt)=>new Promise(resolve=>rl.question(prompt,resolve));
try {
  const action=(process.argv[2]||'check').toLowerCase();
  if(!['check','unpause','pause'].includes(action))throw Error('Use: node owner-mainnet-control.mjs check|unpause|pause');
  const near=await connect({networkId:'mainnet',nodeUrl:RPC,keyStore:new keyStores.InMemoryKeyStore()});
  const contract=await near.account(CONTRACT);
  const state=await contract.state();
  const owner=await contract.viewFunction({contractId:CONTRACT,methodName:'get_owner',args:{}});
  const paused=await contract.viewFunction({contractId:CONTRACT,methodName:'is_paused',args:{}});
  console.log(JSON.stringify({account:CONTRACT,codeHash:state.code_hash,owner,paused},null,2));
  if(state.code_hash!==HASH || owner!==ACCOUNT)throw Error('STOP: Mainnet code hash or owner differs');
  if(action==='check')process.exit(0);
  const desired=action==='pause';
  if(paused===desired){console.log('Already in requested state. No transaction needed.');process.exit(0)}
  console.log('WARNING: this contract has not passed an independent security audit.');
  console.log('Unpausing makes the onchain create_transfer method publicly callable, even if the website is still disabled.');
  const phrase=await ask('Type '+(desired?'PAUSE MAINNET':'UNPAUSE MAINNET')+' to confirm: ');
  if(phrase!==(desired?'PAUSE MAINNET':'UNPAUSE MAINNET'))throw Error('Cancelled; no transaction submitted');
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
  const keyStore=new keyStores.InMemoryKeyStore();
  await keyStore.setKey('mainnet',ACCOUNT,KeyPair.fromString(key));
  const signer=await connect({networkId:'mainnet',nodeUrl:RPC,keyStore});
  const result=await (await signer.account(ACCOUNT)).functionCall({
    contractId:CONTRACT,methodName:'set_paused',args:{paused:desired},
    gas:'30000000000000',attachedDeposit:'0'
  });
  console.log('Transaction:',result.transaction?.hash||'submitted');
  const after=await (await signer.account(CONTRACT)).viewFunction({contractId:CONTRACT,methodName:'is_paused',args:{}});
  console.log('Onchain paused:',after);
  if(after!==desired)throw Error('Unexpected state after transaction; verify finality before retrying');
} catch(e){console.error('STOP:',e.message);process.exitCode=1}finally{rl.close()}
