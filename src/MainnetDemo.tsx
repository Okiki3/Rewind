import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  cancelTransfer, connectWallet, createTransfer, explorerAccount, explorerTx,
  formatNear, getAccountId, getContractId, releaseTransfer, viewAccountTransfers,
  viewTransfer,
} from './near'
import { preflight } from '../sdk/index'
import type { Transfer } from './types'

const RPC = 'https://rpc.mainnet.fastnear.com'
const HASH = 'BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW'
const CONTRACT = 'afrolite-rewind-261114.near'
const fee = 0.02

async function verifyReady() {
  const query = async (request_type: string, method_name?: string): Promise<unknown> => {
    const response = await fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', id:'rewind-mainnet-demo', method:'query',
        params:method_name
          ? { request_type:'call_function', account_id:CONTRACT, finality:'final', method_name, args_base64:'e30=' }
          : { request_type, account_id:CONTRACT, finality:'final' } }),
    })
    const payload = await response.json() as {
      result?: { code_hash?: string, result?: number[] }, error?: { message?: string }
    }
    if (!response.ok || payload.error || !payload.result) {
      throw Error(payload.error?.message || 'Unable to verify Mainnet account')
    }
    return method_name
      ? JSON.parse(new TextDecoder().decode(new Uint8Array(payload.result.result || []))) as unknown
      : payload.result
  }
  const state = await query('view_account') as {code_hash?: string}
  if (state.code_hash !== HASH) throw Error('Contract code hash mismatch. Payments blocked.')
  const owner = await query('call_function','get_owner')
  if (owner !== 'afrolite.near') throw Error('Mainnet contract owner mismatch. Payments blocked.')
  const paused = await query('call_function','is_paused')
  return paused !== true
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export default function MainnetDemo() {
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [wallet, setWallet] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.01')
  const [consent, setConsent] = useState(false)
  const [review, setReview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [hash, setHash] = useState('')
  const [records, setRecords] = useState<Transfer[]>([])
  const [now, setNow] = useState(Date.now())

  const refreshWallet = useCallback(async () => {
    try {
      const id = await getAccountId()
      setWallet(id)
      return id
    } catch (err) { setNotice(errorMessage(err)); return '' }
  }, [])

  const loadHistory = useCallback(async (id: string) => {
    if (!id) return
    try {
      const found = await viewAccountTransfers(id)
      setRecords(found)
    } catch (err) { setNotice('History refresh: ' + errorMessage(err)) }
  }, [])

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      const enabled = await verifyReady()
      setReady(enabled)
      setNotice(enabled ? '' : 'The Mainnet contract is paused. No payments are accepted.')
    } catch (err) { setReady(false); setNotice(errorMessage(err)) }
    finally { setChecking(false) }
  }, [])

  useEffect(() => {
    void recheck()
    void refreshWallet()
  }, [recheck,refreshWallet])

  useEffect(() => {
    if (!wallet) return
    void loadHistory(wallet)
    const timer = window.setInterval(() => {
      void loadHistory(wallet)
      setNow(Date.now())
    }, 6000)
    return () => window.clearInterval(timer)
  }, [wallet,loadHistory])

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!consent || !ready || !wallet) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 0.01 || value > 0.1) {
      setNotice('Use 0.01 to 0.1 NEAR. Add a separate, non-refundable 0.02 NEAR storage fee.')
      return
    }
    setBusy(true)
    try {
      const inspected = await preflight({ recipient, amountNear:amount, network:'mainnet' })
      if (!inspected.valid) throw Error('Recipient verification failed; double-check the account.')
      if (!review || review !== `${recipient.trim().toLowerCase()}:${amount}`) {
        setReview(`${recipient.trim().toLowerCase()}:${amount}`)
        setNotice('Reviewed. Check the recipient and total fee, then tap Confirm protected payment.')
        return
      }
      setNotice('Approve the FunctionCall in your wallet. Do not close the wallet until confirmation.')
      const outcome = await createTransfer(recipient.trim().toLowerCase(), amount)
      const tx = outcome.transaction?.hash || ''
      setHash(tx)
      setNotice('Payment submitted to Mainnet. Waiting for onchain transfer record.')
      await loadHistory(wallet)
      setReview(null)
    } catch (err) { setNotice(errorMessage(err)) }
    finally { setBusy(false) }
  }

  async function settle(transfer: Transfer, cancel: boolean) {
    setBusy(true)
    try {
      const outcome = cancel ? await cancelTransfer(transfer.id) : await releaseTransfer(transfer.id)
      if (outcome.transaction?.hash) setHash(outcome.transaction.hash)
      const updated = await viewTransfer(transfer.id)
      if (updated) setRecords(old => old.map(t => t.id === updated.id ? updated : t))
      setNotice(cancel ? 'Refund submitted; watch for onchain Cancelled confirmation.' :
        'Release requested; watch for onchain Released confirmation.')
    } catch (err) { setNotice(errorMessage(err)) }
    finally { setBusy(false) }
  }

  return <div style={{maxWidth:880,margin:'0 auto',padding:'20px 16px 56px'}}>
    <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
      <a href="/rewind/?network=testnet" style={{fontWeight:800}}>REWIND</a>
      <a href="/rewind/?network=mainnet">Mainnet contract overview</a>
    </header>
    <section className="hero" style={{padding:'28px 0'}}>
      <p className="section-kicker">Experimental · NEAR Mainnet · Hackathon demonstration</p>
      <h1>Try a real protected NEAR payment.</h1>
      <p>0.01–0.10 NEAR per transfer. The contract adds a 0.02 NEAR non-refundable storage fee. This experimental, unaudited contract can lose or delay funds. Use only amounts you accept losing.</p>
      <p><a href={explorerAccount(CONTRACT)} target="_blank" rel="noreferrer">{CONTRACT}</a></p>
    </section>
    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h2>Mainnet readiness</h2>
      <p role="status">{checking ? 'Verifying code hash, owner and pause state…' :
        ready ? 'Verified: correct Mainnet contract, owner and unpaused.' :
        'Not ready: contract is paused or could not be verified. Payments blocked.'}</p>
      <button type="button" onClick={()=>void recheck()} disabled={busy||checking}>Recheck contract</button>
    </section>
    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h2>Connect your Mainnet wallet</h2>
      <p>{wallet ? `Connected: ${wallet}` : 'No Mainnet wallet connected.'}</p>
      <button type="button" onClick={()=>void connectWallet().catch(e=>setNotice(errorMessage(e)))} disabled={busy}>Connect wallet</button>{' '}
      <button type="button" onClick={()=>void refreshWallet()} disabled={busy}>Refresh connection</button>
    </section>
    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h2>Make a protected payment</h2>
      <form onSubmit={e=>void prepare(e)}>
        <label>Recipient (existing Mainnet account)<input value={recipient} onChange={e=>{setRecipient(e.target.value);setReview(null)}} placeholder="recipient.near" required /></label>
        <label>Payment amount (NEAR)<input type="number" inputMode="decimal" min="0.01" max="0.1" step="0.01" value={amount} onChange={e=>{setAmount(e.target.value);setReview(null)}} required /></label>
        <p>Payment: <strong>{amount} NEAR</strong> · non-refundable storage: <strong>0.02 NEAR</strong> · attached to contract: <strong>{(Number(amount)+fee).toFixed(2)} NEAR</strong></p>
        <label style={{display:'flex',gap:10,alignItems:'start'}}>
          <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} style={{width:'auto'}} />
          I understand this unaudited hackathon contract holds real NEAR, the 0.02 NEAR fee is never refunded, and recovery/delivery cannot be guaranteed.
        </label>
        <button className="primary form-submit" disabled={!ready||busy||!wallet||!consent}>
          {busy?'Working…':review?'Confirm protected payment':'Review payment'}
        </button>
      </form>
    </section>
    <section className="panel" style={{padding:20,marginBottom:16}} aria-live="polite">
      <h2>Transaction status</h2>
      {notice && <p role="status">{notice}</p>}
      {hash && <p>Transaction: <a href={explorerTx(hash)} target="_blank" rel="noreferrer">{hash}</a></p>}
      <p>After signing, your new transfer is fetched from the blockchain automatically. A 60-second deadline starts when the contract accepts the payment, not when the browser displays it.</p>
      <button type="button" disabled={!wallet||busy} onClick={()=>void loadHistory(wallet)}>Refresh onchain history</button>
      {records.length === 0 && <p>No transfers found for this wallet yet.</p>}
      {records.map(t => {
        const seconds=Math.max(0,Math.ceil((Number(t.expires_at_ms)-now)/1000))
        return <article key={t.id} style={{borderTop:'1px solid #858585',padding:'12px 0'}}>
          <strong>TRANSFER #{t.id}</strong> · <strong>{t.status}</strong>
          <p>{formatNear(t.amount)} NEAR · {t.sender} → {t.recipient}</p>
          <p>{t.status==='Pending' ? (seconds ? `${seconds}s left to cancel` : 'Protection window ended; delivery may still be pending') : 'Onchain status: '+t.status}</p>
          {t.status==='Pending' && seconds>0 && t.sender===wallet &&
            <button type="button" disabled={busy} onClick={()=>void settle(t,true)}>Cancel and refund payment</button>}
          {t.status==='RefundFailed' && t.sender===wallet &&
            <button type="button" disabled={busy} onClick={()=>void settle(t,true)}>Retry failed refund</button>}
          {(t.status==='Pending' && seconds===0 || t.status==='DeliveryFailed') &&
            <button type="button" disabled={busy} onClick={()=>void settle(t,false)}>Request delivery manually</button>}
        </article>
      })}
    </section>
    <p style={{opacity:.75}}>The automatic keeper is a separate service. If offline, expired payments can still be released manually. Do not send normal NEAR transfers directly to this contract; only use the protected payment method above.</p>
  </div>
}
