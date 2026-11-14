import { useEffect, useState } from 'react'

const ESCROW = 'afrolite-rewind-261114.near'
const EXPECTED_HASH = 'BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW'
const RPC = 'https://rpc.mainnet.fastnear.com'
type Status = { kind: 'checking' | 'verified' | 'unverified'; detail: string }

export default function MainnetDeployment({ testnetHref }: { testnetHref: string }) {
  const [demoReady, setDemoReady] = useState(false)
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
      if (owner === 'afrolite.near' && (paused === true || paused === false)) {
        setDemoReady(paused === false)
        setStatus({
          kind: 'verified',
          detail: 'Live RPC verified: matching code hash · owner afrolite.near · paused = ' + String(paused),
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
        <h2>Contract deployed. Mainnet is experimental.</h2>
        <p>The normal Mainnet page is read-only; a separate opt-in hackathon demonstration may allow very small real NEAR payments. This contract is unaudited.</p>
      </div></div>
      <div className="mainnet-roadmap-steps">
        <p><strong>01 · Deployment complete</strong><span>Escrow account: {ESCROW}. Deployed using owner-authorised signing.</span></p>
        <p><strong>02 · Live contract verification</strong><span role="status">{status.detail}</span></p>
        <p><strong>03 · Experimental hackathon demo</strong><span>Opt-in, 0.01–0.1 NEAR maximum per payment, plus 0.02 NEAR non-refundable storage fee. The keeper and cancellation flow must be verified separately before relying on automatic delivery.</span></p>
      </div>
      <p className="mainnet-roadmap-note">This page performs read-only Mainnet checks. Do not send NEAR directly to the escrow. Experimental payments, if unpaused, require the separate opt-in demo route. Unreviewed contract funds may be delayed or lost.</p>
      {demoReady && <p><a className="button secondary" href="/rewind/?network=mainnet&amp;demo=1">Open experimental Mainnet payment demo <span aria-hidden="true">→</span></a></p>}
      <a className="button secondary" href="https://nearblocks.io/address/afrolite-rewind-261114.near" target="_blank" rel="noopener noreferrer">Inspect Mainnet escrow <span aria-hidden="true">↗</span></a>{' '}
      <a className="button secondary" href={testnetHref}>Try protected payments on Testnet <span aria-hidden="true">→</span></a>
    </div>
  )
}
