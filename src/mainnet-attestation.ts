/**
 * Release gate: reject a configured Mainnet account unless onchain account
 * code hash matches the reviewed, pinned WASM. Public RPC read; no signing.
 *
 * IMPORTANT: this protects against accidentally choosing the wrong contract.
 * It does not replace a security audit or defend against a later contract
 * upgrade between the read and signed transaction. Secure upgrade keys!
 */
export async function verifyMainnetContract({
  contractId,
  expectedCodeHash,
  rpcUrl = 'https://rpc.mainnet.fastnear.com',
  fetcher = fetch,
}: {
  contractId: string
  expectedCodeHash: string
  rpcUrl?: string
  fetcher?: typeof fetch
}): Promise<void> {
  if (!contractId.endsWith('.near') ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(expectedCodeHash)) {
    throw new Error('Approved Mainnet contract address and audited WASM hash are required')
  }
  const response = await fetcher(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rewind-mainnet-code-check',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: contractId },
    }),
    signal: AbortSignal.timeout(7_000),
  })
  if (!response.ok) throw new Error('Cannot verify Mainnet contract with NEAR RPC')
  const payload = await response.json() as {
    result?: { code_hash?: string },
    error?: { message?: string },
  }
  if (payload.error || !payload.result?.code_hash) {
    throw new Error('Mainnet escrow contract was not found or cannot be verified')
  }
  if (payload.result.code_hash !== expectedCodeHash) {
    throw new Error('Mainnet escrow bytecode differs from the approved contract. Signing disabled.')
  }
}
