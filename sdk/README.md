# REWIND third-party wallet integration

REWIND is a wallet-agnostic native NEAR payment-protection contract. Your own wallet signs ordinary NEAR FunctionCall transactions; no REWIND wallet account, key custody or web login is required.

## SDK quickstart

Compile the TS package using npm in the repository root:

    npx tsc --project sdk/tsconfig.json

For a host wallet app, import the compiled module from sdk/dist/index.js or bundle sdk/index.ts directly. No SDK runtime dependencies are required.

    import { preflight, buildProtectedSendTransaction, buildCancelTransaction } from '@rewind-near/sdk'

    const review = await preflight({
      network: 'testnet', // set 'mainnet' only after a verified mainnet contract exists
      recipient: 'winner.testnet',
      amountNear: '1',
      contacts: [{ name: 'Winner', address: 'winner.testnet' }],
      recentRecipients: [],
    });

    // Render review.warnings to the sender before they approve the payment.
    // Host wallet signs this standard NEAR FunctionCall:
    const tx = buildProtectedSendTransaction('DEPLOYED_CONTRACT.testnet', 'winner.testnet', '1');
    // tx.receiverId, tx.methodName, tx.args, tx.gas and tx.deposit
    // Convert to your wallet SDK's native action encoding.
    // Wallet Selector: actionCreators.functionCall(tx.methodName, tx.args, BigInt(tx.gas), BigInt(tx.deposit))

    // In your receipt/activity screen, offer a subtle cancel link before expiry:
    const cancelTx = buildCancelTransaction('DEPLOYED_CONTRACT.testnet', '0');
    // Sign with the original sender's connected wallet.

After a successful create_transfer, read transfer ID from TRANSFER_CREATED:<id> log and display it. Query get_transfer and get_transfers_for_account for true onchain state.

**Fixed 60-second protection is enforced by the contract.** Never send an expiry argument; a host wallet cannot override the period. Use the block timestamp in the returned transfer, not the wallet's signing click time.

A small permissionless keeper calls release after expiry. Delivery depends on worker uptime, chain confirmation and RPC availability, so don't promise exact-second release. Any party can trigger release manually as a fallback after the deadline.

## Threat model and integration notes

- A completed ordinary direct transfer outside REWIND is not reversible.
- Preflight only compares against contacts/history provided by the wallet and actual RPC data. It cannot establish which account the sender intended.
- Accounts with smart-contract code are not automatically scams.
- Host wallets are responsible for showing trustworthy transaction signing and network state.
- Contract funds are temporary and protected by unaudited code; do not market as production-ready.
- Do not connect mainnet to the existing variable-duration testnet contract. Deploy a fresh contract with the corrected interface and verify it onchain.
