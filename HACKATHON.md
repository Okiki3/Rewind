# REWIND — Hackathon judge guide

**REWIND:** Native NEAR payment protection that wallet developers can integrate without handing user keys to a separate service.

**Track:** Open Innovation (primary); Real-World Money (secondary, if supported by the event rules).

## Problem and approach

A direct settled NEAR payment cannot ordinarily be reversed. Users can mistype a recipient or amount. REWIND adds (1) contextual recipient/amount warnings and (2) a short correction opportunity before final delivery. A signed protected send transfers NEAR into a contract for **exactly 60 seconds**. The recipient cannot access funds during that interval. Only the original sender can cancel. After it ends, an offchain permissionless worker requests delivery, and onchain logic enforces the payout destination and callback-confirmed result.

The contract temporarily holds assets as a technical necessity; REWIND is **not** a generic escrow marketplace and cannot reverse direct transactions outside the protocol.

## Architecture

- `contract/src/lib.rs`: near-sdk native-NEAR payment protection. Sender-only cancel, immutable 60-second period, released/refunded status confirmed by asynchronous callbacks, and recoverable failed payouts.
- `sdk/index.ts`: wallet-independent transaction builders and optional preflight checks. A wallet must **opt in** to routing payments through REWIND. No key custody by the SDK.
- `src/`: React website/reference integration, currently hosted on AfroliteHub at `/rewind`.
- `keeper/`: optional permissionless delivery worker. It cannot accelerate payout before 60 seconds or redirect the recipient.
- `integration/sandbox.mjs`: WASM executed on real local NEAR Sandbox. Runs callback/authorization tests.
- `integration/testnet-proof.mjs`: optional testnet-faucet account creation and signed transfers.

## Step-by-step verification: do X, see Y

1. Run `npm ci && npm run build && npm test && npx tsc --project sdk/tsconfig.json`. **Expect:** clean build and all SDK/frontend tests pass.
2. Run `cargo test --locked` and `cargo build --release --target wasm32-unknown-unknown --locked`. **Expect:** all security/unit tests pass, WASM exists at `target/wasm32-unknown-unknown/release/rewind_escrow.wasm`.
3. Run `npm install --no-save near-workspaces@5.0.0 && node integration/sandbox.mjs`. **Expect:** two protected transfers: sender cancellation succeeds, third-party cancellation and early release fail, and a post-expiry transfer pays the recipient exactly once.
4. Start the website with a **NEW fixed-window deployed contract ID** configured in `.env`. Connect a NEAR Testnet wallet, enter a recipient and amount, and select **Send NEAR**. **Expect:** preflight review appears and the wallet signs a FunctionCall to the contract, not a direct transfer to the recipient.
5. Open the created transfer in history. **Expect:** the contract reports an expiry exactly 60,000 ms after the creation timestamp. Cancel before expiry. **Expect:** funds return and onchain status reads `Cancelled`.
6. Create another protected transfer and leave it. With the keeper configured and running, **expect:** shortly after 60 seconds, it calls `release`, then callback-confirmed status reads `Released`. Worker delays, gas and network confirmations mean this cannot be guaranteed at the exact second.
7. Test an invalid or missing recipient and a contact lookalike. **Expect:** a warning or block before wallet signing. User-defined amount threshold warnings are optional and do not guess intended values.

## Demonstrate wallet integration

See `sdk/README.md`. The wallet SDK builds a standard NEAR FunctionCall that an existing wallet can sign. It is not tied to REWIND's website or a particular wallet provider.

## Safety, limitations, and operational status

- Existing Testnet contract `rewind-1794578605.testnet` uses the **old variable-duration ABI**. It is incompatible with this revised frontend and must NOT be used as proof for the new contract.
- A new fixed-60-second contract ID is required before switching the website.
- Mainnet deployment is **not authorised** until the owner approves and verifies a funded, tiny-value, unaudited demonstration.
- The keeper requires a funded signing account; a worker service with no valid credentials will not release automatically.
- No guarantees of scam detection or universal transaction reversibility.
- Code is experimental and unaudited. Public unrestricted Mainnet usage is unsafe.
- When a recipient transfer fails, the sender retains a refund path instead of funds becoming permanently locked.
- The organiser requires a public repository and public X demonstration by the deadline; the owner will publish only after the working build is accepted. Do not auto-publish.

## Current reproducible results

Check GitHub Actions in the private repo. Only claim contract and chain behavior shown in passing CI and verifiable transactions. Do **not** present earlier variable-window testnet transactions as proof of the revised contract.
