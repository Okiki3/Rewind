const base='https://afrolitehub.com/rewind/'
for(const path of ['', 'sdk/index.js', 'sdk/index.d.ts', 'sdk/README.md']){
  const url=base+path
  try{
    const response=await fetch(url,{
      headers: {Origin:'https://example-wallet-app.test',Accept:'*/*'},
      signal:AbortSignal.timeout(12000)
    })
    const body=await response.text()
    const info={path,status:response.status,type:response.headers.get('content-type'),cors:response.headers.get('access-control-allow-origin'),length:body.length,html:body.slice(0,35),sdkFound:body.includes('buildProtectedSendTransaction')}
    console.log(JSON.stringify(info))
    if(path==='sdk/index.js' && (!response.ok || !info.sdkFound || info.cors!=='*')) process.exitCode=1
    if(path==='sdk/index.d.ts' && (!response.ok || !info.type?.startsWith('text/plain'))) process.exitCode=1
    if(path==='sdk/README.md' && (!response.ok || !body.includes('Current Testnet deployment'))) process.exitCode=1
  }catch(error){console.error(path,String(error));process.exitCode=1}
}
