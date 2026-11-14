// Read-only explorer API capability check, to support historic tx hashes.
for (const base of ['https://api-testnet.nearblocks.io', 'https://api3-testnet.nearblocks.io']) {
  for (const path of ['/v3/accounts/afrotest.testnet/txns?limit=10', '/v3/txns?limit=1']) {
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(10000), headers: { Origin: 'https://afrolitehub.com' } });
      const body = await res.text();
      console.log(JSON.stringify({host:base,path,status:res.status,cors:res.headers.get('access-control-allow-origin'),sample:body.slice(0,650)}));
    } catch(e) { console.log(JSON.stringify({host:base,path,error:String(e)})); }
  }
}
