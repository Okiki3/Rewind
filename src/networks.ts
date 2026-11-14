/** Runtime network selection for the one REWIND website.
 * The selected network is encoded in the URL, so reloading reconstructs the
 * NEAR Wallet Selector with the correct RPC and avoids mixing session state.
 * Mainnet remains a READ-ONLY PREVIEW until an audited escrow is available.
 */
export type RewindNetwork = 'testnet' | 'mainnet'

export function selectRewindNetwork(search: string, defaultNetwork: string = 'testnet'): RewindNetwork {
  const explicit = new URLSearchParams(search).get('network')
  if (explicit === 'testnet' || explicit === 'mainnet') return explicit
  return defaultNetwork === 'mainnet' ? 'mainnet' : 'testnet'
}

export function networkSwitchHref(href: string, network: RewindNetwork): string {
  const url = new URL(href)
  url.searchParams.set('network', network)
  return url.pathname + url.search + url.hash
}

/** Mainnet must be deliberately approved, configured with a named Mainnet contract
 * and pinned to an onchain code hash. This is only the first gate; the wallet
 * adapter also verifies the live code hash directly before every signature. */
export function canUseProtectedTransfers(
  network: RewindNetwork,
  contractId: string,
  mainnetApproved = false,
  expectedCodeHash = '',
): boolean {
  if (network === 'testnet') return contractId.endsWith('.testnet')
  return mainnetApproved && contractId.endsWith('.near') &&
    /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(expectedCodeHash)
}
