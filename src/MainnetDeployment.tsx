import { useEffect, useState } from 'react'

const ESCROW = 'afrolite-rewind-261114.near'
const EXPECTED_HASH = 'BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW'
const RPC = 'https://rpc.mainnet.fastnear.com'
type Status = { kind: 'checking' | 'verified' | 'unverified'; detail: string }

export default function MainnetDeployment({ testnetHref }: { testnetHref: string }) {
  const [status, setStatus] = useState<Status>({
    kind: 'checking', detail: 'Checking final NEAR Mainnet state…',
  })

  useEffect(() => {
    const controller = new AbortController()
    async function query(params: Record<string, string>): Promise<Record<string, unknown>> {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'rewind-mainnet-public-proof', method: 'query', params }),
        signal: controller.signal,
      })
      const payload = await response.json() as {
        result?: Record<string, unknown>,
        error?: { message?: string },
      }
      if (!response.ok || !payload.result || payload.error) {
        throw Error(payload.error?.message || 'Unable to query final Mainnet state')
      }
      return payload.result
    }

    async function verify() {
      const account = await query({
        request_type: 'view_account', account_id: ESCROW, finality: 'final',
      })
      if (account.code_hash !== EXPECTED_HASH) {
        setStatus({
          kind: 'unverified',
          detail: 'Contract code does not match the pinned reviewed-candidate hash. Do not send funds.',
        })
        return
      }
      async function view(method_name: string): Promise<unknown> {
        const response = await query({
          request_type: 'call_function', finality: 'final',
          account_id: ESCROW, method_name, args_base64: 'e30=',
        })
        if (!Array.isArray(response.result)) throw Error('Invalid contract view result')
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(response.result))) as unknown
      }
      const [owner, paused] = await Promise.all([view('get_owner'), view('is_paused')])
      if (owner === 'afrolite.near' && paused === true) {
        setStatus({
          kind: 'verified',
          detail: 'Live RPC verified: matching code hash · owner afrolite.near · paused = true',
        })
      } else {
        setStatus({
          kind: 'unverified',
          detail: 'Mainnet state differs from expected ownership or paused state. Do not send funds.',
        })
      }
    }
    void verify().catch((error: unknown) => {
      if (controller.signal.aborted) return
      setStatus({
        kind: 'unverified',
        detail: 'Live Mainnet verification unavailable (' +
          (error instanceof Error ? error.message : 'RPC error') + '). Do not send funds.',
      })
    })
    return () => controller.abort()
  }, [])

  return (
    <div className="panel inspect mainnet-roadmap" id="transfer-status">
      <div className="panel-title"><span>MAINNET</span><div>
        <h2>Contract deployed. Public payments remain paused.</h2>
        <p>REWIND V2 is on NEAR Mainnet for public inspection, not yet for financial use.</p>
      </div></div>
      <div className="mainnet-roadmap-steps">
        <p><strong>01 · Deployment complete</strong><span>Escrow account: {ESCROW}. Deployed using owner-authorised signing.</span></p>
        <p><strong>02 · Live contract verification</strong><span role="status">{status.detail}</span></p>
        <p><strong>03 · Security review before activation</strong><span>Independent smart-contract audit, key-custody review, funded Mainnet keeper and limited payment reconciliation are required before unpausing.</span></p>
      </div>
      <p className="mainnet-roadmap-note">Read-only Mainnet account checks are available above. No Mainnet signing, deposits, releases or refunds are enabled in this website. Do not send NEAR directly to the escrow account. Testnet payments remain available in the demo.</p>
      <a className="button secondary" href="https://nearblocks.io/address/afrolite-rewind-261114.near" target="_blank" rel="noopener noreferrer">Inspect Mainnet escrow <span aria-hidden="true">↗</span></a>{' '}
      <a className="button secondary" href={testnetHref}>Try protected payments on Testnet <span aria-hidden="true">→</span></a>
    </div>
  )
}
