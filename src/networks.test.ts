import { describe, expect, it } from 'vitest'
import { canUseProtectedTransfers, networkSwitchHref, selectRewindNetwork } from './networks'

describe('Rewind network selection', () => {
  it('defaults to Testnet for the current live site', () => {
    expect(selectRewindNetwork('')).toBe('testnet')
    expect(selectRewindNetwork('?network=unknown')).toBe('testnet')
  })

  it('supports both explicit networks and a standalone Mainnet build default', () => {
    expect(selectRewindNetwork('?network=mainnet')).toBe('mainnet')
    expect(selectRewindNetwork('?network=testnet', 'mainnet')).toBe('testnet')
    expect(selectRewindNetwork('', 'mainnet')).toBe('mainnet')
  })

  it('retains the deployment path, other query parameters and anchor', () => {
    expect(networkSwitchHref('https://afrolitehub.com/rewind/?utm_source=demo#app', 'mainnet'))
      .toBe('/rewind/?utm_source=demo&network=mainnet#app')
    expect(networkSwitchHref('https://afrolitehub.com/rewind/?network=mainnet', 'testnet'))
      .toBe('/rewind/?network=testnet')
  })

  it('refuses Mainnet payments by default, but allows the exact opted-in demo receiver', () => {
    expect(canUseProtectedTransfers('mainnet', '')).toBe(false)
    expect(canUseProtectedTransfers('mainnet', 'rewind.testnet')).toBe(false)
    expect(canUseProtectedTransfers('mainnet', 'rewind.near')).toBe(false)
    expect(canUseProtectedTransfers('mainnet', 'afrolite-rewind-261114.near')).toBe(false)
    expect(canUseProtectedTransfers('mainnet', 'rewind.near', true)).toBe(false)
    expect(canUseProtectedTransfers('mainnet', 'afrolite-rewind-261114.near', true)).toBe(true)
  })

  it('allows only configured Testnet protected-payment contracts', () => {
    expect(canUseProtectedTransfers('testnet', 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet')).toBe(true)
    expect(canUseProtectedTransfers('testnet', '')).toBe(false)
    expect(canUseProtectedTransfers('testnet', 'rewind.near')).toBe(false)
  })
})
