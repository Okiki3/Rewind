import type { NearWalletBase } from '@hot-labs/near-connect'

/** Shape returned by Near Connect wallets and injected NEAR wallet adapters. */
export type FinalExecutionOutcome = Awaited<ReturnType<NearWalletBase['signAndSendTransaction']>>
