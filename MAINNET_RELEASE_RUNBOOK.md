# REWIND Mainnet: Release Runbook (candidate, not live)

**Status (14 Nov 2026): NOT APPROVED FOR REAL FUNDS.**
This is a separate contract **candidate**, not a migration of the working Testnet escrow. Never upgrade the existing Testnet account with this Rust state layout.

## Owner account selected and publicly verified

- **Proposed owner account:** `afrolite.near` — exists on NEAR Mainnet, with one FullAccess public key.
- **Proposed separate escrow subaccount:** `escrow.afrolite.near` — does not yet exist.
- **Public-only verification:** https://github.com/Okiki3/Rewind/actions/runs/43609112281.
- **Precise setup and owner-signature steps:** [MAINNET_OWNER_SETUP.md](MAINNET_OWNER_SETUP.md).
- **Important:** public keys are not proof of custody, and no escrow account was created or deployed. The new V2 contract is still blocked from real-money activation pending an independent audit and owner-authorized signing.

## What has been engineered

- Independent contract source `contract-mainnet/src/lib.rs`; fixed 60-second onchain protection and sender-only cancellation.
- **Initialization hardened:** only a contract-account-signed transaction may call `new(owner_id)`. This prevents a third party from racing to initialize an uninitialized escrow and assigning themselves as contract owner. The escrow contract must have a secure FullAccess signing key and be initialized from that account; a wallet connected only as `afrolite.near` cannot invoke the initializer as the escrow. Owner-only `set_paused` remains controlled by `afrolite.near`. New adversarial Rust tests added.
- `create_transfer({ recipient, transfer_amount })` requires exact **transfer amount + 0.02 NEAR storage fee**. Storage fee is **not refundable**, including for timely cancellations. The contract checks actual incremental storage is fully covered; no subsidized unbounded account-history vectors.
- **0.01 to 2 NEAR per payment**, max **50 NEAR simultaneously reserved**, minimum **0.5 NEAR independent contract operating reserve** above storage and pending escrow.
- Owner-controlled **pause new deposits only**. Existing cancels, refunds and releases remain possible while paused.
- Bounded, append-only per-account sender/recipient indexes with at most 50 returned records and a 500-entry offset limit. Caller cannot require sorting an entire history.
- Bounded Mainnet release worker with persistent cursor, newest-ID priority and contract-code verification. Keeper signs only permissionless release calls, never customer deposits.
- Mainnet SDK V2 candidate builder and an additional frontend release gate. The frontend requires **all**: `VITE_ENABLE_MAINNET_PAYMENTS=true`, `VITE_NEAR_MAINNET_CONTRACT_ID` with a .near account, and `VITE_MAINNET_EXPECTED_CODE_HASH`. It checks the **live** NEAR Mainnet code hash before connecting and again before every signature.
- Normal site/host defaults remain unchanged: **fully working Testnet, read-only Mainnet** until a separately verified Mainnet contract exists.

## Blocking security / go-live review

- [ ] Commission an **independent NEAR smart-contract security audit**, including asynchronous receipt/callback simulation, storage accounting, payment races, state migrations, gas starvation and unexpected account deletion. Unit tests, a browser mock and an AI code review **are not enough**.
- [x] **Frontend production JavaScript vulnerability remediation implemented in V2 candidate branch:** migrated to NEAR Connect 0.12.0 and removed legacy wallet-selector packages. `npm audit --omit=dev --audit-level=high` now reports **0 known vulnerabilities**; TypeScript build, 35 unit tests and simulated Bitget mobile protected transfers pass. [Audit and build](https://github.com/Okiki3/Rewind/actions/runs/43605502232), [browser regression](https://github.com/Okiki3/Rewind/actions/runs/43605731313). This is **candidate code**, not yet deployed to the live site.
- [ ] **Production wallet E2E and connector trust review remain:** independently test a real desktop MyNearWallet/Meteor signing window, wallet-return callback and real Bitget Android/iOS provider after migration. The new connector's wallet manifest/executor update chain and iframe boundary need explicit source, integrity and permission review. A zero-vulnerability npm audit does **not** mean third-party remotely updated executors are automatically trustworthy.
- [x] **Candidate V2 RustSec audit PASSED:** 0 known vulnerabilities in the **pinned `contract-mainnet/Cargo.lock`**, as tested 14 Nov 2026. The older root Testnet `Cargo.lock` still contains `crypto-bigint 0.5.5`; the new V2 candidate lockfile does not. [RustSec candidate audit](https://github.com/Okiki3/Rewind/actions/runs/43603051354). This does not guarantee the contract itself is free of logic vulnerabilities.
- [ ] Commit and audit the independently compiled `contract-mainnet/Cargo.lock` with the exact WASM build. Check immutable SHA-256 digest as well as the deployed NEAR account's **base58 `code_hash`** (they are distinct hashes).
- [ ] Verify **who controls the Mainnet contract account's actual FullAccess keys**, preferably with a scoped signed challenge and secure key management. Contract `owner_id` is NOT the NEAR account's upgrade authority. Use a managed signer or multi-sig/DAO arrangement approved by the owner. Never paste a private key or seed phrase into ChatGPT, GitHub or a `VITE_` frontend variable.
- [ ] Verify the separate keeper's funded Mainnet NEAR signing account, custody and least required access. Avoid broad Railway admin permissions; enable monitoring, alerts, quotas and disaster recovery.
- [x] **Real onchain V2 Testnet proof completed (14 Nov 2026):** fresh disposable Testnet contract with code-hash verification, storage fee / caps, unauthorized cancel and early-release rejection, exact 60-second expiry, refunded cancellation, automatic keeper-initiated delivery, failed recipient payout followed by sender refund, pause of new payments without blocking existing refunds/delivery, and zero outstanding reserved transfers. See the verified transactions below. This does not replace independent audit or Mainnet acceptance testing.
- [ ] Owner explicitly reviews and accepts the financial risks and signs off on the production release. A funded Mainnet deployment requires wallet signing and cannot be authorized by this checklist alone.

## Verified REAL V2 deployment and immutable build evidence

- **Deployed ephemeral Testnet V2 contract:** `escrow.rewind-v2-mwghg491-45a9d31f.testnet`
- **Onchain NEAR `code_hash`:** `EnNHVY88UeBbQkpvRMN6bCgszfztGbh88qe49EFsNrU`
- **WASM SHA-256:** `0387d8dc9a975d4da82f87d418bf2d4d2f51283990f91bc76c94603165d81579`
- **CI full test:** https://github.com/Okiki3/Rewind/actions/runs/43603269956
- **Testnet explorer:** https://testnet.nearblocks.io/address/escrow.rewind-v2-mwghg491-45a9d31f.testnet
- **Initial cancellation/refund:** https://testnet.nearblocks.io/txns/D7fpHW6vR6eNwVdJJxdgkCUAsvEwcfor1MaaWZfobBWn
- **Released after expiry by bounded keeper:** https://testnet.nearblocks.io/txns/9iDiTcsWvsVM1pSbDxoBnaJnHXFpdNnzBVaCdkWBvQMy (creation transaction); the same CI job invoked the actual keeper scanner after the deadline without a recipient click
- **Recovery refund after a failed payment to a missing account:** https://testnet.nearblocks.io/txns/axAM6UmXTyBx4hj3HFbDemhdn3SfRtT4SgsujeArqgE
- **Confirmed onchain end state:** all V2 transfers resolved; `get_total_reserved()` = `0`.
- **Additional independent read-only finality verification of previous V2 run:** https://github.com/Okiki3/Rewind/actions/runs/43603357365

These receipts use **Testnet tokens only** and disposable keys generated in CI memory. There is still **no** Mainnet escrow account or user-authorized Mainnet funds.

## Mainnet deployment (only AFTER all prerequisites)

1. Build the pinned candidate WASM from reviewed source on a controlled machine. `cargo test --manifest-path contract-mainnet/Cargo.toml --locked` and `cargo build --manifest-path contract-mainnet/Cargo.toml --release --target wasm32-unknown-unknown --locked`. **Do not use any compiled mock fixture as the deployed code.**
2. Create a **new** owner-controlled Mainnet account for the escrow, with secure FullAccess key custody. Deploy the independently vetted WASM, then initialize with `new({owner_id: "afrolite.near"})` in a contract-account-signed transaction (not an arbitrary dApp user's wallet transaction). The hardened contract rejects third-party initialization. Where supported, prefer a deploy+init in a reviewed transaction flow, with no public uninitialized deployment gap. Keep all account keys under your own control; never add them to repository files.
3. Fund the contract independently for byte-cost storage and gas; the 0.02 NEAR fee funds per-transfer storage. The escrow's 50 NEAR exposure cap does NOT make it risk-free.
4. Read the new Mainnet account via NEAR RPC `query` / `view_account`, record its `code_hash`, check the FullAccess key list, and compare with the audited deploy artifact. Confirm `get_storage_fee`, `get_min_payment`, `get_max_payment`, `get_total_reserved`, `get_owner`, and `is_paused` output.
5. Set up a separate private Mainnet keeper service only after approval. Env variables: `NEAR_NETWORK_ID=mainnet`, `NEAR_CONTRACT_ID`, `NEAR_RPC_URL`, `KEEPER_ACCOUNT_ID`, `KEEPER_PRIVATE_KEY`, `MAINNET_EXPECTED_CODE_HASH`, `KEEPER_CURSOR_FILE`, `ENABLE_MAINNET_KEEPER=I_ACCEPT_MAINNET_RISK`, `MAINNET_RELEASE_APPROVED=REVIEWED_AND_AUTHORIZED`. All signer credentials must be private server-side secrets.
6. Independently verify correct production behavior with owner-approved limited Mainnet exposure. Validate all onchain balances and receipts (including refund and automatic release), monitor gas and RPC delays, and keep the pause/recovery procedures ready.
7. **Only after those checks**, configure the reference website's **public, nonsecret** variables `VITE_NEAR_MAINNET_CONTRACT_ID` and `VITE_MAINNET_EXPECTED_CODE_HASH`, then set `VITE_ENABLE_MAINNET_PAYMENTS=true` and deploy the reviewed frontend. Do not put private keys in frontend config.
8. Confirm the public site signs contract method `create_transfer` with **`transfer_amount`** and the **amount + 0.02 NEAR fee**, and that cancelling refunds only the protected amount. Repeat network-switch regression tests and verify code hash on every payment.

## Important compatibility notes

- **Testnet V1** attaches the entire amount as a `create_transfer({recipient})` deposit; the deployed contract is unchanged.
- **Mainnet V2 candidate** requires `create_transfer({recipient, transfer_amount})` and an additional, disclosed non-refundable storage fee. Do not point the V1 SDK builder at V2 or vice versa.
- The expected code hash is a **deployment attestation** and not proof of audit quality. NEAR upgrade authority must be protected separately.
- The keeper's `release` method remains permissionless but onchain validates expiry and recipient destination; worker processes and RPC availability can delay execution.
- Do **not** copy `MAINNET_RELEASE_APPROVED` values from test fixture CI into a production deployment without owner authorisation. CI fake provider tests make no real Mainnet calls.
- Even after an audit, real funds always carry residual smart-contract and operational risk.

**Current live user-facing experience remains**: [Testnet working](https://afrolitehub.com/rewind/?network=testnet), [Mainnet preview only](https://afrolitehub.com/rewind/?network=mainnet). No Mainnet contract has been deployed through this branch.
