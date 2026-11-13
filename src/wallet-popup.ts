/**
 * MyNearWallet builds its transaction after awaiting an RPC request. Opening
 * its window that late may be blocked because the user activation is gone.
 * Reserve its named window synchronously from the user's click, before awaits.
 * The wallet connector subsequently navigates the SAME named window.
 */
export type WalletPopup = Window | null

export function reserveWalletPopup(walletId: string | null | undefined): WalletPopup {
  if (walletId !== 'my-near-wallet') return null

  const width = 480
  const height = 640
  const left = Math.max(0, Math.floor((window.innerWidth - width) / 2))
  const top = Math.max(0, Math.floor((window.innerHeight - height) / 2))
  const popup = window.open(
    'about:blank', 'MyNearWallet',
    `width=${width},height=${height},left=${left},top=${top}`,
  )
  if (!popup) {
    throw new Error('Your browser blocked MyNearWallet. Allow popups for afrolitehub.com, then try again. No transaction has been submitted.')
  }
  try {
    popup.document.title = 'Opening MyNearWallet'
    popup.document.body.textContent = 'Preparing your NEAR wallet approval. Your payment has not been sent yet.'
    popup.focus()
  } catch {
    // A browser is free to treat the window as cross-origin once navigated.
  }
  return popup
}

export function closeReservedWalletPopup(popup: WalletPopup): void {
  if (!popup) return
  try {
    if (!popup.closed) popup.close()
  } catch {
    // Wallet may already have closed its approval window.
  }
}
