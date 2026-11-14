# REWIND SDK for NEAR wallets

REWIND is an optional payment protection layer that NEAR wallets can integrate into their own Send flow. The SDK checks NEAR recipient details and prepares transactions for the REWIND contract. Your existing wallet signs transactions. REWIND never asks for your users' private keys.

**Status:** Testnet prototype. The contract and SDK are unaudited. Do not offer real-money payments or promise that an ordinary direct NEAR transfer can be reversed.

## Public SDK files

- [JavaScript ES module](https://afrolitehub.com/rewind/sdk/index.js)
- [TypeScript definitions](https://afrolitehub.com/rewind/sdk/index.d.ts)
- [This integration guide](https://afrolitehub.com/rewind/sdk/README.md)

The JavaScript module is intentionally public. It has no runtime dependencies and supports cross-origin browser imports. The GitHub repository can remain private while you demonstrate integration.

## Current Testnet deployment

- **Contract:** `rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet`
- **Network:** NEAR Testnet
- **Protection:** a fixed 60-second cancellation period enforced onchain
- **Delivery:** requested after expiry by an independent permissionless release worker; actual settlement depends on blockchain confirmation

The SDK is not a wallet connector or a transaction signer. Developers must connect their own NEAR wallet integration and expose the payment review and status UI.

## Basic wallet integration

```js
import {
  preflight, buildProtectedSendTransaction, buildCancelTransaction,
} from 'https://afrolitehub.com/rewind/sdk/index.js'

const contractId = 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet'
const amountNear = '0.1'
const recipient = 'winner.testnet'

// Contacts and recent recipients must come from YOUR wallet's local data.
const review = await preflight({
  network: 'testnet',
  recipient,
  amountNear,
  contacts: [],
  recentRecipients: [],
})

// Show ALL warnings to the user. A warning about a lookalike account does
// not by itself make review.valid false, so the user still needs to decide.
if (!review.valid) throw new Error('Recipient verification failed')

// After the user reviews recipient and amount, prepare a FunctionCall:
const tx = buildProtectedSendTransaction(
  contractId, review.recipient, amountNear,
)
// tx has receiverId, methodName, args, gas and deposit (in yoctoNEAR).

// Example with an already connected @near-wallet-selector wallet:
// const wallet = await selector.wallet()
// const result = await wallet.signAndSendTransaction({
//   receiverId: tx.receiverId,
//   signerId: connectedAccountId,
//   actions: [
//     actionCreators.functionCall(
//       tx.methodName, tx.args, BigInt(tx.gas), BigInt(tx.deposit)
//     ),
//   ],
// })
// Verify a successful onchain outcome before displaying "Payment sent".
```

`create_transfer` returns a JSON transfer record in NEAR's encoded `SuccessValue`. This includes the transfer ID, original recipient, amount, creation timestamp and `expires_at_ms`. If a wallet connector omits the returned value, look for `TRANSFER_CREATED:<id>` in the transaction receipt logs. As a read-only fallback, query `get_transfers_for_account` and `get_transfer`; do not guess an ID or submit the payment again.

Use the exact `expires_at_ms` returned by the contract when showing the cancellation countdown, rather than starting 60 seconds after the frontend receives confirmation.

## Cancelling or tracking a transfer

```js
// transferId comes from the confirmed onchain transfer record.
const cancelTx = buildCancelTransaction(contractId, transferId)
// Sign using the original sender's connected wallet, before expiry.

// Read-only NEAR contract queries:
// get_transfer({ transfer_id: transferId })
// get_transfers_for_account({ account_id: connectedAccountId })
```

The contract permits cancellation only by the original sender during the protection period (with explicit retry paths for onchain settlement failures). An expiry does not reverse the chain. After expiry, anyone can call `release`; the worker normally requests this automatically. The recipient only receives funds after confirmed settlement.

## Security and limitations

- This SDK has no wallet seed phrase, private key, API secret, payment database or server credentials. Contract IDs and network endpoints are public by design.
- It **cannot** undo regular NEAR transfers performed outside the REWIND contract or payments already delivered by REWIND.
- Recipient checks verify whether a NEAR account exists and can compare it with contacts or history provided by the host wallet. They do not prove which person the sender intended to pay.
- Some valid accounts are smart contracts. They may appear in a review warning, but that is not a fraud verdict.
- Your wallet must display the actual contract call and amount to the sender before signing. Always check contract status after broadcasting.
- For this hackathon build, use Testnet funds only. A distinct Mainnet deployment and independent security review are needed before production use.
- This documentation and SDK are public; the private repository and Railway worker's signing key are not published as part of the SDK.
