import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeReservedWalletPopup, reserveWalletPopup } from './wallet-popup'

afterEach(() => vi.unstubAllGlobals())

describe('wallet approval popup', () => {
  it('reserves a named window synchronously for MyNearWallet', () => {
    const popup = {
      document: { title: '', body: { textContent: '' } },
      focus: vi.fn(),
      close: vi.fn(),
      closed: false,
    }
    const open = vi.fn((...args: unknown[]) => { void args; return popup })
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, open })
    const reserved = reserveWalletPopup('my-near-wallet')
    expect(reserved).toBe(popup)
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][1]).toBe('MyNearWallet')
    expect(popup.document.body.textContent).toContain('not been sent')
    closeReservedWalletPopup(reserved)
    expect(popup.close).toHaveBeenCalledOnce()
  })

  it('does not open extra windows for browser extension wallets', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, open })
    expect(reserveWalletPopup('sender')).toBe(null)
    expect(reserveWalletPopup('meteor-wallet')).toBe(null)
    expect(open).not.toHaveBeenCalled()
  })

  it('refuses to continue if popups are blocked', () => {
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, open: () => null })
    expect(() => reserveWalletPopup('my-near-wallet')).toThrow(/blocked MyNearWallet/)
  })
})
