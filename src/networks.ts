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

/** No Mainnet escrow transactions can be signed through this release. */
export function canUseProtectedTransfers(network: RewindNetwork, contractId: string): boolean {
  return network === 'testnet' && contractId.endsWith('.testnet')
}
