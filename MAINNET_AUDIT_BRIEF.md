# REWIND Mainnet V2 — Independent Audit Brief

## Scope and release status

**Status: NO-GO for Mainnet real funds.** Review this exact candidate before approving deployment or enabling production frontend/keeper flags. The Testnet V1 contract currently serving `/rewind` is a different state layout and ABI; it must not be upgraded in place.

Exact source and pinned dependencies:
- `contract-mainnet/src/lib.rs`
- `contract-mainnet/Cargo.lock`
- `sdk/mainnet-candidate.ts`
- `keeper/scan-mainnet.mjs` and `keeper/index-mainnet.mjs`
- `src/near.ts`, `src/mainnet-attestation.ts`

## Threat model

Assets: customers' temporary NEAR escrow balances, sender refund rights, declared recipient destination, storage reserve and operator/keeper signing authority.

Trust assumptions: NEAR runtime processes receipts asynchronously and in order; the deployed account's FullAccess keys remain under an approved multisig or secure owner custody; wallet UI accurately displays the contract ID, method, attached NEAR and storage charge. Testnet CI's ephemeral keys are **not** a Mainnet key-management method.

Attacker capabilities: arbitrary accounts can submit deposit calls, trigger permissionless release attempts, create missing recipient IDs, generate a large volume of transfers, attempt callbacks and unauthorized cancels, and cause RPC/keeper outage. The attacker could compromise a browser-side dependency or keeper if those systems aren't adequately isolated. A compromised FullAccess key can upgrade arbitrary contract code regardless of the `owner_id` field.

## Contract invariants to verify independently

1. `create_transfer` only succeeds with exact `transfer_amount + 0.02 NEAR`. Transfer principal is `transfer_amount`; storage fee remains non-refundable, including after sender cancellation. Check actual storage delta for *maximum-length sender and recipient accounts*, repeated transfers, and new index-key boundaries.
2. Minimum principal 0.01 NEAR; maximum 2 NEAR; maximum simultaneously reserved 50 NEAR. New transactions are rejected if aggregate reserve or contract storage/operating requirements fail.
3. `expires_at_ms = created_at_ms + 60_000` and caller cannot override it.
4. Only the recorded sender may cancel before expiry. No third party can alter the intended recipient, refund destination or amount.
5. Release can only begin at expiry or later. Initiating a payout moves status to `Releasing` / `Refunding` before the promise dispatch; no concurrent duplicate release/cancel is allowed.
6. The NEAR runtime-only `#[private]` callback records `Released` / `Cancelled` **only on successful outbound receipt**. Failed recipient delivery stays `DeliveryFailed` and remains sender-refundable; failed sender refund stays `RefundFailed` and remains retryable after expiry.
7. Pause applies only to new deposits. Existing users can still cancel/refund and keepers can still release.
8. Bounded account history: two append-only index lists and a cursor merge, capped at 50 returned records and max 500 skipped; no state-changing function rewrites a whole sender history.
9. Bounded keeper scans: cursor progresses over historical ID ranges and checks recent tail each poll; no duplicate signature or premature release. A keeper outage cannot change onchain sender/recipient permissions.
10. Every paid deposit leaves sufficient NEAR for byte-cost storage, independent operating reserve and outstanding escrow; nobody can withdraw reserved funds except through designated, callback-confirmed payout methods.

## Real-chain evidence, not just mocks

- **Testnet V2 contract:** `escrow.rewind-v2-mwglgeow-a4bd9385.testnet`
- **Onchain NEAR `code_hash`:** `A7cptN7Nbks1Mi8GbPozwFvhqdEXgH5dW1cmwW3E2Huv`
- **WASM SHA-256:** `876b2ce33694813263a44093471cd1119e59a1ce036c0469e9802aa7e0937bb5`
- **Passing real Testnet workflow:** https://github.com/Okiki3/Rewind/actions/runs/43613229545
- **Initial sender refund:** https://testnet.nearblocks.io/txns/D7fpHW6vR6eNwVdJJxdgkCUAsvEwcfor1MaaWZfobBWn
- **Failed-delivery recovery refund:** https://testnet.nearblocks.io/txns/axAM6UmXTyBx4hj3HFbDemhdn3SfRtT4SgsujeArqgE
- **Separate finality/reconciliation workflow:** https://github.com/Okiki3/Rewind/actions/runs/43603357365
- Completed transfers all resolved; `get_total_reserved()` returned `0`. Tokens were **Testnet only**.

## Dependency audit

- Candidate `contract-mainnet/Cargo.lock`: RustSec found **0 known vulnerabilities** on 14 November 2026: https://github.com/Okiki3/Rewind/actions/runs/43603051354.
- **V2 candidate frontend:** migrated to Near Connect 0.12.0, removing the legacy NEAR Wallet Selector dependency chain. Production `npm audit --omit=dev --audit-level=high` now reports **0 vulnerabilities**: https://github.com/Okiki3/Rewind/actions/runs/43605502232. The new wallet chooser and mobile Bitget simulated-payment regression passed: https://github.com/Okiki3/Rewind/actions/runs/43605731313.
- **Live site:** still runs the older wallet selector until actual desktop MyNearWallet/Meteor wallet approvals are manually verified on the new connector. Its previous dependency scan reported 19 high / 6 low findings.
- **Remaining trust boundary:** Near Connect fetches wallet metadata and executor scripts from third-party origins. Even a zero-known-vulnerability npm audit does not validate mutable executor code. Review executable origins, manifest integrity, iframe isolation, wallet-origin identity and the transaction shown for approval before production rollout.

## Deployment/custody decisions required from the owner

- Choose a **new separately controlled NEAR Mainnet account**, then verify its FullAccess/upgrade keys and owner control. NEVER share seed phrases or FullAccess private keys with ChatGPT, GitHub or frontend build variables.
- Independent auditor reviews exact source, pinned dependencies and compiled WASM. Obtain signed findings and evidence that critical issues are resolved.
- Arrange separate keeper funds, signing custody, durable cursor storage, monitoring, incident alerts and an emergency-pause process.
- Only after authorisation: controlled low-value Mainnet settlement with complete onchain reconciliation; then enable frontend via matching contract ID + `code_hash` and explicit deployment flag.
- No public website, keeper or smart contract should be described as Mainnet-payment capable until these prerequisites have been fulfilled.

This checklist does not constitute a professional independent security audit or guarantee against loss of funds.
