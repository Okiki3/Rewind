// Read-only release audit. Makes public HTTP/RPC requests; never signs or sends transactions.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const contractId = 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet';
const origin = 'https://afrolitehub.com/rewind/';
const rpcUrls = ['https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org'];
const failures = [];
const results = [];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function result(name, ok, info = {}) {
  results.push({ name, ok, ...info });
  console.log(JSON.stringify({ check: name, status: ok ? 'PASS' : 'FAIL', ...info }));
  if (!ok) failures.push(name);
}
async function getWithRetry(url, opts = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
      if (response.status === 429 || response.status >= 500) {
        last = new Error('HTTP ' + response.status);
        continue;
      }
      return response;
    } catch (e) { last = e; }
  }
  throw last ?? new Error('Request unavailable');
}
async function rpcQuery(params) {
  let last;
  for (const url of rpcUrls) {
    try {
      const response = await getWithRetry(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'security-review', method: 'query', params }),
      });
      if (!response.ok) throw new Error('RPC HTTP ' + response.status);
      const json = await response.json();
      if (json.error) throw new Error('RPC error ' + (json.error.message ?? json.error.name ?? 'unknown'));
      if (!json.result) throw new Error('RPC result missing');
      return json.result;
    } catch (e) { last = e; }
  }
  throw last ?? new Error('All public RPCs unavailable');
}
async function checkSdk() {
  const paths = [
    ['sdk/index.js', 'text/javascript', 'sdk/dist/index.js'],
    ['sdk/index.d.ts', 'text/plain', 'sdk/dist/index.d.ts'],
    ['sdk/README.md', 'text/markdown', 'sdk/README.md'],
  ];
  for (const [path, mime, localFile] of paths) {
    try {
      const response = await getWithRetry(origin + path, {
        headers: { Origin: 'https://third-party-wallet.example', Accept: '*/*' },
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const local = await readFile(localFile);
      const mimeOk = (response.headers.get('content-type') ?? '').startsWith(mime);
      const corsOk = response.headers.get('access-control-allow-origin') === '*';
      const match = sha256(bytes) === sha256(local);
      result('SDK ' + path, response.ok && mimeOk && corsOk && match, {
        http: response.status, mime_ok: mimeOk, cors_ok: corsOk,
        same_bytes_as_current_source_build: match, bytes: bytes.length,
        public_sha256: sha256(bytes),
      });
    } catch (e) { result('SDK ' + path, false, { error: String(e).slice(0,200) }); }
  }
  try {
    const response = await getWithRetry(origin + 'sdk/definitely-not-present.js');
    result('SDK missing file returns 404', response.status === 404, { http: response.status });
  } catch (e) { result('SDK missing file returns 404', false, { error: String(e).slice(0,200) }); }
}
async function checkContract() {
  try {
    const account = await rpcQuery({ request_type: 'view_account', finality: 'final', account_id: contractId });
    result('Testnet contract exists with code', !!account.code_hash && account.code_hash !== '11111111111111111111111111111111', {
      code_hash: account.code_hash, storage_usage: account.storage_usage,
    });
  } catch (e) { result('Testnet contract exists with code', false, { error: String(e).slice(0,200) }); }

  try {
    const keys = [];
    let after_key;
    do {
      const payload = { request_type: 'view_access_key_list', finality: 'final', account_id: contractId, limit: 100 };
      if (after_key) payload.after_key = after_key;
      const response = await rpcQuery(payload);
      if (!Array.isArray(response.keys)) throw new Error('Missing keys array');
      keys.push(...response.keys);
      after_key = response.last_key;
      if (keys.length > 1000) throw new Error('Key count unexpectedly high');
    } while (after_key);
    const fullAccess = keys.filter(k => k.access_key?.permission === 'FullAccess').length;
    const functionCall = keys.length - fullAccess;
    // Access keys are public. Never print key material; only permission counts.
    result('Contract access-key enumeration', true, {
      access_key_count: keys.length, full_access_count: fullAccess,
      restricted_key_count: functionCall,
      assessment: fullAccess ? 'Full-access permission exists; holder must prove control and secure it.' : 'No full-access keys remain onchain; ordinary account-level contract upgrades cannot be signed.',
    });
  } catch (e) { result('Contract access-key enumeration', false, { error: String(e).slice(0,200) }); }

  for (const method of ['get_owner', 'get_transfer_count', 'get_total_reserved']) {
    try {
      const query = await rpcQuery({
        request_type: 'call_function', finality: 'final', account_id: contractId,
        method_name: method, args_base64: Buffer.from('{}').toString('base64'),
      });
      const value = JSON.parse(Buffer.from(query.result ?? []).toString('utf8'));
      const valid = method === 'get_owner' ? typeof value === 'string' : /^\\d+$/.test(String(value));
      result('Onchain read ' + method, valid, { value });
    } catch (e) { result('Onchain read ' + method, false, { error: String(e).slice(0,200) }); }
  }
}
await checkSdk();
await checkContract();
console.log(JSON.stringify({ audit: 'read-only public release verification', passed: results.length - failures.length, checks: results.length, failed_checks: failures }));
if (failures.length) process.exitCode = 1;
