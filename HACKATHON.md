# REWIND — Hackathon judge guide

**REWIND:** Native NEAR payment protection that wallet developers can integrate without handing user keys to a separate service.

**Track:** Open Innovation (primary); Real-World Money (secondary, if supported by the event rules). 

**Hackathon submission links:** [Working Testnet demo](https://afrolitehub.com/rewind/?network=testnet) · [Mainnet contract (paused)](https://nearblocks.io/address/afrolite-rewind-261114.near) · [Source code](https://github.com/Okiki3/Rewind) · [Mainnet proof](MAINNET_DEPLOYMENT_EVIDENCE.md).

## Problem and approach

A direct settled NEAR payment cannot ordinarily be reversed. Users can mistype a recipient or amount. REWIND adds (1) contextual recipient/amount warnings and (2) a short correction opportunity before final delivery. A signed protected send transfers NEAR into a contract for **exactly 60 seconds**. The recipient cannot access funds during that interval. Only the original sender can cancel. After it ends, an offchain permissionless worker requests delivery, and onchain logic enforces the payout destination and callback-confirmed result.

The contract temporarily holds assets as a technical necessity; REWIND is **not** a generic escrow marketplace and cannot reverse direct transactions outside the protocol.

## Additional network support (post-hackathon development)

The one REWIND website now includes a **Testnet / Mainnet** switcher in its navigation.

- **Testnet:** the working, signed and onchain-proven protected-payment flow, including refunds and automatic delivery.
- **Mainnet preview:** live read-only account verification plus a separate deployed V2 Mainnet contract at `afrolite-rewind-261114.near` with `owner=afrolite.near` and `paused=true` (verified 14 Nov 2026). **Mainnet escrow payments are deliberately disabled** pending independent audit and operations review.

Mainnet has a real, owner-authorised contract deployment, but is **not a live real-money payment service**. The frontend performs read-only checks and keeps Mainnet wallet signing disabled. The [V2 deployment evidence](MAINNET_DEPLOYMENT_EVIDENCE.md) records the transaction, onchain hash and paused state. Selecting another network preserves the website route while isolating onchain configuration and transfer records.

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
3. Optional local sandbox check: `npm install --no-save near-workspaces@5.0.0 near-sandbox@0.3.5 && node integration/sandbox.mjs`. **Expect when the bundled sandbox matches the current protocol:** sender cancellation succeeds, unauthorized/early release attempts fail, and the recipient gets paid once after expiry. **Known caveat:** the pinned sandbox runtime can fail WASM deserialization independently of live Testnet behavior. CI runs this check as nonblocking; use the linked verified Testnet transactions below as actual onchain evidence.
4. Open the **working hosted demo** at https://afrolitehub.com/rewind/?network=testnet, or run the site with `.env` pointing to the existing compatible fixed-window Testnet contract `rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet`. Connect a NEAR Testnet wallet, enter a recipient and amount, and select **Review payment**. **Expect:** recipient warnings/review appear first; after confirmation the wallet signs a FunctionCall to the escrow contract, not a direct transfer to the recipient. Never use Mainnet funds.
5. Open the created transfer in history. **Expect:** the contract reports an expiry exactly 60,000 ms after the creation timestamp. Cancel before expiry. **Expect:** funds return and onchain status reads `Cancelled`.
6. Create another protected transfer and leave it. With the keeper configured and running, **expect:** shortly after 60 seconds, it calls `release`, then callback-confirmed status reads `Released`. Worker delays, gas and network confirmations mean this cannot be guaranteed at the exact second.
7. Test an invalid or missing recipient and a contact lookalike. **Expect:** a warning or block before wallet signing. User-defined amount threshold warnings are optional and do not guess intended values.

## Fast judge demo: the working website

1. **Open** [REWIND Testnet](https://afrolitehub.com/rewind/?network=testnet). **See:** a payment-protection homepage and a Testnet/Mainnet switcher.
2. **Connect** a compatible NEAR **Testnet** wallet, including a Bitget in-app browser with the compatible injected NEAR Testnet provider. **See:** the connected Testnet account, with signing controlled by the wallet.
3. **Review** a valid recipient and a small amount of **Testnet tokens**. **See:** an address check before the wallet signs; recipient existence, contract-account and optional known-contact/amount warnings are reviewed.
4. **Submit** a protected payment in your Testnet wallet. **See:** the transfer card appear automatically, showing the onchain status, cancellation timer and transaction hash (when the wallet returns or explorer indexer resolves it).
5. **Cancel** while the transfer is Pending and within the 60-second contract deadline. **See:** a refund state confirmed by the contract; the final refund may need another blockchain confirmation.
6. **Repeat** without cancelling. **See:** after expiry, the independent keeper requests delivery and the status eventually becomes Released. An expired timer alone does not mean delivery is complete.
7. **Switch** to [Mainnet preview](https://afrolitehub.com/rewind/?network=mainnet). **See:** read-only account checks and a live RPC attestation of the deployed V2 escrow's code hash, `afrolite.near` owner and `paused=true`. There is no Mainnet Connect/Send/Cancel action because public deposits are not enabled.
8. **Inspect** the public [wallet SDK guide](sdk/README.md). **See:** independent transaction builders and recipient checks that wallet developers can integrate without supplying signing keys to REWIND.

For a quick review without creating transactions, refer to the verified fixed-window contract and its refund/release examples below. The browser screenshots from CI may include **mocked wallet/provider state** and are UI regression evidence, not substitutes for a signed onchain demo.

## Submission release checks

- [x] Current GitHub Actions on `main` passed contract/frontend tests, mobile browser smoke and a secret scanner across reachable Git history (14 Nov 2026).
- [x] Testnet escrow, cancellation and automated release demonstrated with public NEAR transaction evidence.
- [x] SDK and Mainnet read-only preview are reachable through the hosted website.
- [x] Confirm this GitHub repository is publicly accessible without sign-in. **Confirmed public via GitHub repository metadata on 14 Nov 2026:** https://github.com/Okiki3/Rewind.
- [ ] Attach a **real recorded Testnet flow** or authentic screenshots to a public X post, stating it was built at **NEAR HACKATHON**, tagging `@NEARProtocol` and `#NEARHackathon`.
- [ ] Copy the actual public X post URL.
- [ ] Enter the public repository URL, X demo URL, team contact and a **separate owner-controlled NEAR Mainnet payout account** into the [official form](https://nearhackathon.com/#apply).
- [ ] Complete submission **once** by **14 Nov 2026, 23:59 UTC**.

The payout account is **not** the Testnet escrow or keeper account. Never include its seed phrase or private keys in documentation or submission fields.

## Demonstrate wallet integration

See `sdk/README.md`. The wallet SDK builds a standard NEAR FunctionCall that an existing wallet can sign. It is not tied to REWIND's website or a particular wallet provider.

## Safety, limitations, and operational status

- Existing Testnet contract `rewind-1794578605.testnet` uses the **old variable-duration ABI**. It is incompatible with this revised frontend and must NOT be used as proof for the new contract.
- The corrected fixed-60-second Testnet contract is deployed and proven onchain: `rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet`. Keep frontend and contract ABI aligned.
- Mainnet escrow V2 is **deployed but PAUSED and unavailable for payments**. The read-only website preview verifies the onchain account and contract hash. An independent audit, secure upgrade-key custody, separate funded keeper and controlled settlement checks remain required before financial activation.
- The keeper requires a funded signing account; a worker service with no valid credentials will not release automatically.
- No guarantees of scam detection or universal transaction reversibility.
- Code is experimental and unaudited. Public unrestricted Mainnet usage is unsafe.
- When a recipient transfer fails, the sender retains a refund path instead of funds becoming permanently locked.
- The organiser requires a **public** repository, a public X post with media, and a submission through the official form **before 14 Nov 2026, 23:59 UTC**. Confirm public repository visibility before submitting. Publishing source does not publish excluded `.env` files, but check the complete Git history for sensitive information first.

## Verified fixed-60-second Testnet evidence

- Fresh contract: https://testnet.nearblocks.io/address/rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet
- Refund: https://testnet.nearblocks.io/txns/5RN3qgGTjnqJHNwd4PF6mtooYNdTSMDPsq4hDPBhQDXJ
- Recipient payment after expiry: https://testnet.nearblocks.io/txns/9DyscKayVktERk3xqQtn5sGzztq7H8eFGxNC5CknEeTY
- No-click automatic payout: https://testnet.nearblocks.io/txns/5Kqx2TW6jrw787VaHBCiqX8URk59vz496vTr3RQ7CeC6 ; the keeper finalized transfer #2 without a user-triggered Release.
- GitHub Actions [Testnet smoke test](https://github.com/Okiki3/Rewind/actions/runs/43512886926) and [keeper proof](https://github.com/Okiki3/Rewind/actions/runs/43515254909).
- Unit/SDK/front-end checks pass. JS sandbox runner reports a WASM deserialization compatibility error on an outdated sandbox version; actual current NEAR Testnet execution succeeds. This older sandbox diagnostic is explicitly nonblocking in CI.
- This guide documents the working Testnet submission and the read-only Mainnet preview. The owner completed a paused Mainnet V2 deployment on 14 Nov 2026, with exact evidence in [MAINNET_DEPLOYMENT_EVIDENCE.md](MAINNET_DEPLOYMENT_EVIDENCE.md). No Mainnet customer deposits have been enabled.
