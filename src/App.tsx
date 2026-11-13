import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  cancelTransfer,
  connectWallet,
  createTransfer,
  explorerTx,
  formatNear,
  getContractId,
  getNetworkId,
  getAccountId,
  releaseTransfer,
  signOut,
  viewAccountTransfers,
  viewTransfer,
} from './near'
import type { Transfer, TxState } from './types'
import { preflight, type Review } from '../sdk/index'

const initialTx: TxState = { kind: 'idle', message: '' }

function App() {
  const [accountId, setAccountId] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.1')
  const [review, setReview] = useState<Review | null>(null)
  const [savedRecipient, setSavedRecipient] = useState(() => localStorage.getItem('rewind-saved-recipient') || '')
  const [lookupId, setLookupId] = useState('')
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [history, setHistory] = useState<Transfer[]>([])
  const [tx, setTx] = useState<TxState>(initialTx)
  const [loading, setLoading] = useState(false)
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    getAccountId().then((id) => {
      setAccountId(id)
      if (id) viewAccountTransfers(id).then(setHistory).catch(() => setHistory([]))
    })
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!accountId) return
    const poll = window.setInterval(() => {
      void viewAccountTransfers(accountId).then(setHistory).catch(() => undefined)
      if (transfer?.id) void viewTransfer(transfer.id).then(setTransfer).catch(() => undefined)
    }, 5_000)
    return () => window.clearInterval(poll)
  }, [accountId, transfer?.id])

  const loadTransfer = useCallback(async (id = lookupId) => {
    if (!id.trim()) return
    setLoading(true)
    try {
      const found = await viewTransfer(id.trim())
      setTransfer(found)
      setLookupId(id.trim())
      if (!found) setTx({ kind: 'error', message: `Transfer #${id} was not found.` })
    } catch (error) {
      setTx({ kind: 'error', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [lookupId])

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    if (!accountId) return void connectWallet()
    setLoading(true)
    try {
      if (!review) {
        const inspected = await preflight({
          recipient, amountNear: amount, network: getNetworkId() === 'mainnet' ? 'mainnet' : 'testnet',
          contacts: savedRecipient.trim() ? [{ address: savedRecipient.trim() }] : [],
          recentRecipients: history.filter((item) => item.sender === accountId).map((item) => item.recipient),
        })
        setReview(inspected)
        if (!inspected.valid || inspected.warnings.length) {
          setTx({ kind: 'idle', message: '' })
          return
        }
      }
      setTx({ kind: 'wallet', message: 'Approve the protected payment in your NEAR wallet.' })
      const outcome = await createTransfer(recipient.trim().toLowerCase(), amount)
      const hash = outcome.transaction.hash
      setTx({ kind: 'confirmed', message: 'Payment accepted onchain. Your 60-second protection period is active.', hash })
      const id = findTransferId(outcome.receipts_outcome.flatMap((receipt: { outcome: { logs: string[] } }) => receipt.outcome.logs))
      if (id) await loadTransfer(id)
      if (accountId) setHistory(await viewAccountTransfers(accountId))
      setReview(null)
    } catch (error) {
      setTx({ kind: 'error', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function settle(action: 'cancel' | 'release') {
    if (!transfer) return
    if (!accountId) return connectWallet()
    setLoading(true)
    setTx({
      kind: 'wallet',
      message: action === 'cancel'
        ? 'Approve the cancellation in your NEAR wallet. Your refund is not final until the contract callback succeeds.'
        : 'Approve release in your NEAR wallet. Funds can only be sent to the named recipient.',
    })
    try {
      const outcome = action === 'cancel'
        ? await cancelTransfer(transfer.id)
        : await releaseTransfer(transfer.id)
      const current = await viewTransfer(transfer.id)
      setTransfer(current)
      if (current && current.status === (action === 'cancel' ? 'Cancelled' : 'Released')) {
        setTx({
          kind: 'confirmed',
          message: action === 'cancel' ? 'Refund confirmed onchain.' : 'Delivery confirmed onchain.',
          hash: outcome.transaction.hash,
        })
      } else if (current?.status === 'RefundFailed' || current?.status === 'DeliveryFailed') {
        setTx({ kind: 'error', message: 'Payout failed onchain. Funds remain claimable in REWIND; use the available refund or retry action.', hash: outcome.transaction.hash })
      } else {
        setTx({ kind: 'submitted', message: 'Settlement is being verified. Check the onchain status.', hash: outcome.transaction.hash })
      }
      setHistory(await viewAccountTransfers(accountId))
    } catch (error) {
      setTx({ kind: 'error', message: errorMessage(error) })
      await loadTransfer(transfer.id)
    } finally {
      setLoading(false)
    }
  }

  const remaining = useMemo(() => {
    if (!transfer) return ''
    const delta = Number(transfer.expires_at_ms) - clock
    if (delta <= 0) return 'Recovery window ended'
    const seconds = Math.ceil(delta / 1_000)
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s left to cancel`
  }, [clock, transfer])

  const canCancel = accountId === transfer?.sender && ((transfer?.status === 'RefundFailed' || transfer?.status === 'DeliveryFailed') || (transfer?.status === 'Pending' && clock < Number(transfer.expires_at_ms)))
  const canRelease = (transfer?.status === 'Pending' || transfer?.status === 'DeliveryFailed') && clock >= Number(transfer.expires_at_ms)

  return (
    <main>
      <nav>
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="REWIND home"><span className="brand-mark">↶</span> REWIND <b>NEAR</b></a>
        <div className="nav-links"><a href="#how-it-works">How it works</a><a href="#app">Use REWIND</a></div>
        <div className="network"><i /> {getNetworkId()}</div>
        {accountId
          ? <button className="wallet" onClick={signOut}>{short(accountId)} · disconnect</button>
          : <button className="wallet" onClick={connectWallet}>Connect NEAR wallet</button>}
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Protected transfers on NEAR</p>
          <h1>Send NEAR with<br /><em>time to fix a mistake.</em></h1>
          <p className="lede">REWIND checks for common address mistakes before you send. After a protected payment is accepted onchain, you have 60 seconds to cancel if you spot an error. Otherwise, delivery follows automatically.</p>
          <div className="hero-actions">
            <a className="button primary" href="#app">Make a protected transfer <span>→</span></a>
            <a className="button secondary" href="#how-it-works">See how it works <span>↓</span></a>
          </div>
          <p className="testnet-note"><i /> Live on NEAR Testnet · Use test tokens only</p>
        </div>

        <div className="hero-demo" aria-label="Illustrative transfer, not a live payment">
          <div className="demo-top"><span>Protected transfer</span><strong>RECOVERY ACTIVE</strong></div>
          <div className="demo-amount"><small>SENDING</small><b>8.40</b><span>NEAR</span></div>
          <div className="demo-route"><span>you.testnet</span><i>→</i><span>recipient.testnet</span></div>
          <div className="demo-window">
            <div className="demo-clock">00:42</div>
            <div><strong>Time left to cancel</strong><span>Recipient has not received the funds yet</span></div>
          </div>
          <div className="demo-buttons"><span>Cancel transfer</span><span>Waiting to release</span></div>
          <div className="orbit orbit-one">↶</div><div className="orbit orbit-two">✓</div>
        </div>
      </header>

      <section className="proof-bar" aria-label="REWIND safeguards">
        <div><span>01</span><strong>Onchain payment protection</strong></div>
        <div><span>02</span><strong>Sender-only cancellation</strong></div>
        <div><span>03</span><strong>Callback-confirmed settlement</strong></div>
      </section>

      <section className="problem">
        <p className="section-kicker">Why REWIND</p>
        <div className="problem-grid">
          <h2>Crypto transfers are final.<br /><em>Human mistakes are normal.</em></h2>
          <div>
            <p>A mistyped account or rushed payment should not become a permanent loss in seconds. REWIND adds a deliberate pause before delivery, giving the sender a clear chance to catch an error.</p>
            <p className="fine-print">REWIND cannot reverse funds that have already been released. Protection applies only to transfers created through the REWIND contract and only during the first 60 seconds.</p>
          </div>
        </div>
      </section>

      <section className="walkthrough" id="how-it-works">
        <div className="section-heading">
          <div><p className="section-kicker">The walkthrough</p><h2>From send to settled,<br />without the guesswork.</h2></div>
          <p>Four transparent steps. Every state comes from the smart contract—not from a fake progress screen.</p>
        </div>
        <div className="steps">
          <article><span>01</span><div className="step-icon">◎</div><h3>Check recipient and amount</h3><p>REWIND checks for detectable mistakes before the wallet asks you to approve.</p></article>
          <article><span>02</span><div className="step-icon">◇</div><h3>Send through REWIND</h3><p>Approve the payment in your usual NEAR wallet. REWIND applies the short protection period onchain.</p></article>
          <article><span>03</span><div className="step-icon">↶</div><h3>Catch a mistake</h3><p>Wrong recipient or wrong amount? Only the original sender can cancel before the deadline and receive the refund.</p></article>
          <article><span>04</span><div className="step-icon">✓</div><h3>Deliver with certainty</h3><p>After the 60-second window ends, delivery sends the funds only to the named recipient. A contract callback confirms the result.</p></article>
        </div>
      </section>

      <section className="app-intro" id="app">
        <div><p className="section-kicker">Try the protocol</p><h2>Protect your next transfer.</h2></div>
        <p>Connected to {getNetworkId()}. Start with a small test amount and verify the recipient carefully.</p>
      </section>

      <section className="workspace">
        <form className="panel create" onSubmit={submitCreate}>
          <div className="panel-title"><span>CREATE</span><div><h2>Send NEAR</h2><p>Review the recipient and amount before sending.</p></div></div>
          <label>Recipient NEAR account<input required value={recipient} onChange={(e) => { setRecipient(e.target.value); setReview(null) }} placeholder="friend.testnet" /></label>
          <div className="row">
            <label>Amount<input required min="0.00001" step="any" type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null) }} /><b>NEAR</b></label>

          </div>
          <details className="contact-options"><summary>Optional: compare against a saved recipient</summary>
            <input aria-label="Saved recipient to compare" value={savedRecipient} onChange={(e) => { setSavedRecipient(e.target.value); localStorage.setItem('rewind-saved-recipient', e.target.value); setReview(null) }} placeholder="e.g. alice.testnet" />
          </details>
          {review && <div className="preflight-review" role="status">
            <strong>{review.warnings.length ? 'Please check these details' : 'Recipient check completed'}</strong>
            {review.warnings.map((warning, index) => <p key={index}>{warning.message}</p>)}
            {!review.valid && <p>Correct the recipient to proceed.</p>}
          </div>}
          <button className="primary form-submit" disabled={loading || (review !== null && !review.valid)}>{accountId ? (review ? 'Confirm and send NEAR' : 'Send NEAR') : 'Connect wallet to begin'} <span>→</span></button>
          <small className="form-help">Protected by REWIND. You can cancel within 60 seconds after sending, before delivery.</small>
        </form>

        <div className="panel inspect">
          <div className="panel-title"><span>TRACK</span><div><h2>Transfer status</h2><p>Read live state directly from the contract.</p></div></div>
          <form className="search" onSubmit={(e) => { e.preventDefault(); void loadTransfer() }}>
            <input aria-label="Transfer ID" inputMode="numeric" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Enter transfer ID" />
            <button disabled={loading}>Check status</button>
          </form>
          {transfer ? (
            <article className="card">
              <div className="card-head"><span>TRANSFER #{transfer.id}</span><strong data-status={transfer.status}>{statusLabel(transfer.status)}</strong></div>
              <div className="amount">{formatNear(transfer.amount)} <small>NEAR</small></div>
              <dl>
                <div><dt>Sender</dt><dd>{transfer.sender}</dd></div>
                <div><dt>Recipient</dt><dd>{transfer.recipient}</dd></div>
                <div><dt>Window</dt><dd>{remaining}</dd></div>
              </dl>
              {['Refunding', 'Releasing'].includes(transfer.status) && <p className="pending">Settlement is still processing. Funds are not final until the callback succeeds.</p>}
              <div className="actions">
                <button onClick={() => settle('cancel')} disabled={!canCancel || loading}>Cancel &amp; refund</button>
                <button onClick={() => settle('release')} disabled={!canRelease || loading}>Retry delivery</button>
              </div>
            </article>
          ) : <div className="empty"><span>⌁</span><p>Have a transfer ID?</p><small>Enter it above to see the live onchain status and available actions.</small></div>}
        </div>
      </section>

      {accountId && <section className="history">
        <div className="panel-title"><span>HISTORY</span><div><h2>Your protected transfers</h2><p>Real records associated with your connected account.</p></div></div>
        {history.length ? <div className="history-grid">{history.map((item) => <button key={item.id} onClick={() => void loadTransfer(item.id)}>
          <span>#{item.id}</span><strong>{formatNear(item.amount)} NEAR</strong><em>{statusLabel(item.status)}</em><small>{item.sender === accountId ? `to ${short(item.recipient)}` : `from ${short(item.sender)}`}</small>
        </button>)}</div> : <p className="history-empty">No REWIND transfers found for this account.</p>}
      </section>}

      <section className="clarity">
        <div className="clarity-title"><p className="section-kicker">Built for clarity</p><h2>Protection you can verify.</h2></div>
        <div className="clarity-grid">
          <article><span>↶</span><h3>A short moment to correct mistakes</h3><p>Only the wallet that created the transfer can cancel it, and only during the first 60 seconds.</p></article>
          <article><span>→</span><h3>Funds cannot be rerouted</h3><p>After the 60-second period, delivery can only pay the recipient named when the transfer was created.</p></article>
          <article><span>✓</span><h3>Success means onchain success</h3><p>The interface waits for the contract’s settlement callback. A submitted wallet request is never presented as final.</p></article>
        </div>
      </section>

      <section className="final-cta">
        <div><p className="section-kicker">A safer default for NEAR</p><h2>Give every transfer<br /><em>a way back.</em></h2></div>
        <a className="button primary" href="#app">Try REWIND on Testnet <span>↑</span></a>
      </section>

      {tx.kind !== 'idle' && <aside className={`toast ${tx.kind}`}><button onClick={() => setTx(initialTx)}>×</button><strong>{tx.kind === 'error' ? 'Not confirmed' : 'Transaction status'}</strong><p>{tx.message}</p>{tx.hash && <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View {short(tx.hash)} on NEAR explorer ↗</a>}</aside>}

      <footer><a className="brand footer-brand" href={import.meta.env.BASE_URL}><span className="brand-mark">↶</span> REWIND</a><div><span>Network: {getNetworkId()}</span><span>Contract: {getContractId() || 'not configured'}</span></div><p>Experimental, unaudited Testnet software.<br />Do not use Mainnet funds.</p></footer>
    </main>
  )
}

function statusLabel(status: Transfer['status']) {
  const labels: Record<Transfer['status'], string> = {
    Pending: 'Protected',
    Refunding: 'Refunding',
    RefundFailed: 'Refund failed — retry available',
    DeliveryFailed: 'Delivery failed — refund or retry available',
    Releasing: 'Releasing',
    Cancelled: 'Refunded',
    Released: 'Delivered',
  }
  return labels[status]
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function findTransferId(logs: string[]) {
  const log = logs.find((item) => item.startsWith('TRANSFER_CREATED:'))
  return log?.split(':')[1]
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.includes('User rejected') ? 'Wallet request was rejected. No onchain change was made.' : error.message
  return 'The transaction was not confirmed. Check your wallet and try again.'
}

export default App
