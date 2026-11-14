# REWIND security review — 14 November 2026

**Assessment:** Targeted independent source review, live distribution verification, onchain read-only inspection, dependency analysis, and extended unit tests. **Not** a certified third-party smart-contract audit. **Not approved for production funds.**

**Source:** `Okiki3/Rewind` (base `main` at `657c885ce6a8593597204fcf97e390507a814787`). All proposed changes live on `feat/security-release-review-20261114` pending approval. No live contract upgrade, key rotation, deployment or funds movement was made.

## Verified evidence

- [Read-only live verification run](https://github.com/Okiki3/Rewind/actions/runs/43590315944): **9/9 passed** on 2026-11-14. The three SDK files returned HTTP 200, correct MIME and `Access-Control-Allow-Origin: *`, and matched local source-derived build **byte-for-byte**. Missing SDK file returned 404.
- Public `sdk/index.js` SHA-256: `132e3b558f970688c943615df0561d0a3d33fe610c0ee73aea1b4aa27c0a6e58`. The check recomputes this dynamically rather than trusting a hardcoded hash.
- Onchain read-only Testnet contract: `rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet`. Contract exists with code hash `8WFiJRVvrvySGFrsMnf3wxdpMzz4wWL8RkYSxFdW44Q`; `get_owner` returns contract account ID, `get_transfer_count` returned `9`, and `get_total_reserved` returned `0` at inspection.
- Account permission inspection: **1 access key, 1 FullAccess, 0 restricted**. Only public permissions/counts were printed; no private key values were requested.
- [Prior comprehensive secret scan](https://github.com/Okiki3/Rewind/actions/runs/43541137589): passed for reachable Git history and current tree. Automated secret scanning has false-negative risk.
- JavaScript production dependency command: `npm audit --omit=dev --audit-level=high`: **25 findings (6 low, 19 high)**; no claim that all findings are practically exploitable.
- Contract unit tests in `contract/src/lib.rs` cover sender-only cancellation, release timing, refund/release callbacks, double payout prevention, failures and reserves; this review branch adds five targeted adversarial regression tests for refund/release races and caller permissions. The external callback's NEAR-generated `#[private]` entrypoint check has **not** been independently simulated onchain; direct Rust-method unit calls bypass that generated wrapper.
- The independent keeper signs permissionless `release` operations using a separate key stored in a Railway volume (not in the downloadable SDK). The contract **deploy/access key** is a different security boundary.

## Findings and priorities

### H-01: High — production JavaScript dependency advisories

`npm audit` reports 19 high-severity dependency entries in the production graph (with repeated transitive ancestry). Relevant reported advisories include `base-x` encoding/homograph, `elliptic` cryptographic implementation, `nanoid` invalid input/looping and `decode-uri-component` decoding denial-of-service. Many are pulled through NEAR wallet adapters and wallet SDKs.

**Risk:** Potentially reachable vulnerable code in the browser-wallet integration; dependency presence alone does not prove a practical exploit. **Action:** Make a lockfile inventory by affected package, remove unused wallet adapters, test compatible secure upgrades in a separate branch, regression-test all supported wallets; do **not** blindly use `npm audit fix --force` because it selects breaking wallet versions. The new review workflow fails its JS dependency job until security findings are resolved or individually justified.

### H-02: High — contract FullAccess key custody unverified

Onchain there is still **one FullAccess key** for the deployed Testnet contract account. The source deployment proof creates random ephemeral keys, and there is no verified owner-held private key backup in the repository or the reviewed Railway service configuration.

**Risk:** Possessor of the corresponding private key can change contract code/account keys, regardless of the contract's informational `owner_id` field. It is unknown whether that private key was securely retained, destroyed or compromised. **Action:** Demonstrate control through a harmless *signed challenge* without publishing/sharing the secret; if unavailable, deploy a new contract under an owner-controlled key, set up offline custody and verify access-key permissions before taking real deposits. Do not publicly disclose any secret; do not equate `owner_id` with upgrade authority.

### M-01: Medium — subsidised contract storage can be exhausted (availability/griefing)

`create_transfer` accepts any nonzero attached deposit as **entirely reserved payment**. Creating the transfer also permanently grows the `transfers`, `sender_transfers` and `recipient_transfers` collections and consumes additional contract-paid storage. Repeated tiny payments can consume the independently funded storage buffer and prevent new legitimate payments. `assert_reserves_are_funded` guards fund accounting but does not prevent exhaustion/DoS.

**Action:** Redesign escrow deposit to explicitly cover storage via a separate fee/deposit, set and enforce a rational minimum payment and bounded history/pruning policy, and test storage economics; this may require a new Testnet deployment/ABI change rather than modifying the existing demo.

### M-02: Medium — unbounded per-account history and keeper work

`append_id` stores indefinitely growing `Vec<u64>` values per sender and recipient. `get_transfers_for_account` clones and sorts complete histories even when a page of at most 50 is requested. The keeper scans **every historical transfer ID** on each polling cycle, every ~10 seconds. Processing cost will grow and automatic delivery may lag at scale.

**Action:** Use bounded/paginated indexes and track an incremental pending queue or event-based cursor with persistent retry handling; load-test at high transfer volumes and monitor settlement lag.

### M-03: Medium — mutable public SDK supply-chain risk

The current SDK is deliberately served as unversioned browser-importable `/rewind/sdk/index.js`. It has no embedded keys and the live bytes match source today. But a future redeploy or compromised host can change the content at that same URL without consumers explicitly updating. Because integrators run the code in their wallet apps, unreviewed changes can affect recipient/contract-call construction.

**Action:** Issue immutable releases, versioned distribution artifacts with pinned release hashes, and an explicit compatibility policy. A versioned URL alone is insufficient if past files can be silently overwritten or disappear on redeploy. Encourage host wallets to display and validate transaction receiver/amount before signing; don't use unpinned remote code in production financial wallets.

### L-01: Low/assurance gap — CI sandbox errors tolerated

Existing CI's older NEAR sandbox compatibility test sets `continue-on-error: true`, while live Testnet proofs exist. Do not treat a green CI status as equivalent to passing all security tests. Add up-to-date isolated runtime adversarial testing and audit coverage for async receipt outcomes, storage growth and RPC outages.

### Operational availability and failure behavior

The permissionless worker can be out of funds, offline or delayed; callbacks can fail. The recipient may not receive funds precisely at expiry and an eligible account must submit a release or recovery transaction. The contract currently preserves refund paths after failed payouts. Testnet operation is not a guarantee of production liveness.

## Public SDK security explanation

The SDK is a **transaction builder and recipient-check helper**: it does **not** contain private keys, does **not** sign as a wallet, and uses public contract/account/RPC identifiers. The copyable example on the homepage is public sample code. The current downloadable files do not expose deployment credentials. That assertion is limited to verified current artifacts and does not guarantee future server compromise protection.

## Recommendations and release gates

1. **Hackathon Testnet demo:** acceptable to present as **experimental, unaudited Testnet software**, with explicit limitations, after confirming the GitHub history and publishing only intentional source. Do not publish environment credentials, signing files or secret backups.
2. **Before Mainnet or real-money custody:** address H-01 and H-02; redesign storage payment and indexes (M-01/M-02), release a pinned SDK (M-03), test 2+ external wallet implementations and adversarial async settlement, and obtain an independent professional contract audit with tracked remediation.
3. **No private key is needed to publish source**. Never paste a seed phrase or private key into GitHub, ChatGPT, a public issue or the SDK.
4. Re-run `npm audit --omit=dev --audit-level=high`, RustSec audits, Rust and browser tests, and live SDK bytes after any dependency or contract change.

## Reproducibility

```bash
npm ci
npm run build
node scripts/security-readonly-audit.mjs
npm test
npm audit --omit=dev --audit-level=high
cargo test --locked
cargo build --release --target wasm32-unknown-unknown --locked
```

The read-only audit performs GETs against the public SDK and `query` RPC calls against NEAR Testnet. It does **not** send funds or deploy, modify, sign for, or withdraw from accounts.

**Limitations:** This is a time-bounded, predominantly source-based and CI-backed review; it is **not** a formal verification or a guarantee of freedom from unknown vulnerabilities. Publicly visible onchain key permissions cannot prove who holds the corresponding private key. Vulnerability advisories require reachability validation. The deployed WASM code hash was collected, but exact reproducibility from the current source has not been independently established.
