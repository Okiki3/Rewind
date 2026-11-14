import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  cancelTransfer,
  connectWallet,
  createTransfer,
  explorerTx,
  explorerAccount,
  formatNear,
  getContractId,
  getNetworkId,
  getNetworkSwitchHref,
  isProtectedPaymentEnabled,
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
  const isMainnetPreview = getNetworkId() === 'mainnet'
  const paymentsEnabled = isProtectedPaymentEnabled()
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
  const statusRef = useRef<HTMLDivElement | null>(null)
  const trackGeneration = useRef(0)
  const lastExplorerCheck = useRef<Record<string, number>>({})
  const [history, setHistory] = useState<Transfer[]>([])
  const [tx, setTx] = useState<TxState>(initialTx)
  const [loading, setLoading] = useState(false)
  const [copiedSdk, setCopiedSdk] = useState(false)
  const [copiedHash, setCopiedHash] = useState('')
  const [clock, setClock] = useState(Date.now())

  const localRecordsKey = useMemo(() => recordKey(getNetworkId(), getContractId(), accountId), [accountId])

  const selectActive = useCallback((id: string, snapshot: Transfer | null = null) => {
    activeRef.current = id
    setActiveTransferId(id)
    setLookupId(id)
    setTransfer(snapshot)
    setTrackingNewPayment(snapshot === null)
    setCopiedHash('')
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
    setHistory([])
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

  const missingHistoryIds = history.filter((entry) => entry.sender === accountId && !paymentHashes[entry.id]).map((entry) => entry.id).join(',')
  const explorerMinute = Math.floor(clock / 60_000)

  useEffect(() => {
    if (!accountId || !missingHistoryIds) return
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
  }, [accountId, missingHistoryIds, explorerMinute, history, localRecordsKey, paymentHashes])

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
        setPendingHash(null)
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
    // Mainnet is read-only account verification. No wallet or escrow calls.
    if (!paymentsEnabled) {
      if (!isMainnetPreview) {
        setTx({ kind: 'error', message: 'Protected payments are unavailable because the Testnet contract is not configured.' })
        return
      }
      setLoading(true)
      try {
        const inspected = await preflight({
          recipient, amountNear: amount, network: 'mainnet',
          contacts: savedRecipient.trim() ? [{ address: savedRecipient.trim() }] : [],
          recentRecipients: [],
          warnAboveNear: threshold.trim() && Number(threshold) > 0 ? threshold.trim() : undefined,
        })
        setReview(inspected)
        setTx(initialTx)
      } catch (error) {
        setTx({ kind: 'error', message: errorMessage(error) })
      } finally {
        setLoading(false)
      }
      return
    }
    if (!accountId) {
      try {
        await connectWallet()
        setAccountId(await getAccountId())
      } catch (error) {
        setTx({ kind: 'error', message: errorMessage(error) })
      }
      return
    }
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

      // Bring the actual payment status and cancel action into view on mobile.
      window.requestAnimationFrame(() => statusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

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

  const canCancel = accountId === transfer?.sender && ((transfer?.status === 'RefundFailed' || transfer?.status === 'DeliveryFailed') || (transfer?.status === 'Pending' && clock < Number(transfer.expires_at_ms)))
  // Delivery is automatic. A manual rescue call is shown only after a delay
  // or when an onchain payout has explicitly failed.
  const canRelease = !!transfer && (
    transfer.status === 'DeliveryFailed' ||
    (transfer.status === 'Pending' && clock > Number(transfer.expires_at_ms) + 45_000)
  )

  const activeHash = transfer
    ? paymentHashes[transfer.id] || null
    : activeTransferId ? paymentHashes[activeTransferId] || null : pendingHash
  const secondsToCancel = transfer?.status === 'Pending'
    ? Math.max(0, Math.ceil((Number(transfer.expires_at_ms) - clock) / 1_000))
    : 0
  const timerLabel = `${String(Math.floor(secondsToCancel / 60)).padStart(2, '0')}:${String(secondsToCancel % 60).padStart(2, '0')}`
  const protectionProgress = Math.min(100, Math.max(0, (60 - secondsToCancel) / 60 * 100))

  async function copyPaymentHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash)
      setCopiedHash(hash)
    } catch { setCopiedHash('') }
  }

  return (
    <main>
      <nav>
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="REWIND home"><span className="brand-mark">↶</span> REWIND <b>NEAR</b></a>
        <div className="nav-links"><a href="#how-it-works">How it works</a><a href="#app">{isMainnetPreview ? 'Address check' : 'Send NEAR'}</a><a href="#developers">SDK</a></div>
        <div className="network-switcher">
          <button
            type="button"
            className="network-switch"
            role="switch"
            aria-label={isMainnetPreview ? 'Mainnet selected. Switch to Testnet' : 'Testnet selected. Switch to Mainnet'}
            aria-checked={isMainnetPreview}
            title={isMainnetPreview ? 'Switch to Testnet' : 'Switch to Mainnet'}
            onClick={() => { window.location.assign(getNetworkSwitchHref(isMainnetPreview ? 'testnet' : 'mainnet')) }}
          >
            <span className="network-status-dot" aria-hidden="true" />
            <span>{isMainnetPreview ? 'Mainnet' : 'Testnet'}</span>
            <span className="network-swap" aria-hidden="true">⇄</span>
          </button>
        </div>
        {!isMainnetPreview && (accountId
          ? <button className="wallet" onClick={signOut}>{short(accountId)} · disconnect</button>
          : <button className="wallet" onClick={() => { void connectWallet().catch((error: unknown) => setTx({ kind: 'error', message: errorMessage(error) })) }}>Connect NEAR wallet</button>)}
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Payment protection for NEAR</p>
          <h1>Catch mistakes before they cost you</h1>
          <p className="lede">REWIND checks the recipient before you approve, then gives protected payments a 60-second cancellation window before delivery.</p>
          <div className="hero-actions">
            <a className="button primary" href="#app" >{isMainnetPreview ? 'Check an address' : 'Protect a payment'} <span aria-hidden="true">→</span></a>
            <a className="button secondary" href={isMainnetPreview ? getNetworkSwitchHref('testnet') : '#developers'}>{isMainnetPreview ? 'Switch to Testnet' : 'Build with REWIND'} <span aria-hidden="true">↗</span></a>
          </div>
          <p className="testnet-note"><i /> {isMainnetPreview ? 'NEAR Mainnet · Address check' : 'NEAR Testnet'}</p>
        </div>

        <div className="hero-demo" aria-label="Illustrative protected transfer, not a live payment">
          <div className="demo-top"><span>Protected transfer</span><strong>EXAMPLE ONLY</strong></div>
          <div className="demo-amount"><small>PAYMENT AMOUNT</small><b>1.00</b><span>NEAR</span></div>
          <div className="demo-route"><span>{isMainnetPreview ? 'sender.near' : 'sender.testnet'}</span><i aria-hidden="true">→</i><span>{isMainnetPreview ? 'recipient.near' : 'recipient.testnet'}</span></div>
          <div className="demo-window">
            <div className="demo-check" aria-hidden="true">✓</div>
            <div><strong>Review before signing</strong><span>Confirm the recipient and amount in your wallet.</span></div>
          </div>
          <div className="demo-buttons"><span>Recipient verification</span><span>60-second protection</span></div>
        </div>
      </header>

      <section className="proof-bar" aria-label="REWIND benefits">
        <div><span>01</span><strong>Verify before signing</strong></div>
        <div><span>02</span><strong>60 seconds to cancel</strong></div>
        <div><span>03</span><strong>Wallet-ready SDK</strong></div>
      </section>

      <section className="problem">
        <p className="section-kicker">Why REWIND</p>
        <div className="problem-grid">
          <h2>A safer send starts before approval</h2>
          <div>
            <p>A mistyped account or wrong amount can turn into an irreversible loss. REWIND verifies the destination before signing and holds protected payments for 60 seconds, so the sender can cancel an error before delivery.</p>
            <p className="fine-print">Only payments sent through the REWIND contract can be cancelled during the protection window. Direct NEAR transfers and completed payments cannot be reversed.</p>
          </div>
        </div>
      </section>

      <section className="walkthrough" id="how-it-works">
        <div className="section-heading">
          <div><p className="section-kicker">How it works</p><h2>Protection at every step</h2></div>
          <p>From recipient verification to confirmed delivery, the safety checks stay inside one payment flow.</p>
        </div>
        <div className="steps">
          <article><span>01 / VERIFY</span><div className="step-icon" aria-hidden="true">◎</div><h3>Confirm the destination</h3><p>REWIND checks that the recipient exists and flags address or amount warnings before you sign.</p></article>
          <article><span>02 / PROTECT</span><div className="step-icon" aria-hidden="true">◇</div><h3>Approve the protected payment</h3><p>Your wallet signs one onchain transaction to the REWIND contract, which starts the safety window.</p></article>
          <article><span>03 / CORRECT</span><div className="step-icon" aria-hidden="true">↶</div><h3>Cancel an error</h3><p>Only the sender can cancel during the 60-second window and recover the protected funds.</p></article>
          <article><span>04 / DELIVER</span><div className="step-icon" aria-hidden="true">✓</div><h3>Follow the delivery</h3><p>If you do nothing, delivery begins after the window. Track its onchain status and transaction hash.</p></article>
        </div>
      </section>

      <section className="app-intro" id="app">
        <div><p className="section-kicker">{isMainnetPreview ? 'Mainnet explorer' : 'Try it'}</p><h2>{isMainnetPreview ? 'Check a Mainnet address.' : 'Make a protected payment.'}</h2></div>
        <p>{isMainnetPreview ? 'Check recipient accounts on Mainnet. Switch to Testnet above to try protected payments.' : 'Connect a Testnet wallet and use test tokens to try protected payments.'}</p>
      </section>

      <section className="workspace">
        <form className="panel create" onSubmit={submitCreate}>
          <div className="panel-title"><span>{isMainnetPreview ? 'VERIFY' : 'SEND'}</span><div><h2>{isMainnetPreview ? 'Verify a Mainnet recipient' : 'Send NEAR'}</h2><p>{isMainnetPreview ? 'Check a Mainnet account and optional amount warnings. Nothing will be signed or sent.' : 'Enter an address and amount. Review the details before approving in your wallet.'}</p></div></div>
          <label>Recipient NEAR account<input required value={recipient} onChange={(e) => { setRecipient(e.target.value); setReview(null) }} placeholder={isMainnetPreview ? 'friend.near' : 'friend.testnet'} /></label>
          <div className="row">
            <label>Amount<input required min="0.00001" step="any" type="number" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null) }} /><b>NEAR</b></label>

          </div>
          <details className="contact-options"><summary>Additional checks (optional)</summary>
            <input aria-label="Saved recipient to compare" value={savedRecipient} onChange={(e) => { setSavedRecipient(e.target.value); localStorage.setItem('rewind-saved-recipient', e.target.value); setReview(null) }} placeholder="e.g. alice.testnet" />
            <label>Optional amount alert above (NEAR)<input aria-label="Amount warning threshold" value={threshold} onChange={(e) => { setThreshold(e.target.value); localStorage.setItem('rewind-threshold-near', e.target.value); setReview(null) }} placeholder="e.g. 1" inputMode="decimal" /></label>
          </details>
          {review && <div className="preflight-review" role={review.valid ? 'status' : 'alert'} data-invalid={!review.valid}>
            {review.valid ? <>
              <strong>{review.warnings.some((warning) => warning.code === 'lookalike') ? 'Check the recipient address' : review.warnings.length ? 'Review before sending' : isMainnetPreview ? 'Mainnet recipient verified' : 'Recipient verified'}</strong>
              {review.warnings.map((warning, index) => <p key={index}>{warning.message}</p>)}
              <p>{isMainnetPreview ? 'Read-only review:' : "You're sending"} <strong>{amount} NEAR</strong> {isMainnetPreview ? 'for' : 'to'} <strong>{review.recipient}</strong>. {isMainnetPreview && 'No payment will be submitted.'}</p>
            </> : <>
              <strong>{review.warnings.find((warning) => ['invalid_address', 'missing_account', 'unverified'].includes(warning.code))?.message || 'Unable to verify this recipient. Transfer blocked.'}</strong>
              {review.warnings.some((warning) => warning.code === 'unverified') && <button className="retry-check" type="button" onClick={() => { setReview(null); setTx(initialTx) }}>Retry verification</button>}
            </>}
          </div>}
          <button className="primary form-submit" disabled={loading || (!isMainnetPreview && !!accountId && (!isNearAccountId(recipient.trim().toLowerCase()) || (review !== null && !review.valid)))}>{isMainnetPreview ? 'Check Mainnet recipient' : accountId ? (review?.valid ? 'Confirm and send NEAR' : 'Review payment') : 'Connect wallet to begin'} <span>→</span></button>
          <small className="form-help">{isMainnetPreview ? 'Mainnet is an address-check preview on this page.' : 'A REWIND-protected payment can be cancelled by its sender for 60 seconds after the contract accepts it.'}</small>
        </form>

        {isMainnetPreview ? <div className="panel inspect" id="transfer-status">
          <div className="panel-title"><span>NETWORK</span><div><h2>Mainnet preview</h2><p>Switch to Testnet above to send protected payments.</p></div></div>
        </div> : <div className="panel inspect" ref={statusRef} id="transfer-status">
          <div className="panel-title"><span>TRACK</span><div><h2>Transfer status</h2><p>Follow the payment's onchain status and confirmation.</p></div></div>
          <form className="search" onSubmit={(e) => { e.preventDefault(); void loadTransfer() }}>
            <input aria-label="Transfer ID" inputMode="numeric" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Enter transfer ID" />
            <button disabled={loading}>Check status</button>
          </form>
          {transfer ? (
            <article className="card payment-receipt" aria-label={`Details for transfer ${transfer.id}`}>
              <div className="card-head"><span>TRANSFER #{transfer.id}</span><strong data-status={transfer.status}>{statusLabel(transfer.status, clock >= Number(transfer.expires_at_ms))}</strong></div>
              <div className="receipt-amount">{formatNear(transfer.amount)} <small>NEAR</small></div>
              {transfer.status === 'Pending' && secondsToCancel > 0 && (
                <div className="receipt-clock" role="timer" aria-label="Time remaining to cancel">
                  <div className="receipt-clock-label"><span>Time left to cancel</span><strong>{timerLabel}</strong></div>
                  <div className="receipt-progress-track" aria-hidden="true"><div style={{ width: `${protectionProgress}%` }} /></div>
                  <small>Only the sender can cancel before the 60-second deadline.</small>
                </div>
              )}
              {transfer.status === 'Pending' && secondsToCancel === 0 && (
                <p className="receipt-notice">The cancellation window has ended. Automatic delivery is pending network confirmation.</p>
              )}
              {transfer.status === 'Released' && <p className="receipt-success">Delivered to the intended recipient. This payment can no longer be cancelled.</p>}
              {transfer.status === 'Cancelled' && <p className="receipt-success">Cancellation complete. The sender's NEAR has been refunded.</p>}
              {['Refunding', 'Releasing'].includes(transfer.status) && <p className="receipt-notice">The blockchain is processing settlement. Waiting for contract confirmation.</p>}
              {transfer.status === 'DeliveryFailed' && <p className="receipt-notice">Delivery failed onchain. The sender can request a refund or retry delivery.</p>}
              {transfer.status === 'RefundFailed' && <p className="receipt-notice">Refund failed onchain. The sender can retry the refund.</p>}
              <dl className="receipt-details">
                <div><dt>From</dt><dd>{transfer.sender}</dd></div>
                <div><dt>To</dt><dd>{transfer.recipient}</dd></div>
                <div><dt>Network</dt><dd>NEAR {getNetworkId() === 'testnet' ? 'Testnet' : 'Mainnet'}</dd></div>
                <div><dt>Created</dt><dd>{formatPaymentTime(transfer.created_at_ms)}</dd></div>
                <div><dt>Cancel deadline</dt><dd>{formatPaymentTime(transfer.expires_at_ms)}</dd></div>
                <div><dt>Completed</dt><dd>{formatPaymentTime(transfer.settled_at_ms)}</dd></div>
                <div><dt>Transaction hash</dt><dd className="receipt-hash">
                  {activeHash ? <>
                    <code title={activeHash}>{activeHash}</code>
                    <div className="receipt-hash-actions">
                      <button type="button" onClick={() => void copyPaymentHash(activeHash)}>{copiedHash === activeHash ? 'Copied' : 'Copy hash'}</button>
                      <a href={explorerTx(activeHash)} target="_blank" rel="noreferrer">View transaction <span aria-hidden="true">↗</span></a>
                    </div>
                  </> : <>
                    <span className="receipt-unavailable">Hash not yet indexed for this transfer.</span>
                    <a href={explorerAccount(transfer.sender)} target="_blank" rel="noreferrer">Find it in sender activity <span aria-hidden="true">↗</span></a>
                  </>}
                </dd></div>
              </dl>
              <div className="receipt-bottom">
                {(canCancel || canRelease) && <div className="actions">
                  {canCancel && <button type="button" onClick={() => void settle('cancel')} disabled={loading}>
                    {transfer.status === 'DeliveryFailed' || transfer.status === 'RefundFailed' ? 'Request refund' : 'Cancel transfer'}
                  </button>}
                  {canRelease && <button type="button" onClick={() => void settle('release')} disabled={loading}>
                    {transfer.status === 'DeliveryFailed' ? 'Retry delivery' : 'Delivery delayed? Retry'}
                  </button>}
                </div>}
                <button type="button" className="refresh-mini" disabled={loading} onClick={() => void loadTransfer(transfer.id)}>Refresh status</button>
              </div>
            </article>
          ) : trackingNewPayment || activeTransferId || pendingHash ? (
            <div className="tracking-new" role="status">
              <span className="tracking-dot" />
              <strong>{activeTransferId ? `Loading transfer #${activeTransferId}` : 'Finding your new transfer'}</strong>
              <p>{pendingHash ? 'Your wallet transaction was confirmed. REWIND is locating the contract record. Do not send again.' : 'Reading the latest status from the blockchain.'}</p>
              {(pendingHash || (activeTransferId && paymentHashes[activeTransferId])) && (
                <a href={explorerTx(pendingHash || paymentHashes[activeTransferId!]!)} target="_blank" rel="noreferrer">View confirmed transaction <span aria-hidden="true">↗</span></a>
              )}
              {activeTransferId && <button type="button" onClick={() => void loadTransfer(activeTransferId)}>Retry status lookup</button>}
            </div>
          ) : (
            <div className="empty"><span>⌁</span><p>Your transfer status will appear here</p><small>Send a protected payment or enter an existing transfer ID to track its status.</small></div>
          )}
        </div>}
      </section>

      {!isMainnetPreview && accountId && <section className="history">
        <div className="history-heading">
          <div className="panel-title"><span>HISTORY</span><div><h2>Recent transfers</h2><p>Actual onchain transfers for your connected wallet. Select one to view its full status.</p></div></div>
          <small>New payment hashes are saved in this browser. Older hashes are matched against public NEAR explorer records when available.</small>
        </div>
        {history.length ? <div className="history-grid">{history.map((item) => {
          const hash = paymentHashes[item.id]
          return <article className="history-entry" key={item.id} data-selected={activeTransferId === item.id}>
            <button type="button" className="history-select" onClick={() => { setPendingHash(null); selectActive(item.id, item); void loadTransfer(item.id) }}>
              <span className="history-top"><span>TRANSFER #{item.id}</span><em>{statusLabel(item.status, clock >= Number(item.expires_at_ms))}</em></span>
              <strong>{formatNear(item.amount)} <small>NEAR</small></strong>
              <span>{item.sender === accountId ? 'To ' + item.recipient : 'From ' + item.sender}</span>
              <small>{formatPaymentTime(item.created_at_ms)}</small>
            </button>
            <div className="history-hash">
              <span>Transaction hash</span>
              {hash
                ? <a href={explorerTx(hash)} title={hash} target="_blank" rel="noreferrer">{short(hash)} <span aria-hidden="true">↗</span></a>
                : <a href={explorerAccount(item.sender)} target="_blank" rel="noreferrer">Find on explorer <span aria-hidden="true">↗</span></a>}
            </div>
          </article>
        })}</div> : <p className="history-empty">No REWIND transfers found for this account.</p>}
      </section>}

      <section className="developers" id="developers">
        <div className="developer-copy">
          <p className="section-kicker">For wallet developers</p>
          <h2>Add REWIND to your wallet.</h2>
          <p>Bring recipient checks and protected NEAR payments into your existing send flow using the public SDK. No separate REWIND app is required.</p>
          <p>Your wallet retains transaction signing. The contract enforces the cancellation period and destination; the SDK never requests private keys.</p>
          <div className="developer-links">
            <a href={`${import.meta.env.BASE_URL}sdk/index.js`} target="_blank" rel="noreferrer">Download JavaScript SDK</a>
            <a href={`${import.meta.env.BASE_URL}sdk/index.d.ts`} target="_blank" rel="noreferrer">TypeScript definitions</a>
            <a href={`${import.meta.env.BASE_URL}sdk/README.md`} target="_blank" rel="noreferrer">Integration guide</a>
          </div>
          <small>Integration is opt-in. Protection applies only to payments routed through the REWIND contract.</small>
        </div>
        <div className="developer-example">
          <div className="developer-code-top"><span>Example wallet integration</span><button type="button" onClick={() => void copySdkExample()}>{copiedSdk ? 'Copied' : 'Copy code'}</button></div>
          <pre><code>{SDK_SNIPPET}</code></pre>
          <p>Testnet integration example. Your wallet presents the review and signs the contract call.</p>
        </div>
      </section>

      <section className="final-cta">
        <div><p className="section-kicker">Get started</p><h2>Verify the details, protect the payment</h2></div>
        <a className="button primary" href={isMainnetPreview ? getNetworkSwitchHref('testnet') : '#app'}>{isMainnetPreview ? 'Use REWIND on Testnet' : 'Protect a Testnet payment'} <span aria-hidden="true">↑</span></a>
      </section>

      {tx.kind !== 'idle' && <aside className={`toast ${tx.kind}`}><button onClick={() => setTx(initialTx)}>×</button><strong>{tx.kind === 'error' ? 'Not confirmed' : 'Transaction status'}</strong><p>{tx.message}</p>{tx.kind === 'wallet' && <small>Some wallets sign through an existing permission without a popup. Check your wallet transactions and REWIND transfer history before trying to send again.</small>}{tx.hash && <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View {short(tx.hash)} on NEAR explorer ↗</a>}</aside>}

      <footer className="site-footer">
        <div className="footer-identity">
          <a className="brand footer-brand" href={import.meta.env.BASE_URL} aria-label="REWIND home"><span className="brand-mark">↶</span> REWIND</a>
          <p>Payment protection for NEAR with pre-signing checks and a 60-second cancellation window.</p>
        </div>
        <div className="footer-nav">
          <strong>Explore</strong>
          <a href="#how-it-works">How it works</a>
          <a href="#app">Try REWIND</a>
          <a href="#developers">Wallet SDK</a>
        </div>
        <div className="footer-about">
          <strong>Built by <a href="https://x.com/kisc_0" target="_blank" rel="noopener noreferrer" aria-label="Afrolite on X">Afrolite</a></strong>
          <span>{isMainnetPreview ? 'NEAR Mainnet · Preview' : 'NEAR Testnet · Experimental prototype'}</span>
          <p>{isMainnetPreview ? 'Payments disabled in website preview.' : 'Test tokens only. Not audited for real-money use.'}</p>
        </div>
        <div className="footer-bottom">
          <span>© 2026 REWIND</span>
          <span>Direct NEAR transfers cannot be reversed.</span>
        </div>
      </footer>
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

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.includes('User rejected') ? 'Wallet request was rejected. No onchain change was made.' : error.message
  return 'The transaction was not confirmed. Check your wallet and try again.'
}

export default App
