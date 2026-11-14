# REWIND Mainnet readiness plan

**Status (14 Nov 2026): NOT RELEASE-READY. Preparation only.**

The live REWIND reference app and current escrow contract remain **Testnet-only**. This document authorizes **no Mainnet deployments, account creation, contract upgrades, fund transfers, SDK publication or changes to Railway production**. The source includes some Mainnet network support; compiling a Mainnet frontend is **not** evidence that payments are safe.

## Critical distinction for the hackathon

The NEAR HACKATHON accepts a working prototype and asks for a **Mainnet NEAR wallet address for prize payouts**. It does not require deploying REWIND's payment contract on Mainnet. Publish the repository, demo on X and submit before **14 Nov 2026 23:59 UTC**. Keep the known-good Testnet demo available to judges. The Mainnet payout account is separate from the Rewind contract.

## Blocking release gates

1. **Onchain escrow security and economic controls:** repair or mitigate tiny-deposit spam that consumes contract-funded storage; define minimum amount and explicit storage funding. Replace unbounded per-account history retrieval and naive keeper all-history scans; exercise scale and gas limits. Confirm all promise failure/retry paths and prevent duplicate payments.
2. **Dependency vulnerabilities:** assess every currently reported high-severity JavaScript advisory (`npm audit --omit=dev --audit-level=high` previously reported 19 high and 6 low) and RustSec advisory `RUSTSEC-2026-0387` involving `crypto-bigint 0.5.5`, plus unmaintained package warnings. Upgrade or remove dependencies where safe, verify reachability and document any remaining exceptions. Do **not** blindly force breaking wallet-selector updates.
3. **Independent security review:** engage qualified independent NEAR smart-contract auditors, provide exact Rust source/locked dependencies/WASM artifact and threat model, fix findings, obtain an explicit production decision. A source review and successful unit tests alone are not a production audit.
4. **Upgradeable contract custody:** use a **new Mainnet account** securely controlled by the project owner. Verify the onchain access keys and establish a key-rotation, upgrade and state-migration policy (multi-signature/DAO or deliberate immutability, as appropriate). The Rust `owner_id` field is *not* the key that controls deployment. Never export private keys into GitHub, client code, logs or chat.
5. **SDK distribution:** publish reviewed, immutable, versioned SDK artifacts and pin hashes; never have a production wallet import an automatically changing `/sdk/index.js` without an integrity policy. The homepage's current example and the public integration guide use the **Testnet contract ID** and must be updated and independently reviewed for any Mainnet release.
6. **Operational safeguards:** isolate Mainnet frontend, RPC configuration, contract and keeper from Testnet. Require distinct funded operator credentials with least possible permissions; use signer custody appropriate to the value at risk, monitoring, balance/gas alerts, RPC failover, outage recovery and incident procedures.
7. **Wallet/network verification:** ensure MyNearWallet, Meteor, Sender, NEAR Mobile and Bitget's injected NEAR provider behave correctly on Mainnet. Bitget mobile currently implements a Testnet-demo-specific network-error message; make the message network-specific. Onchain contract account, wallet signers, explorer and RPC must all agree on `mainnet`.
8. **Release and recovery tests:** isolated contract deployment with a controlled Mainnet account, a *tiny* owner-authorized payment **only after all prior gates**, cancellation-before-deadline, automatic release-after-deadline, failure simulation, refund/retry and contract balance reconciliation. Publish the exact WASM hash and verified source, plus a Mainnet-specific README, deployment address and risk notice.

## Current source posture

- `src/near.ts`: supports selecting a network and Mainnet RPC/wallet URLs, but this is configuration, **not a vetted production release**.
- `keeper/index.mjs`: deliberately blocks Mainnet unless `ENABLE_MAINNET_KEEPER=I_ACCEPT_MAINNET_RISK` and explicit credentials are supplied. **Do not bypass or set this flag during readiness work.**
- `contract/src/lib.rs`: Testnet demonstration implements one-minute escrow and caller restrictions. The storage and indexing design needs remediation before real-value use.
- `sdk/index.ts` and homepage example: public helpers, not transaction signers. Current examples are Testnet-oriented.
- `MAINNET_READINESS.md` and `.github/workflows/mainnet-build-check.yml` are preparation artifacts only.
- Existing [security review PR #11](https://github.com/Okiki3/Rewind/pull/11) contains the preliminary security report and adversarial tests. Its security workflow is **not green** due to dependency advisories.

## Safe offline Mainnet **compile** check

A build compiles browser code using a **non-live placeholder contract ID**, with **no keys**, **no signing** and **no Mainnet transaction**. The build should not be deployed to any production host or linked from the current Testnet site.

```bash
npm ci
VITE_NEAR_NETWORK_ID=mainnet \
VITE_NEAR_CONTRACT_ID=not-deployed.invalid \
VITE_NEAR_NODE_URL=https://rpc.mainnet.fastnear.com \
VITE_BASE_PATH=/rewind/ \
npm run build
npm test
```

The associated GitHub workflow runs the offline compile check on this branch and performs no deployment. Note that a fake contract ID is **only** a build fixture; it is never a destination for real payments.

## Release decision

**NO-GO** for Mainnet contract deployment, real deposits, or Mainnet keeper activation until the blockers above are fixed, tested and an authorized owner signs off on the exact code, account, funds at risk and operational plan.

The safest next step for the hackathon is to submit the verified Testnet product, *then* finish Mainnet engineering on this separate branch.
