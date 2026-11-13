export type TransferStatus = 'Pending' | 'Refunding' | 'Releasing' | 'Cancelled' | 'Released'

export interface Transfer {
  id: string
  sender: string
  recipient: string
  amount: string
  expires_at_ms: string
  status: TransferStatus
  created_at_ms: string
  settled_at_ms: string | null
}

export interface TxState {
  kind: 'idle' | 'wallet' | 'submitted' | 'confirmed' | 'error'
  message: string
  hash?: string
}

