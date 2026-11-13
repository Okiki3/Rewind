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

const initialTx: TxState = { kind: 'idle', message: '' }

function App() {
  const [accountId, setAccountId] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('0.1')
  const [minutes, setMinutes] = useState('10')
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
    if (!accountId) return connectWallet()
    setLoading(true)
    setTx({ kind: 'wallet', message: 'Confirm the escrow deposit in your NEAR wallet…' })
    try {
      const expiry = Date.now() + Number(minutes) * 60_000
      const outcome = await createTransfer(recipient.trim(), amount, expiry)
      const hash = outcome.transaction.hash
      setTx({ kind: 'confirmed', message: 'Transfer creation confirmed onchain.', hash })
      const id = findTransferId(outcome.receipts_outcome.flatMap((receipt: { outcome: { logs: string[] } }) => receipt.outcome.logs))
      if (id) await loadTransfer(id)
      if (accountId) setHistory(await viewAccountTransfers(accountId))
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
    setTx({ kind: 'wallet', message: `Confirm ${action} in your NEAR wallet…` })
    try {
      const outcome = action === 'cancel'
        ? await cancelTransfer(transfer.id)
        : await releaseTransfer(transfer.id)
      setTx({
        kind: 'confirmed',
        message: `${action === 'cancel' ? 'Refund' : 'Release'} confirmed by the contract callback.`,
        hash: outcome.transaction.hash,
      })
      await loadTransfer(transfer.id)
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
    if (delta <= 0) return 'Protection window ended'
    const seconds = Math.ceil(delta / 1_000)
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s protected`
  }, [clock, transfer])

  const canCancel = transfer?.status === 'Pending' && clock < Number(transfer.expires_at_ms) && accountId === transfer.sender
  const canRelease = transfer?.status === 'Pending' && clock >= Number(transfer.expires_at_ms)

  return (
    <main>
      <nav>
        <a className="brand" href={import.meta.env.BASE_URL}>REWIND<span>↶</span></a>
        <div className="network"><i /> {getNetworkId()}</div>
        {accountId
          ? <button className="wallet" onClick={signOut}>{short(accountId)} · disconnect</button>
          : <button className="wallet" onClick={connectWallet}>Connect wallet</button>}
      </nav>

      <header>
        <p className="eyebrow">NEAR-native escrow</p>
        <h1>Send now.<br /><em>Change your mind.</em></h1>
        <p className="lede">Lock a transfer behind a deadline. Cancel it while it’s protected, or let the recipient claim it when time runs out.</p>
        <div className="notice">Experimental Testnet software · independently verify every transaction</div>
      </header>

      <section className="workspace">
        <form className="panel create" onSubmit={submitCreate}>
          <div className="panel-title"><span>01</span><h2>Protect a transfer</h2></div>
          <label>Recipient NEAR account<input required value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="friend.testnet" /></label>
          <div className="row">
            <label>Amount<input required min="0.00001" step="any" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><b>NEAR</b></label>
            <label>Protection<input required min="1" max="10080" step="1" type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} /><b>MIN</b></label>
          </div>
          <button className="primary" disabled={loading}>{accountId ? 'Create protected transfer' : 'Connect wallet to continue'} <span>→</span></button>
          <small>The attached deposit is locked in the configured contract. Wallet approval is required.</small>
        </form>

        <div className="panel inspect">
          <div className="panel-title"><span>02</span><h2>Track a transfer</h2></div>
          <form className="search" onSubmit={(e) => { e.preventDefault(); void loadTransfer() }}>
            <input inputMode="numeric" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Transfer ID" />
            <button disabled={loading}>Look up</button>
          </form>
          {transfer ? (
            <article className="card">
              <div className="card-head"><span>#{transfer.id}</span><strong data-status={transfer.status}>{transfer.status}</strong></div>
              <div className="amount">{formatNear(transfer.amount)} <small>NEAR</small></div>
              <dl>
                <div><dt>From</dt><dd>{transfer.sender}</dd></div>
                <div><dt>To</dt><dd>{transfer.recipient}</dd></div>
                <div><dt>Timer</dt><dd>{remaining}</dd></div>
              </dl>
              {['Refunding', 'Releasing'].includes(transfer.status) && <p className="pending">Settlement callback pending. Funds are not final yet.</p>}
              <div className="actions">
                <button onClick={() => settle('cancel')} disabled={!canCancel || loading}>Cancel & refund</button>
                <button onClick={() => settle('release')} disabled={!canRelease || loading}>Release funds</button>
              </div>
            </article>
          ) : <div className="empty"><span>↶</span><p>Enter an onchain transfer ID to see its live state.</p></div>}
        </div>
      </section>

      {accountId && <section className="history">
        <div className="panel-title"><span>03</span><h2>Your onchain history</h2></div>
        {history.length ? <div className="history-grid">{history.map((item) => <button key={item.id} onClick={() => void loadTransfer(item.id)}>
          <span>#{item.id}</span><strong>{formatNear(item.amount)} NEAR</strong><em>{item.status}</em><small>{item.sender === accountId ? `to ${short(item.recipient)}` : `from ${short(item.sender)}`}</small>
        </button>)}</div> : <p className="history-empty">No transfers found for this account.</p>}
      </section>}

      {tx.kind !== 'idle' && <aside className={`toast ${tx.kind}`}><button onClick={() => setTx(initialTx)}>×</button><strong>{tx.kind === 'error' ? 'Not confirmed' : 'Transaction status'}</strong><p>{tx.message}</p>{tx.hash && <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer">View {short(tx.hash)} on explorer ↗</a>}</aside>}

      <footer><span>REWIND / {getNetworkId()}</span><span>Contract: {getContractId() || 'not configured'}</span><span>Unaudited prototype</span></footer>
    </main>
  )
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function findTransferId(logs: string[]) {
  const log = logs.find((item) => item.startsWith('TRANSFER_CREATED:'))
  return log?.split(':')[1]
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.includes('User rejected') ? 'Wallet request was rejected. Nothing was changed.' : error.message
  return 'The transaction was not confirmed. Check your wallet and try again.'
}

export default App

