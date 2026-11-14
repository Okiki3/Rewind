/**
 * Read-only follow-up for the first ephemeral V2 Testnet proof account.
 * Checks asynchronous receipt finality AFTER the submitting CI job ended.
 * It neither has keys nor signs anything. Public Testnet data only.
 */
const rpcUrl = 'https://rpc.testnet.fastnear.com';
const contractId = 'escrow.rewind-v2-mwgh8urm-45816150.testnet';
const expectedCodeHash = 'EnNHVY88UeBbQkpvRMN6bCgszfztGbh88qe49EFsNrU';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function query(request_type, params) {
  const body = {
    jsonrpc: '2.0', id: 'rewind-v2-readonly',
    method: 'query',
    params: { request_type, finality: 'final', ...params },
  };
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await res.json();
  if (!res.ok || payload.error || !payload.result) {
    throw Error('Testnet RPC verification failed: ' + JSON.stringify(payload.error || res.status));
  }
  return payload.result;
}

async function view(method_name, args = {}) {
  const res = await query('call_function', {
    account_id: contractId, method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8'));
}

const account = await query('view_account', { account_id: contractId });
if (account.code_hash !== expectedCodeHash) {
  throw Error('Deployed V2 Testnet contract hash changed unexpectedly');
}

const end = Date.now() + 35_000;
let transfer0, transfer1, transfer2, reserved;
do {
  [transfer0, transfer1, transfer2, reserved] = await Promise.all([
    view('get_transfer', { transfer_id: '0' }),
    view('get_transfer', { transfer_id: '1' }),
    view('get_transfer', { transfer_id: '2' }),
    view('get_total_reserved'),
  ]);
  console.log('REWIND_V2_READONLY_STATES',
    [transfer0?.status, transfer1?.status, transfer2?.status].join('/'),
    'reserved='+reserved);
  if (transfer0?.status === 'Cancelled' &&
      transfer1?.status === 'Released' &&
      transfer2?.status === 'Cancelled' &&
      reserved === '0') break;
  if (Date.now() + 3_000 >= end) break;
  await sleep(3_000);
} while (true);

if (transfer0?.status !== 'Cancelled' || transfer1?.status !== 'Released' ||
    transfer2?.status !== 'Cancelled' || reserved !== '0') {
  throw Error('Asynchronous refund or release not confirmed at Testnet finality');
}
console.log('REWIND_V2_LIVE_TESTNET_ALL_THREE_SETTLED=PASS');
console.log('REWIND_V2_LIVE_TESTNET_ESCROW_ZERO=PASS');
console.log('REWIND_V2_EXPLORER=https://testnet.nearblocks.io/address/' + contractId);
