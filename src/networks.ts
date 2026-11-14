/** Runtime network selection for the one REWIND website.
 * The selected network is encoded in the URL, so reloading reconstructs the
 * NEAR Wallet Selector with the correct RPC and avoids mixing session state.
 * Mainnet is read-only by default; explicit ?demo=1 allows a separate hackathon flow.
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

/** Explicit Mainnet demo opt-in is distinct from the default read-only preview. */
export function canUseProtectedTransfers(network: RewindNetwork, contractId: string, mainnetDemo = false): boolean {
  if (network === 'testnet') return !!contractId && contractId.endsWith('.testnet')
  return mainnetDemo && contractId === 'afrolite-rewind-261114.near'
}
