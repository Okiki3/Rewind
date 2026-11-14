# REWIND V2 — internal security review (14 November 2026)

> **RELEASE DECISION: NO-GO for public NEAR Mainnet payments.**
> This document is an **internal code and test review** performed with an AI assistant. It is NOT an external auditor's signed report, certificate, penetration test or proof of financial safety. Findings must be independently reproduced and adjudicated by a qualified NEAR auditor.

## Identified deployment

- Mainnet contract account: [`afrolite-rewind-261114.near`](https://nearblocks.io/address/afrolite-rewind-261114.near)
- Owner-signed [DeployContract + initialize transaction](https://nearblocks.io/txns/GJuZ8MrQmRwS6UNCYk3zMHhyA254JCfy4mzMJs3jeA1f)
- Owner's later read-only check returned expected NEAR code hash `BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW`, `get_owner() = afrolite.near`, `is_paused() = true`.
- Expected WASM SHA-256: `9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333`, 219,854 bytes.
- Public sources: [V2 Rust contract](contract-mainnet/src/lib.rs), [Cargo.lock](contract-mainnet/Cargo.lock), [V2 keeper scanner](keeper/scan-mainnet.mjs), [Mainnet SDK candidate](sdk/mainnet-candidate.ts), [release/audit brief](MAINNET_AUDIT_BRIEF.md).
- The deployed WASM is already present onchain; editing the repository **does not change** that deployment. Audit-branch changes are additional `#[cfg(test)]` tests, not permission to upgrade or unpause the installed contract.

## Review methodology and limitations

Manual source inspection of every V2 value-changing entry point, state transitions, storage accounting, callbacks, administrative powers, SDK deposit builder and keeper scanner. Matched source paths to existing Rust tests and reported signed Testnet V2 receipts. Added adversarial Rust regression cases on branch `audit/mainnet-v2-review-20261114` and a read-only/no-deployment CI workflow.

No independent third-party reviewer has signed the code; no formal fuzzing, symbolic analysis, gas-exhaustion fault injection, full node/runtime reproduction, upgraded-contract migration rehearsal, production-load test, external wallet-custody audit or real-valued Mainnet settlement was completed in this review. A hash comparison confirms candidate identity, not safety.

## Findings requiring action

### RWD-01 — HIGH (potential availability/escrow accounting): failed callback *execution* may strand in-flight state

**Evidence:** `cancel()` sets `Refunding`; `release()` sets `Releasing` before scheduling a NEAR transfer. Only `on_settle()`, with **10 Tgas** of callback gas, advances these statuses to `Cancelled`/`Released` or recoverable `RefundFailed`/`DeliveryFailed` (`contract-mainnet/src/lib.rs`, `CALLBACK_GAS`, `cancel`, `release`, `on_settle`). Public cancel and release do **not** allow retries from `Refunding` or `Releasing`.

**Risk hypothesis (not yet reproduced):** If the outbound transfer executes but its callback fails to execute (e.g., insufficient gas or unexpected serialization error), status may remain `Refunding`/`Releasing` indefinitely and `total_reserved` may remain overstated. Blind retry would risk double payment. The existing successful Testnet paths do not prove all callback failure paths recover safely.

**Required remediation/evidence:** independent auditor must force callback execution failure under adversarial runtime/gas/storage conditions, reconcile actual receiver balances and onchain receipts, and design a safe, non-double-paying recovery mechanism if needed. Do not implement an unverified public 'force settle' method.

### RWD-02 — HIGH (key custody/upgrade authority): FullAccess key remains the ultimate contract administrator

**Evidence:** the Mainnet account has a FullAccess public key; the owner deployed with the matching key from local Termux. `get_owner() = afrolite.near` only gates `set_paused()`, **not** NEAR account code upgrades.

**Risk:** possession of a contract account FullAccess private key permits upgrading the contract to arbitrary WASM, bypassing the pause and escrow limitations, regardless of secure Rust logic. The locally exported signing key deserves an incident-safe key custody review; this review cannot establish whether it was retained or copied.

**Required remediation/evidence:** verify exact FullAccess keys and secure recovery/access/rotation plans. Prefer independently reviewed multisig/DAO or custody design before handling third-party funds. Do not paste seed/private keys into CI, GitHub, frontend settings, chat or websites.

### RWD-03 — HIGH (operational readiness): automatic Mainnet settlement not activated or acceptance-tested

**Evidence:** `keeper/index-mainnet.mjs` requires dedicated keeper signer, explicit release gates, exact contract hash and storage-fee check; the operational Railway keeper is configured for Testnet. The Mainnet site deliberately disables payment signing.

**Risk:** opening deposits before a funded Mainnet keeper and monitoring exist could leave payments Pending past the 60-second deadline. This is a delivery delay, not proof of a fund loss, but violates expected end-to-end product behavior.

**Required remediation/evidence:** separately funded keeper with bounded signer permissions, durable cursor, alerting and outage handling; reconciliation of a controlled Mainnet release and refund after the independent audit and owner approval.

### RWD-04 — MEDIUM (financial UX): cancellation does not refund storage fees

**Evidence:** `create_transfer` requires `transfer_amount + 0.02 NEAR`; only `transfer.amount` is paid/refunded. This nonrefundable fee is intentional and documented in the V2 source, but production consent/UX was not verified by an independent user test.

**Required remediation/evidence:** display the nonrefundable storage fee and actual attached total **before wallet signature**, including cancellation, failed-recipient and refund screens. Avoid promising a full total-cost refund.

### RWD-05 — MEDIUM/LOW (operational testing): volume, pagination and gas assumptions are not production load-tested

**Evidence:** up to 2 NEAR per payment, 50 NEAR total pending cap, 0.5 NEAR operating reserve and 0.02 NEAR storage fee; account history offsets capped at 500, pages at 50. The bounded keeper scans 30-ID pages with cursor/tail sampling. Those limits appear intentional, but their worst-case runtime and storage/gas economics have not been proven under sustained adversarial Mainnet load.

**Required remediation/evidence:** fuzz edge-case account IDs, high-volume sender/recipient histories, storage stake drift, callback gas and keeper outages. Ensure fees, cancellation and settlement remain viable during a sustained attack.

## Controls reviewed in source (NOT independently certified)

| Control | Source inspection | Evidence |
| --- | --- | --- |
| Fresh initialization uses contract-account predecessor | Present | `new()` |
| New deposits start paused | Present | `new()` |
| Only owner may change pause | Present | `set_paused()` |
| Only sender may cancel | Present | `cancel()` |
| 60-second onchain deadline | Present | `PROTECTION_WINDOW_MS` and timestamps |
| Exact principal + fee checked | Present | `create_transfer()` |
| Per-payment and aggregate escrow caps | Present | `MIN_PAYMENT`, `MAX_PAYMENT`, `MAX_ESCROWED` |
| Failures from outbound receipts have recovery states | Present *if callback runs* | `on_settle()` |
| Private callback | Present | `#[private]` |
| Storage solvency checks | Present | `assert_solvency()` |
| Owner drain/withdraw method | None found | Public methods reviewed |
| Keeper verifies code hash before signing | Present in candidate | `keeper/index-mainnet.mjs` |
| Mainnet public deposit frontend | Disabled | `src/networks.ts` |

## Existing signed tests and new adversarial tests

Reported real Testnet V2 settlement and recovery proof: [GitHub Actions run 43616110769](https://github.com/Okiki3/Rewind/actions/runs/43616110769). Actual Mainnet deployment and paused status: [MAINNET_DEPLOYMENT_EVIDENCE](MAINNET_DEPLOYMENT_EVIDENCE.md).

Review branch adds Rust regression cases for:

1. Refunding in flight cannot be released after expiry.
2. Failed payout can be retried and finalized without changing principal twice.
3. Owner pause does not block sender recovery after a failed delivery.
4. Total open escrow principal cannot exceed 50 NEAR.

The tests are **not** an independent audit, do not simulate a missing/failed callback receipt, and must pass the isolated Mainnet candidate CI job before being accepted as regression coverage.

## Mandatory release gates

- [ ] External independent NEAR smart-contract security audit of the **exact deployed bytecode + source and pinned dependencies**, with report and remediation recheck.
- [ ] Resolve or authoritatively rule out RWD-01 using a forced callback failure and asset-conservation analysis.
- [ ] Independently review and secure upgrade-key custody and signer recovery.
- [ ] Establish and monitor a funded independent Mainnet keeper (not the existing Testnet keeper).
- [ ] Audit live wallet/dependency executor trust and UX fee disclosure.
- [ ] Under explicit owner-approved limited exposure, test Mainnet payment, sender cancellation/refund, expiry delivery and failed-recipient refund with exact onchain balance reconciliation.
- [ ] Confirm target account's current code hash and pause state immediately before any go-live.
- [ ] Owner signs and records final risk acceptance and explicitly authorises unpause.

Until all gates are complete, **DO NOT** call `set_paused(false)`, do not switch Mainnet frontend payment flags on, and do not market REWIND as an audited financial service.

## Independent auditor handoff

An external reviewer should start with [MAINNET_AUDIT_BRIEF.md](MAINNET_AUDIT_BRIEF.md), this report, the deployed [Mainnet account](https://nearblocks.io/address/afrolite-rewind-261114.near), frozen bytecode hash, and `contract-mainnet/Cargo.lock`. Request an adversarial code review + runtime/fault-injection proofs, written severity-ranked findings, fixed-source review, signed final report and exact code hash attestation. No auditor engagement or certificate has been obtained by creating this document.

**Verdict: deployed and paused for public inspection; not certified; not safe to open to public Mainnet payments based on available evidence.**
