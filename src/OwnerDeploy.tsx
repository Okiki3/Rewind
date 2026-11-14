import { useCallback, useState } from 'react'
import { NearConnector, type ConnectorAction } from '@hot-labs/near-connect'

const OWNER = 'afrolite.near'
const ESCROW = 'afrolite-rewind-261114.near'
const CODE_SHA = '9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333'
const NEAR_CODE_HASH = 'BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW'
const RPC = 'https://rpc.mainnet.fastnear.com'
const WASM_URL = '/rewind/release/rewind-v2-candidate.wasm'
const NO_CODE = '11111111111111111111111111111111'

const connector = new NearConnector({
  network: 'mainnet',
  features: { signAndSendTransaction: true },
  footerBranding: null,
})

type AccountState = { amount: string; locked: string; storage_usage: number; code_hash: string }
type KeyList = { keys: Array<{ public_key: string; access_key: { permission: string | Record<string, unknown> } }> }

async function rpc(requestType: string, accountId: string): Promise<AccountState | KeyList> {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'rewind-owner-deploy', method: 'query',
      params: { request_type: requestType, finality: 'final', account_id: accountId } }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw Error('Public NEAR Mainnet RPC is not responding')
  const result = await response.json() as { error?: { message?: string }, result?: AccountState | KeyList }
  if (result.error || !result.result) throw Error(result.error?.message || 'Cannot verify Mainnet escrow account')
  return result.result
}

async function verifyCodeAndState() {
  const [state, keys] = await Promise.all([
    rpc('view_account', ESCROW) as Promise<AccountState>,
    rpc('view_access_key_list', ESCROW) as Promise<KeyList>,
  ])
  if (!keys.keys.some(k => k.access_key?.permission === 'FullAccess')) {
    throw Error('No FullAccess public key was found on escrow. Deployment blocked.')
  }
  if (state.code_hash !== NO_CODE && state.code_hash !== NEAR_CODE_HASH) {
    throw Error('An unexpected contract is already on the escrow account. Deployment blocked.')
  }
  const amount = BigInt(state.amount)
  const usedStorageStake = BigInt(state.storage_usage) * 10n ** 19n
  const neededStorageStake = usedStorageStake > BigInt(state.locked)
    ? usedStorageStake - BigInt(state.locked) : 0n
  const spendable = amount > neededStorageStake ? amount - neededStorageStake : 0n
  if (state.code_hash === NO_CODE && spendable < 35n * 10n ** 23n) {
    throw Error('Not enough escrow funding for the 219,854-byte WASM and operating reserve.')
  }
  return state.code_hash === NEAR_CODE_HASH ? 'deployed' : 'empty'
}

async function loadPinnedCode(): Promise<Uint8Array> {
  const response = await fetch(WASM_URL, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw Error('Verified contract bytecode could not be downloaded')
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength !== 219854) throw Error('Unexpected WASM size')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  const actual = Array.from(digest).map(n => n.toString(16).padStart(2, '0')).join('')
  if (actual !== CODE_SHA) throw Error('WASM hash mismatch. DO NOT sign this transaction.')
  return data
}

async function verifyInstalled() {
  const codeStatus = await verifyCodeAndState()
  if (codeStatus !== 'deployed') return 'The verified contract is not deployed yet.'
  const view = async (method: string) => {
    const response = await fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'rewind-owner-view',
        method: 'query', params: { request_type: 'call_function',
          finality: 'final', account_id: ESCROW, method_name: method, args_base64: 'e30=' } }),
      signal: AbortSignal.timeout(12000),
    })
    const out = await response.json() as { result?: { result: number[] }; error?: unknown }
    if (!response.ok || out.error || !out.result) throw Error('Could not verify deployed contract '+method)
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(out.result.result))) as unknown
  }
  const [owner, paused, reserved, fee] = await Promise.all([
    view('get_owner'), view('is_paused'), view('get_total_reserved'), view('get_storage_fee'),
  ])
  if (owner !== OWNER || paused !== true || reserved !== '0' || fee !== '20000000000000000000000') {
    throw Error('Deployed contract is NOT in the expected safe/paused state. Do not send deposits.')
  }
  return 'VERIFIED: contract deployed, correct owner, zero escrow reserved and public deposits PAUSED.'
}

export default function OwnerDeploy() {
  const [walletId, setWalletId] = useState('')
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Not connected. No deployment has been requested.')
  const [outcome, setOutcome] = useState('')

  const doCheck = useCallback(async () => {
    setBusy(true)
    try {
      const [state] = await Promise.all([verifyCodeAndState(), loadPinnedCode()])
      const deployed = await verifyInstalled()
      setReady(state === 'empty' && connected && walletId === ESCROW)
      setStatus(state === 'empty'
        ? 'Checked. Correct account, verified 219,854-byte WASM. Ready for your own wallet approval.'
        : deployed)
    } catch (e) { setReady(false); setStatus(String(e)) }
    finally { setBusy(false) }
  }, [connected, walletId])

  async function connect() {
    setBusy(true)
    try {
      const wallet = await connector.connect()
      const selected = await connector.getConnectedWallet()
      const id = selected.accounts[0]?.accountId || ''
      setWalletId(id)
      setConnected(true)
      setReady(false)
      setStatus(id === ESCROW
        ? 'Connected escrow wallet. Tap Verify deployment package before signing.'
        : 'WRONG ACCOUNT. Switch Meteor to ' + ESCROW + '. No signing enabled.')
      if (wallet.manifest.name) setOutcome('Connected: '+ wallet.manifest.name)
    } catch (e) { setStatus('Wallet connection failed: '+String(e)) }
    finally { setBusy(false) }
  }

  async function deploy() {
    if (!ready || !confirmed || busy || walletId !== ESCROW) return
    setBusy(true)
    setReady(false)
    try {
      // This check runs immediately before wallet signing. NEVER request keys.
      const remote = await verifyCodeAndState()
      if (remote !== 'empty') throw Error('Escrow already contains code. Deployment aborted.')
      const wasm = await loadPinnedCode()
      const connection = await connector.getConnectedWallet()
      if (connection.accounts[0]?.accountId !== ESCROW) throw Error('Wallet account switched. Signing blocked.')
      // Atomic deploy+initialize. No uninitialised contract gap.
      const actions: ConnectorAction[] = [
        { type: 'DeployContract', params: { code: wasm } },
        { type: 'FunctionCall', params: { methodName: 'new',
          args: { owner_id: OWNER }, gas: '50000000000000', deposit: '0' } },
      ]
      setStatus('Requesting approval in Meteor. Confirm signer and receiver are both ' + ESCROW)
      const wallet = await connector.wallet()
      const result = await wallet.signAndSendTransaction({
        network: 'mainnet',
        signerId: ESCROW,
        receiverId: ESCROW,
        actions,
      })
      if (result && typeof result === 'object' && 'transaction' in result) {
        const tx = (result as { transaction?: { hash?: string } }).transaction?.hash
        if (tx) setOutcome('Transaction: '+tx)
      }
      setStatus('Wallet request returned. Now verify final onchain state below.')
      try { setStatus(await verifyInstalled()) }
      catch { setStatus('Approval may still be pending. Tap Verify onchain status after returning from Meteor.') }
    } catch (e) { setStatus('No verified deployment: '+String(e)) }
    finally { setBusy(false); setConfirmed(false) }
  }

  async function postVerify() {
    setBusy(true)
    try { setStatus(await verifyInstalled()) }
    catch (e) { setStatus('Onchain verification failed: '+String(e)) }
    finally { setBusy(false) }
  }

  return (
    <main style={{ maxWidth: 580, padding: '32px 20px', margin: '24px auto',
      fontFamily: 'Manrope, system-ui, sans-serif', color: '#14291b' }}>
      <p style={{ letterSpacing: 2, fontSize: 12, fontWeight: 800 }}>REWIND / OWNER ONLY</p>
      <h1 style={{ fontSize: 34, lineHeight: 1.15 }}>Install paused Mainnet escrow</h1>
      <p>Contract account <strong>{ESCROW}</strong></p>
      <p>Owner / pause signer <strong>{OWNER}</strong></p>
      <section style={{ border: '1px solid #b7c9bd', borderRadius: 12, padding: 16 }}>
        <strong>NOT AUDITED. NOT A PUBLIC MAINNET LAUNCH.</strong>
        <p>This is a one-time deployment of the exact tested candidate. Its default state rejects ALL
          protected payments until a separate owner-approved unpause after independent audit.</p>
        <p>Deployment locks approximately 2.20 NEAR for code storage, plus gas and account state.
          Do not proceed if you cannot accept that cost.</p>
        <p style={{ overflowWrap: 'anywhere', fontSize: 12 }}>SHA256 {CODE_SHA}</p>
        <p style={{ overflowWrap: 'anywhere', fontSize: 12 }}>Expected NEAR code hash {NEAR_CODE_HASH}</p>
      </section>
      <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
        <button onClick={connect} disabled={busy}
          style={{ padding: 15, borderRadius: 10, background: '#0c4228', color: 'white' }}>
          {connected ? 'Reconnect wallet ('+walletId+')' : '1. Connect Meteor wallet'}
        </button>
        <button onClick={doCheck} disabled={busy || !connected || walletId !== ESCROW}
          style={{ padding: 15, borderRadius: 10 }}>
          2. Check wallet, code hash and escrow balance
        </button>
        {ready && <label style={{ display: 'flex', alignItems: 'start', gap: 10 }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          I understand this installs experimental code and locks NEAR for storage. I control
          {ESCROW}. Public payments must remain disabled.
        </label>}
        <button onClick={deploy} disabled={!ready || !confirmed || busy}
          style={{ padding: 15, borderRadius: 10, color: 'white',
            background: ready && confirmed ? '#145d39' : '#849088' }}>
          3. Request wallet approval to deploy + initialise (PAUSED)
        </button>
        <button onClick={postVerify} disabled={busy}
          style={{ padding: 15, borderRadius: 10 }}>Verify final status on NEAR Mainnet</button>
        <p role="status" style={{ padding: 16, borderRadius: 10, background: '#eaf4ef', overflowWrap: 'anywhere' }}>{status}</p>
        {outcome && <p style={{ overflowWrap: 'anywhere', fontSize: 12 }}>{outcome}</p>}
      </div>
      <p style={{ fontSize: 12, color: '#58675b' }}>This application never asks for recovery phrases, secret keys or seed words.
        If Meteor shows a different account, receiver or amount, reject the transaction.
        Wallet approval compatibility for DeployContract must be confirmed on your device.</p>
      <a href="/rewind/?network=testnet">Return to REWIND Testnet</a>
    </main>
  )
}
