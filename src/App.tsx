import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  cancelTransfer,
  connectWallet,
  createTransfer,
  explorerTx,
  formatNear,
  getContractId,
  getNetworkId,
  getAccountId,
  getSelectedWalletName,
  prepareWalletApproval,
  finishWalletApproval,
  releaseTransfer,
  signOut,
  viewAccountTransfers,
  viewTransfer,
} from './near'
import type { Transfer, TxState } from './types'
import { preflight, isNearAccountId, parseNearAmount, type Review } from '../sdk/index'
import {
  identifyCreatedPayment, findNewTransfer, recordKey, loadPaymentRecords,
  storePaymentHash, formatPaymentTime,
} from './transfer-records'
import { findHistoricalHashes } from './explorer-history'

const initialTx: TxState = { kind: 'idle', message: '' }

const SDK_SNIPPET = [
  "import { preflight, buildProtectedSendTransaction }",
  "  from 'https://afrolitehub.com/rewind/sdk/index.js'",
  "",
  "const savedContacts = [] // From the wallet address book",
  "const review = await preflight({",
  "  network: 'testnet',",
  "  recipient: 'winner.testnet',",
  "  amountNear: '1',",
  "  contacts: savedContacts,",
  "})",
  "// Show review.warnings and confirm with the sender.",
  "if (!review.valid) throw new Error('Check the recipient')",
  "",
  "const tx = buildProtectedSendTransaction(",
  "  'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet',",
  "  review.recipient, '1'",
  ")",
  "// Your wallet signs this NEAR FunctionCall transaction.",
].join('\n')

function App() {
  const [accountId, setAccountId] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.1')
  const [review, setReview] = useState<Review | null>(null)
  const [savedRecipient, setSavedRecipient] = useState(() => localStorage.getItem('rewind-saved-recipient') || '')
  const [threshold, setThreshold] = useState(() => localStorage.getItem('rewind-threshold-near') || '')
  const [lookupId, setLookupId] = useState('')
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null)
  const [trackingNewPayment, setTrackingNewPayment] = useState(false)
  const [paymentHashes, setPaymentHashes] = useState<Record<string, string>>({})
  const [pendingHash, setPendingHash] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  const trackGeneration = useRef(0)
  const lastExplorerCheck = useRef<Record<string, number>>({})
  const [history, setHistory] = useState<Transfer[]>([])
  const [tx, setTx] = useState<TxState>(initialTx)
  const [loading, setLoading] = useState(false)
  const [copiedSdk, setCopiedSdk] = useState(false)
  const [clock, setClock] = useState(Date.now())

  const localRecordsKey = useMemo(() => recordKey(getNetworkId(), getContractId(), accountId), [accountId])

  const selectActive = useCallback((id: string, snapshot: Transfer | null = null) => {
    activeRef.current = id
    setActiveTransferId(id)
    setLookupId(id)
    setTransfer(snapshot)
    setTrackingNewPayment(snapshot === null)
    if (accountId) {
      try { localStorage.setItem(localRecordsKey + ':last', id) } catch { /* Storage is optional. */ }
    }
  }, [accountId, localRecordsKey])

  useEffect(() => {
    void getAccountId().then(setAccountId).catch(() => undefined)
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    const accountTimer = window.setInterval(() => {
      void getAccountId().then((id) => setAccountId((old) => id === old ? old : id)).catch(() => undefined)
    }, 1_500)
    return () => { window.clearInterval(timer); window.clearInterval(accountTimer) }
  }, [])

  useEffect(() => {
    // Transaction creation hashes are not stored in the onchain Transfer
    // struct. Browser-side records are scoped per network, contract and wallet.
    setPaymentHashes(loadPaymentRecords(localStorage, localRecordsKey))
    setPendingHash(null)
    setTransfer(null)
    setActiveTransferId(null)
    setTrackingNewPayment(false)
    activeRef.current = null
    trackGeneration.current += 1
    if (!accountId) { setHistory([]); return }
    try {
      const last = localStorage.getItem(localRecordsKey + ':last')
      if (last && /^\d+$/.test(last)) {
        activeRef.current = last
        setActiveTransferId(last)
        setLookupId(last)
        setTrackingNewPayment(true)
      }
    } catch { /* Browser storage can be disabled. */ }
  }, [accountId, localRecordsKey])

  useEffect(() => {
    if (!accountId && !activeTransferId) return
    let alive = true
    const poll = async () => {
      if (accountId) {
        try {
          const latest = await viewAccountTransfers(accountId)
          if (alive) setHistory(latest)
        } catch { /* A transient RPC issue must not delete displayed history. */ }
      }
      if (activeTransferId) {
        try {
          const onchain = await viewTransfer(activeTransferId)
          if (alive && activeRef.current === activeTransferId && onchain) {
            setTransfer(onchain)
            setTrackingNewPayment(false)
          }
        } catch { /* Keep the last verified state while RPC is unavailable. */ }
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 3_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [accountId, activeTransferId])

  useEffect(() => {
    if (!accountId || !history.length) return
    const missing = history.filter((entry) => entry.sender === accountId && !paymentHashes[entry.id])
    if (!missing.length) return
    const now = Date.now()
    if (now - (lastExplorerCheck.current[accountId] || 0) < 60_000) return
    lastExplorerCheck.current[accountId] = now
    let cancelled = false
    // Recent onchain transfer records do not carry their creation tx hash.
    // Use a public indexer for old payments; only accept unambiguous matches.
    void findHistoricalHashes(accountId, missing, getContractId(), getNetworkId())
      .then((found) => {
        if (cancelled || !Object.keys(found).length) return
        let records = loadPaymentRecords(localStorage, localRecordsKey)
        for (const [id, hash] of Object.entries(found)) {
          records = storePaymentHash(localStorage, localRecordsKey, id, hash)
        }
        setPaymentHashes(records)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [accountId, history, paymentHashes, localRecordsKey])

  const loadTransfer = useCallback(async (id = lookupId) => {
    const selected = id.trim()
    if (!/^\d+$/.test(selected)) {
      setTx({ kind: 'error', message: 'Enter a valid transfer number.' })
      return
    }
    const generation = ++trackGeneration.current
    setLoading(true)
    try {
      const found = await viewTransfer(selected)
      if (generation !== trackGeneration.current) return
      if (found) {
        selectActive(selected, found)
      } else {
        setTx({ kind: 'error', message: `Transfer #${selected} was not found.` })
      }
    } catch (error) {
      if (generation === trackGeneration.current) setTx({ kind: 'error', message: errorMessage(error) })
    } finally {
      if (generation === trackGeneration.current) setLoading(false)
    }
  }, [lookupId, selectActive])

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
          warnAboveNear: threshold.trim() && Number(threshold) > 0 ? threshold.trim() : undefined,
        })
        setReview(inspected)
        // Always show the reviewed recipient and amount before wallet signing,
        // even if there were no detected warnings.
        setTx({ kind: 'idle', message: '' })
        return
      }
      if (!review.valid || review.recipient !== recipient.trim().toLowerCase()) {
        setReview(null)
        setTx({ kind: 'error', message: 'Please review the recipient again before sending.' })
        return
      }
      const known = new Set(history.map((entry) => entry.id))
      const submittedAt = Date.now()
      // Open a named wallet window during the click itself. MyNearWallet
      // performs asynchronous RPC work before attempting to show its popup.
      const popup = prepareWalletApproval()
      let outcome: Awaited<ReturnType<typeof createTransfer>>
      try {
        setTx({ kind: 'wallet', message: 'Submitting through ' + getSelectedWalletName() + '. Your wallet may use an existing signing permission or request confirmation. Check your activity before retrying.' })
        outcome = await createTransfer(recipient.trim().toLowerCase(), amount)
      } finally {
        finishWalletApproval(popup)
      }
      const created = identifyCreatedPayment(outcome)
      const hash = created.hash || outcome.transaction.hash
      // Wallet approval and contract execution are complete here. A follow-up
      // RPC request must never hold the countdown card or undo button hostage.
      setTx({ kind: 'confirmed', message: 'Payment accepted onchain. The 60-second protection window is active.', hash })
      setPendingHash(hash)
      setReview(null)
      const generation = ++trackGeneration.current
      const sentRecipient = recipient.trim().toLowerCase()
      const sentYocto = parseNearAmount(amount)

      const showNewPayment = (id: string, record: Transfer | null) => {
        if (generation !== trackGeneration.current) return
        selectActive(id, record)
        if (hash) {
          try {
            setPaymentHashes(storePaymentHash(localStorage, localRecordsKey, id, hash))
          } catch { /* The transaction remains confirmed even without local storage. */ }
        }
        if (record) setHistory((items) => [record, ...items.filter((entry) => entry.id !== id)])
        setPendingHash(null)
      }

      if (created.id) showNewPayment(created.id, created.transfer)
      else {
        activeRef.current = null
        setActiveTransferId(null)
        setTransfer(null)
        setTrackingNewPayment(true)
      }

      // Wallet adapters can omit both the JSON return and event logs.
      // In that case, match a unique fresh record to the exact payment.
      // Never guess the transfer number or re-submit the transaction.
      void (async () => {
        if (created.id && created.transfer) return
        for (let attempt = 0; attempt < 8; attempt++) {
          if (generation !== trackGeneration.current) return
          try {
            if (created.id) {
              const current = await viewTransfer(created.id)
              if (current && generation === trackGeneration.current) {
                showNewPayment(created.id, current)
                return
              }
            } else {
              const latest = await viewAccountTransfers(accountId)
              if (generation !== trackGeneration.current) return
              setHistory(latest)
              const matched = findNewTransfer(latest, known, accountId, sentRecipient, sentYocto, submittedAt)
              if (matched) {
                showNewPayment(matched.id, matched)
                return
              }
            }
          } catch { /* Network indexing can be delayed; continue read-only lookups. */ }
          await new Promise((resolve) => window.setTimeout(resolve, 1_000))
        }
        if (generation === trackGeneration.current && !created.id) {
          setTrackingNewPayment(false)
          setTx({
            kind: 'confirmed',
            message: 'Payment confirmed, but the transfer ID is not available yet. Check your payment hash on the explorer; do not resend.',
            hash,
          })
        }
      })()
    } catch (error) {
      setTx({ kind: 'error', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function copySdkExample() {
    try {
      await navigator.clipboard.writeText(SDK_SNIPPET)
      setCopiedSdk(true)
    } catch {
      setCopiedSdk(false)
    }
  }

  async function settle(action: 'cancel' | 'release') {
    if (!transfer) return
    if (!accountId) return connectWallet()
    const transferId = transfer.id
    setLoading(true)
    let outcome: Awaited<ReturnType<typeof cancelTransfer>>
    try {
      const popup = prepareWalletApproval()
      try {
        setTx({
          kind: 'wallet',
          message: action === 'cancel'
            ? 'Review the cancellation in your NEAR wallet. A refund is final only when confirmed onchain.'
            : 'Review the delivery request in your NEAR wallet.',
        })
        outcome = action === 'cancel' ? await cancelTransfer(transferId) : await releaseTransfer(transferId)
      } finally {
        finishWalletApproval(popup)
      }
    } catch (error) {
      setTx({ kind: 'error', message: errorMessage(error) })
      setLoading(false)
      return
    }
    const hash = outcome.transaction.hash
    setTx({ kind: 'submitted', message: 'Wallet transaction submitted. Checking the blockchain settlement result.', hash })
    try {
      const current = await viewTransfer(transferId)
      if (current && activeRef.current === transferId) setTransfer(current)
      if (current?.status === (action === 'cancel' ? 'Cancelled' : 'Released')) {
        setTx({
          kind: 'confirmed',
          message: action === 'cancel' ? 'Refund confirmed onchain.' : 'Delivery confirmed onchain.',
          hash,
        })
      } else if (current?.status === 'RefundFailed' || current?.status === 'DeliveryFailed') {
        setTx({ kind: 'error', message: 'The settlement failed onchain. Use the refund or retry option if available.', hash })
      }
    } catch {
      // A read-only RPC outage after wallet submission is NOT a failed
      // transaction. Preserve the hash and allow background polling to refresh.
      setTx({ kind: 'submitted', message: 'Request submitted. The network status is temporarily unavailable. Check the transaction hash before retrying.', hash })
    }
    try { setHistory(await viewAccountTransfers(accountId)) } catch { /* Polling will retry. */ }
    setLoading(false)
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
        <div className="nav-links"><a href="#how-it-works">How it works</a><a href="#app">Send NEAR</a><a href="#developers">SDK</a></div>
        <div className="network"><i /> {getNetworkId()}</div>
        {accountId
          ? <button className="wallet" onClick={signOut}>{short(accountId)} · disconnect</button>
          : <button className="wallet" onClick={() => { void connectWallet().catch((error: unknown) => setTx({ kind: 'error', message: errorMessage(error) })) }}>Connect NEAR wallet</button>}
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Extra protection for NEAR payments</p>
          <h1>Send NEAR.<br /><em>With a safety net.</em></h1>
          <p className="lede">REWIND checks for possible address mistakes before you approve a payment. If you notice a wrong recipient or amount after sending, you have <strong>60 seconds to cancel</strong>. Otherwise, the payment is delivered automatically.</p>
          <div className="hero-actions">
            <a className="button primary" href="#app">Send NEAR <span>→</span></a>
            <a className="button secondary" href="#how-it-works">See how it works <span>↓</span></a>
          </div>
          <p className="testnet-note"><i /> Live on NEAR Testnet · Use test tokens only</p>
        </div>

        <div className="hero-demo" aria-label="Illustrative transfer, not a live payment">
          <div className="demo-top"><span>Example NEAR payment</span><strong>60S PROTECTION</strong></div>
          <div className="demo-amount"><small>SENDING</small><b>8.40</b><span>NEAR</span></div>
          <div className="demo-route"><span>you.testnet</span><i>→</i><span>recipient.testnet</span></div>
          <div className="demo-window">
            <div className="demo-clock">00:42</div>
            <div><strong>Protection window</strong><span>A moment to correct a mistake</span></div>
          </div>
          <div className="demo-buttons"><span>Recipient reviewed</span><span>Auto-delivery next</span></div>
          <div className="orbit orbit-one">↶</div><div className="orbit orbit-two">✓</div>
        </div>
      </header>

      <section className="proof-bar" aria-label="REWIND safeguards">
        <div><span>01</span><strong>Recipient address checks</strong></div>
        <div><span>02</span><strong>60 seconds to cancel</strong></div>
        <div><span>03</span><strong>Integrates with NEAR wallets</strong></div>
      </section>

      <section className="problem">
        <p className="section-kicker">The problem</p>
        <div className="problem-grid">
          <h2>One wrong character.<br /><em>One extra zero.</em></h2>
          <div>
            <p>Sending to a lookalike address or typing 10 NEAR instead of 1 is an easy mistake to make. REWIND helps you review the payment before approving it, then gives you 60 seconds to cancel if you spot an error.</p>
            <p className="fine-print">Only payments sent through REWIND have this protection. Direct NEAR transfers can't be reversed, and cancellation closes after 60 seconds.</p>
          </div>
        </div>
      </section>

      <section className="walkthrough" id="how-it-works">
        <div className="section-heading">
          <div><p className="section-kicker">How it works</p><h2>Two ways to catch<br />a payment mistake.</h2></div>
          <p>A quick check before you approve, plus a short chance to cancel after sending.</p>
        </div>
        <div className="steps">
          <article><span>01</span><div className="step-icon">◎</div><h3>Check the address</h3><p>Check if the NEAR account exists and flag lookalikes among your saved or previously used recipients.</p></article>
          <article><span>02</span><div className="step-icon">◇</div><h3>Review and send</h3><p>Confirm the recipient and amount, then approve in your NEAR wallet. No new wallet needed.</p></article>
          <article><span>03</span><div className="step-icon">↶</div><h3>60 seconds to cancel</h3><p>Sent 10 NEAR instead of 1? You can cancel before the 60-second window ends.</p></article>
          <article><span>04</span><div className="step-icon">✓</div><h3>Automatic delivery</h3><p>If you leave the payment as it is, REWIND delivers it to the original recipient after the window ends.</p></article>
        </div>
      </section>

      <section className="app-intro" id="app">
        <div><p className="section-kicker">Try REWIND</p><h2>Send NEAR with a safety check.</h2></div>
        <p>Connected to {getNetworkId()}. Use test tokens and an account you control for your first payment.</p>
      </section>

      <section className="workspace">
        <form className="panel create" onSubmit={submitCreate}>
          <div className="panel-title"><span>SEND</span><div><h2>Send NEAR</h2><p>Enter the recipient and amount. We'll help you check them before wallet approval.</p></div></div>
          <label>Recipient NEAR account<input required value={recipient} onChange={(e) => { setRecipient(e.target.value); setReview(null) }} placeholder="friend.testnet" /></label>
          <div className="row">
            <label>Amount<input required min="0.00001" step="any" type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null) }} /><b>NEAR</b></label>

          </div>
          <details className="contact-options"><summary>Extra checks: saved address and amount alert (optional)</summary>
            <input aria-label="Saved recipient to compare" value={savedRecipient} onChange={(e) => { setSavedRecipient(e.target.value); localStorage.setItem('rewind-saved-recipient', e.target.value); setReview(null) }} placeholder="e.g. alice.testnet" />
            <label>Optional amount alert above (NEAR)<input aria-label="Amount warning threshold" value={threshold} onChange={(e) => { setThreshold(e.target.value); localStorage.setItem('rewind-threshold-near', e.target.value); setReview(null) }} placeholder="e.g. 1" inputMode="decimal" /></label>
          </details>
          {review && <div className="preflight-review" role="status">
            <strong>{review.warnings.some((warning) => warning.code === 'unverified') ? 'Verification temporarily unavailable' : review.warnings.some((warning) => warning.code === 'missing_account' || warning.code === 'lookalike') ? 'Check the recipient address' : review.warnings.length ? 'Additional payment checks' : 'Recipient verified. Review before sending.'}</strong>
            {review.warnings.map((warning, index) => <p key={index}>{warning.message}</p>)}
            <p>You're sending <strong>{amount} NEAR</strong> to <strong>{review.recipient}</strong>.</p>
            {!review.valid && <p>{review.warnings.some((warning) => warning.code === 'unverified') ? 'REWIND could not check the network. No payment has been submitted. Please retry address verification.' : 'This recipient account was not found or is invalid. Check it before continuing.'}</p>}
            {!review.valid && <button className="retry-check" type="button" onClick={() => { setReview(null); setTx(initialTx) }}>Retry address check</button>}
          </div>}
          <button className="primary form-submit" disabled={loading || (!!accountId && (!isNearAccountId(recipient.trim().toLowerCase()) || (review !== null && !review.valid)))}>{accountId ? (review?.valid ? 'Confirm and send NEAR' : 'Review payment') : 'Connect wallet to begin'} <span>→</span></button>
          <small className="form-help">Protected by REWIND. If you send the wrong amount or enter the wrong address, you can cancel within 60 seconds.</small>
        </form>

        <div className="panel inspect">
          <div className="panel-title"><span>TRACK</span><div><h2>Transfer status</h2><p>See your payment's progress on NEAR.</p></div></div>
          <form className="search" onSubmit={(e) => { e.preventDefault(); void loadTransfer() }}>
            <input aria-label="Transfer ID" inputMode="numeric" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Enter transfer ID" />
            <button disabled={loading}>Check status</button>
          </form>
          {transfer ? (
            <article className="card">
              <div className="card-head"><span>TRANSFER #{transfer.id}</span><strong data-status={transfer.status}>{statusLabel(transfer.status, clock >= Number(transfer.expires_at_ms))}</strong></div>
              <div className="amount">{formatNear(transfer.amount)} <small>NEAR</small></div>
              <dl>
                <div><dt>Sender</dt><dd>{transfer.sender}</dd></div>
                <div><dt>Recipient</dt><dd>{transfer.recipient}</dd></div>
                <div><dt>Protection</dt><dd>{transfer.status === 'Released' ? 'Delivered to recipient' : transfer.status === 'Cancelled' ? 'Refunded to sender' : remaining}</dd></div>
              </dl>
              {['Refunding', 'Releasing'].includes(transfer.status) && <p className="pending">Settlement is processing. The blockchain callback will confirm the result.</p>}
              {transfer.status === 'Pending' && clock >= Number(transfer.expires_at_ms) && <p className="pending">The 60-second protection period has ended. Automatic delivery is being requested. Refresh the status to see when it completes.</p>}
              {transfer.status === 'DeliveryFailed' && <p className="pending">Automatic delivery failed. The sender can request a refund, or delivery can be retried.</p>}
              <div className="actions">
                {canCancel && <button onClick={() => settle('cancel')} disabled={loading}>{transfer.status === 'DeliveryFailed' || transfer.status === 'RefundFailed' ? 'Request refund' : 'Cancel transfer'}</button>}
                {canRelease && <button onClick={() => settle('release')} disabled={loading}>{transfer.status === 'DeliveryFailed' ? 'Retry delivery' : 'Release now'}</button>}
              </div>
            </article>
          ) : <div className="empty"><span>⌁</span><p>Track a payment</p><small>Enter its transfer ID to check the status or cancel while eligible.</small></div>}
        </div>
      </section>

      {accountId && <section className="history">
        <div className="panel-title"><span>HISTORY</span><div><h2>Recent transfers</h2><p>Payments linked to your connected wallet.</p></div></div>
        {history.length ? <div className="history-grid">{history.map((item) => <button key={item.id} onClick={() => void loadTransfer(item.id)}>
          <span>#{item.id}</span><strong>{formatNear(item.amount)} NEAR</strong><em>{statusLabel(item.status, clock >= Number(item.expires_at_ms))}</em><small>{item.sender === accountId ? `to ${short(item.recipient)}` : `from ${short(item.sender)}`}</small>
        </button>)}</div> : <p className="history-empty">No REWIND transfers found for this account.</p>}
      </section>}

      <section className="clarity">
        <div className="clarity-title"><p className="section-kicker">For everyday payments</p><h2>Simple to use.<br />Built for wallets.</h2></div>
        <div className="clarity-grid">
          <article><span>◎</span><h3>Address warnings, not guesses</h3><p>REWIND checks account existence and can flag addresses similar to your saved recipients. It doesn't claim to know who you meant to pay.</p></article>
          <article><span>↶</span><h3>A fixed 60-second window</h3><p>Only the sender can cancel in time. The NEAR contract enforces the deadline and original recipient.</p></article>
          <article><span>⌘</span><h3>Works beyond this website</h3><p>Wallet developers can add recipient checks and 60-second payment protection to their own NEAR send flows with the REWIND SDK.</p></article>
        </div>
      </section>


      <section className="developers" id="developers">
        <div className="developer-copy">
          <p className="section-kicker">REWIND SDK</p>
          <h2>Add safer payments to your NEAR wallet.</h2>
          <p>REWIND is not limited to this website. Wallet developers can integrate the SDK to check recipient details and prepare a protected NEAR payment inside their own Send screen.</p>
          <p>The wallet signs each payment. The smart contract handles the 60-second window and delivery. REWIND does not ask users to share private keys.</p>
          <div className="developer-links">
            <a href={`${import.meta.env.BASE_URL}sdk/index.js`} target="_blank" rel="noreferrer">Download JavaScript SDK</a>
            <a href={`${import.meta.env.BASE_URL}sdk/index.d.ts`} target="_blank" rel="noreferrer">TypeScript definitions</a>
            <a href={`${import.meta.env.BASE_URL}sdk/README.md`} target="_blank" rel="noreferrer">Integration guide</a>
          </div>
          <small>Wallet developers opt in to REWIND. It cannot cancel direct NEAR transfers made outside the protocol.</small>
        </div>
        <div className="developer-example">
          <div className="developer-code-top"><span>Example wallet integration</span><button type="button" onClick={() => void copySdkExample()}>{copiedSdk ? 'Copied' : 'Copy code'}</button></div>
          <pre><code>{SDK_SNIPPET}</code></pre>
          <p>Testnet example. The wallet shows any warnings to its user and signs the standard NEAR contract call.</p>
        </div>
      </section>

      <section className="final-cta">
        <div><p className="section-kicker">A better way to send</p><h2>Check first.<br /><em>Send with confidence.</em></h2></div>
        <a className="button primary" href="#app">Send NEAR on Testnet <span>↑</span></a>
      </section>

      {tx.kind !== 'idle' && <aside className={`toast ${tx.kind}`}><button onClick={() => setTx(initialTx)}>×</button><strong>{tx.kind === 'error' ? 'Not confirmed' : 'Transaction status'}</strong><p>{tx.message}</p>{tx.kind === 'wallet' && <small>Some wallets sign through an existing permission without a popup. Check your wallet transactions and REWIND transfer history before trying to send again.</small>}{tx.hash && <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View {short(tx.hash)} on NEAR explorer ↗</a>}</aside>}

      <footer><a className="brand footer-brand" href={import.meta.env.BASE_URL}><span className="brand-mark">↶</span> REWIND</a><div><span>Network: {getNetworkId()}</span><span>Contract: {getContractId() || 'not configured'}</span></div><p>Testnet demo. Experimental and unaudited.<br />Never send Mainnet funds.</p></footer>
    </main>
  )
}

function statusLabel(status: Transfer['status'], expired = false) {
  if (status === 'Pending' && expired) return 'Awaiting delivery'
  const labels: Record<Transfer['status'], string> = {
    Pending: 'Protected',
    Refunding: 'Refunding',
    RefundFailed: 'Refund failed. Retry available',
    DeliveryFailed: 'Delivery failed. Refund or retry available',
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
