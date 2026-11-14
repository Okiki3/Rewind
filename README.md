# REWIND

**Send NEAR with a chance to correct mistakes before delivery.**

REWIND is an experimental, wallet-integrable payment protection protocol for **NEAR**. A wallet can check a recipient before signing, then route a protected payment through an onchain contract. The sender has a fixed **60-second window** to cancel. If the payment is not cancelled, a permissionless worker requests delivery after expiry; the contract decides when and to whom funds are paid.

> **Status: working NEAR Testnet prototype plus a deployed, initialized, PAUSED NEAR Mainnet V2 candidate. NOT a production financial product.** This is not a way to reverse ordinary NEAR transfers. REWIND can protect only transfers made *through its contract*. The code has not received an independent professional smart-contract audit. Use Testnet funds only.

**Try it:** [Live REWIND app](https://afrolitehub.com/rewind) · [Developer SDK](sdk/README.md) · [Hackathon judge guide](HACKATHON.md) · [Mainnet deployment proof](MAINNET_DEPLOYMENT_EVIDENCE.md) · [Security review (draft PR #11)](https://github.com/Okiki3/Rewind/pull/11)

### Testnet and Mainnet in one website

The website includes a network selector in the navigation. Switching networks reloads the application with an explicit network parameter and **never carries over a Testnet transfer history or contract address into Mainnet**.

| Network | Available today | What it does |
| --- | --- | --- |
| [NEAR Testnet](https://afrolitehub.com/rewind/?network=testnet) | **Fully interactive prototype** | Connect a compatible Testnet wallet, check addresses, send protected test tokens, cancel in the 60-second window, and track confirmed delivery |
| [NEAR Mainnet preview](https://afrolitehub.com/rewind/?network=mainnet) | **Read-only preview** | Verify whether an account exists on Mainnet and review address warnings; **no wallet signing, escrow deposits, withdrawals or Mainnet funds** |

**Mainnet protection is not live.** The owner has deployed a separate **paused** V2 contract candidate at [`afrolite-rewind-261114.near`](https://nearblocks.io/address/afrolite-rewind-261114.near). Its exact onchain hash, owner and paused state were confirmed on 14 Nov 2026 after deployment (see [proof](MAINNET_DEPLOYMENT_EVIDENCE.md)). This is **not** approval for payments: the public site intentionally keeps Mainnet signing and deposits disabled pending independent audit, key-custody review, keeper validation and controlled settlement testing. Selecting Mainnet never converts Testnet funds into real funds.

Developers must continue to use the **Testnet SDK and contract account** for the current demonstration. An unaudited Mainnet contract or a substituted Testnet address is not a valid production integration.

## Why REWIND exists

Native cryptocurrency transfers are generally irreversible once settled. Sending to a mistyped account or entering the wrong amount can be costly. REWIND adds *two opportunities to catch mistakes*:

1. **Before signing:** verify the recipient exists on the intended NEAR network, flag contract accounts and lookalike addresses when wallet-provided contact history is available, and warn about large amounts only when the user provides a threshold.
2. **After the protected transfer is created:** let the original sender cancel before an onchain deadline fixed at exactly 60,000 milliseconds after contract acceptance.

The recipient checks do **not** prove a person's identity, detect every scam or know the amount the sender intended. A confirmed delivery cannot be pulled back.

## What is implemented

| Feature | Current Testnet behavior |
| --- | --- |
| Real NEAR wallet signing | The connected wallet signs each contract FunctionCall; REWIND does not collect seed phrases |
| Recipient preflight | Account existence, RPC failover, contract-account, lookalike, first-time and optional threshold warnings |
| Protected payment | Native NEAR is deposited into the escrow contract, not sent directly to the recipient |
| Fixed correction window | Exactly 60 seconds from the block timestamp recorded by the contract; not a configurable marketing timer |
| Cancel and refund | Only the original sender can request cancellation before expiry, plus supported failed-settlement recovery paths |
| Automatic delivery | Independent, permissionless Railway keeper polls and requests release after expiry; actual confirmation can take longer |
| Status and history | New transfers appear in the status panel after wallet confirmation; recent onchain transfers are shown with status and timestamps |
| Transaction hashes | Creation hashes are shown/copyable when available; historical hashes are recovered from public explorer data when unambiguously matched |
| Public SDK | Lightweight wallet-independent recipient checks and FunctionCall transaction builders with documentation and examples |
| Safety-focused homepage | Practical payment and integration copy; no invented 42-second saving metric or repeated promotional countdown |
| Network switcher | Testnet payment flow and Mainnet address-check preview, explicitly isolating contract IDs and blocking all Mainnet financial transactions |

A wallet that does not integrate REWIND continues to make normal transfers. The SDK does not intercept or reverse transactions initiated elsewhere.

## Architecture

| Path | Responsibility |
| --- | --- |
| `contract/src/lib.rs` | Rust/near-sdk escrow contract; enforces deadline, sender authorization, reserve accounting, release/refund states and callbacks |
| `sdk/index.ts` | Public wallet-neutral transaction builders and optional recipient checks; **no private-key access or signing** |
| `src/` | React reference app: connected wallet, preflight, send, live transfer receipt, cancel, status/history |
| `src/transfer-records.ts` | Recovers authoritative transfer IDs from wallet outcomes, receipt logs or unambiguous onchain history |
| `src/explorer-history.ts` | Read-only public-indexer lookup for historical transaction hashes |
| `keeper/` | Independent delivery worker, funded with its own separate Testnet signing account |
| `server.mjs` and `scripts/publish-sdk.mjs` | Public site and SDK distribution; serve only the SDK JS, TypeScript definitions and integration guide from the SDK endpoint |
| `examples/third-party-wallet/` | Example of using REWIND from an existing wallet without relying on the AfroliteHub frontend |

**Contract methods:** `create_transfer`, `cancel`, `release`, `get_transfer`, `get_transfers_for_account`, `get_pending_transfers`, `get_transfer_count`, `get_total_reserved` and `get_owner`. The asynchronous `on_settle` callback is intended to be callable only by the contract itself.

### Onchain payment lifecycle

1. The connected wallet calls `create_transfer({ recipient })`, attaching the chosen native NEAR payment amount. The contract creates a `Pending` record and reserves the deposit.
2. Until `expires_at_ms`, the original sender may call `cancel`. The payment becomes `Refunding`. Successful callback confirmation finalizes `Cancelled`; a failed refund becomes `RefundFailed` and can be retried by the sender.
3. Once the deadline has passed, anyone may call `release`. The worker normally does this automatically. The payment becomes `Releasing`. A successful callback confirms `Released`.
4. A failed delivery becomes `DeliveryFailed`; retry/recovery options are available according to the contract's status rules, including sender refund recovery.
5. The frontend uses the onchain `expires_at_ms` to calculate remaining time. Wallet approval or a locally rendered countdown alone is **not** proof that money was delivered or refunded.

The keeper's own account signs release requests, **not** user transfers. It cannot change the destination or shorten the cancellation window. It polls about every 10 seconds, but RPC, gas, blockchain finality and worker availability can delay settlement.

## Live Testnet contract and independent evidence

- **Network:** NEAR Testnet only
- **Current fixed-window contract:** `rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet`
- **Contract explorer:** [Open on NearBlocks](https://testnet.nearblocks.io/address/rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet)
- **Correction period:** 60 seconds, enforced onchain
- **V2 Mainnet deployment (separate account, not active for payments):** [`afrolite-rewind-261114.near`](https://nearblocks.io/address/afrolite-rewind-261114.near), initialized `owner_id=afrolite.near`, `paused=true`. See [transaction, exact code hash and source](MAINNET_DEPLOYMENT_EVIDENCE.md).

Historical, verified examples from this **current** contract:

- [Cancellation/refund confirmed onchain](https://testnet.nearblocks.io/txns/5RN3qgGTjnqJHNwd4PF6mtooYNdTSMDPsq4hDPBhQDXJ)
- [Post-expiry recipient payout confirmed onchain](https://testnet.nearblocks.io/txns/9DyscKayVktERk3xqQtn5sGzztq7H8eFGxNC5CknEeTY)
- [Transfer #2 created and later automatically delivered by the keeper](https://testnet.nearblocks.io/txns/5Kqx2TW6jrw787VaHBCiqX8URk59vz496vTr3RQ7CeC6)
- [GitHub Actions signed Testnet proof](https://github.com/Okiki3/Rewind/actions/runs/43512886926) and [keeper proof](https://github.com/Okiki3/Rewind/actions/runs/43515254909)

At the read-only security inspection on **14 November 2026**, the current contract reported **9 historical transfers** and `get_total_reserved = 0`. These are point-in-time blockchain observations, not guaranteed current values.

**Old contract warning:** `rewind-1794578605.testnet` used a different variable-duration interface and is **incompatible** with this frontend and SDK. Do not confuse historical proofs from that contract with the current 60-second implementation.

## Public SDK and developer integration

The homepage intentionally offers the following downloadable files:

| File | Public URL | Purpose |
| --- | --- | --- |
| JavaScript module | [`sdk/index.js`](https://afrolitehub.com/rewind/sdk/index.js) | Preflight recipient checks and transaction builders |
| TypeScript declarations | [`sdk/index.d.ts`](https://afrolitehub.com/rewind/sdk/index.d.ts) | Type hints for wallet developers |
| Integration guide | [`sdk/README.md`](https://afrolitehub.com/rewind/sdk/README.md) | Usage, errors, signing boundary and caveats |

Example:

```js
import { preflight, buildProtectedSendTransaction } from 'https://afrolitehub.com/rewind/sdk/index.js';

const contractId = 'rewind.rewindproof-mwfi8ufi-fa888154e57d.testnet';
const review = await preflight({
  network: 'testnet',
  recipient: 'winner.testnet',
  amountNear: '0.1',
  contacts: [], // optional: supplied by your own wallet
});

if (!review.valid) throw new Error('Address verification failed');
// Display ALL warnings and get explicit user confirmation before signing.
const tx = buildProtectedSendTransaction(contractId, review.recipient, '0.1');
// Your own wallet signs tx's receiverId, methodName, args, gas and deposit.
// Never substitute a direct Transfer action for the protected contract call.
```

The SDK **does not sign transactions** and has no private keys, seed phrases, API credentials, server database or Railway secrets in the verified distributed files. Contract account IDs and RPC endpoints are public by design. Wallet providers keep signing control and must show the actual receiver, amount and method before authorization.

**Public download verification (14 November 2026):** A [read-only GitHub Actions audit](https://github.com/Okiki3/Rewind/actions/runs/43590315944) passed **9/9 live SDK and onchain checks**. All three URLs returned HTTP 200 with expected MIME/CORS settings and content matching the source-built files **byte-for-byte**; a nonexistent SDK path returned HTTP 404. The check is reproducible from `scripts/security-readonly-audit.mjs` in [security-review PR #11](https://github.com/Okiki3/Rewind/pull/11). This verifies a snapshot, not every future deployment.

**SDK update/supply-chain risk:** `/rewind/sdk/index.js` currently uses an **unversioned URL**. A later site deployment could replace its contents, meaning a third-party wallet importing it remotely could run new code without choosing an update. For production integrations, publish immutable versioned releases, pin verified package versions/hashes and retain an explicit compatibility policy. A version-like URL is not sufficient if old files can be overwritten.

## Security review and public-source disclosure

**As of 14 November 2026: suitable to demonstrate only as an experimental Testnet prototype; not approved for unrestricted Mainnet funds.** A targeted internal review is not the same as a full independent professional financial-security audit.

| Security item | Verified state / limitation |
| --- | --- |
| Source credentials | Gitleaks passed checks of current tracked files and reachable Git history; automated scanners cannot guarantee zero missed secrets |
| Public SDK contents | Reviewed public files contain no wallet private keys or backend signing credentials; SDK does not sign |
| Railway delivery key | Keeper signs using a separate Testnet account and persists its key outside GitHub on a mounted `/data` volume |
| Contract upgrade key | Onchain: **1 access key, 1 FullAccess permission**. The holder of the matching private key is **not verified** |
| Smart-contract behavior | Authorization, deadline, failure recovery, reserves and payout race tests run in Rust; source review completed, but no independent formal or production audit |
| JavaScript dependencies | `npm audit --omit=dev --audit-level=high` reported **25 findings: 19 high, 6 low**. Reachability and fixes require review |
| Rust dependencies | RustSec reported **1 vulnerability** (in `crypto-bigint 0.5.5`, advisory `RUSTSEC-2026-0387`) and **2 unmaintained-package warnings**; assess affected build paths |
| Storage and availability | Tiny deposits can consume contract-paid storage; per-account history vectors and keeper scans grow with activity |
| Mainnet security | No production approval, custodial assurance, external penetration test, or professional third-party security certificate |

**Contract ownership is separate from the `owner_id` state field.** The contract currently reports `owner_id` equal to its own account, but that field does not prove upgrade authority. FullAccess keys on the NEAR account control whether code can be redeployed. The Testnet proof generated an ephemeral account key; we have **not** proven that an authorized operator retains its private counterpart. Never paste a private key or recovery phrase into GitHub, a README, a public issue, or the SDK. If control cannot be proven through a safe signed challenge, a **new, owner-controlled deployment** is preferable to taking real deposits.

### Major outstanding security improvements

1. **Dependency remediation:** review each JavaScript and Rust advisory for reachability, remove unused wallet integrations, upgrade compatible dependencies safely and rerun wallet compatibility/browser tests. Do not blindly force breaking upgrades.
2. **Owner/key custody:** prove control of the deployed account's FullAccess key or replace the disposable Testnet deployment with a contract whose keys are safely managed. Keep signing keys off the repository and frontend.
3. **Economic/availability design:** introduce sustainable storage funding and minimum transaction requirements; redesign unbounded onchain account-history vectors and the worker's all-history scan.
4. **SDK release integrity:** publish versioned immutable releases and pinned integration instructions so wallets cannot silently receive changed remote code.
5. **Independent mainnet audit:** commission adversarial contract review of deposits, asynchronous receipts, callbacks, refund paths, storage economics, access-key custody and recovery under failures; retest after fixes.

**Audit details and proposed new checks:** [Draft security review PR #11](https://github.com/Okiki3/Rewind/pull/11), which is **not merged into `main`** as of this update. On that review branch, the existing CI [passed its JS/frontend and Rust contract jobs](https://github.com/Okiki3/Rewind/actions/runs/43591255196), including **20 Rust unit tests**. Its separate security workflow remains **red because dependency advisories are unresolved**, not because the live SDK verification failed. Do not represent passing unit tests as a completed production security audit.

## Run locally

**Requirements:** Node.js 22+, npm, stable Rust and the `wasm32-unknown-unknown` Rust target for compiling the contract. Use NEAR **Testnet** only.

```bash
git clone https://github.com/Okiki3/Rewind.git
cd Rewind
cp .env.example .env
npm ci
npm run dev
```

Configure `VITE_NEAR_CONTRACT_ID` with the current compatible Testnet contract. Build the app and public SDK:

```bash
npm run build
npm start
```

**Important:** Every `VITE_` environment variable is exposed in the browser build. Only place public network identifiers and URLs there. Never put wallet private keys, seed phrases, Railway credentials or secret API tokens in `VITE_` variables or committed files.

### Build and test

```bash
npm ci
npm run build
npm test
npx tsc --project sdk/tsconfig.json
node --test keeper/scan.test.mjs
cargo test --locked
cargo build --release --target wasm32-unknown-unknown --locked
```

Security checks, after checking out [PR #11](https://github.com/Okiki3/Rewind/pull/11):

```bash
node scripts/security-readonly-audit.mjs # public files + read-only Testnet RPC; no signing
npm audit --omit=dev --audit-level=high  # currently reports advisories
```

The existing local NEAR sandbox compatibility step is marked nonblocking in CI because the bundled sandbox runtime has lagged Testnet protocol upgrades. Read [HACKATHON.md](HACKATHON.md) and the CI logs rather than assuming a green top-level build means every security test passed. A fresh signed Testnet proof is available separately.

### Frontend configuration

| Variable | Use |
| --- | --- |
| `VITE_NEAR_NETWORK_ID` | Set to `testnet` for this deployment |
| `VITE_NEAR_CONTRACT_ID` | Compatible fixed-window Testnet escrow account |
| `VITE_NEAR_NODE_URL` | Public NEAR RPC endpoint |
| `VITE_NEAR_WALLET_URL` | Public wallet application URL |
| `VITE_NEAR_HELPER_URL` | Public NEAR helper URL |
| `VITE_BASE_PATH` | `/` standalone, or `/rewind/` when routed under a subpath |

`railway.toml` and `Dockerfile` run an independent React/static frontend with a separately started keeper. The live independent host is [rewind-frontend-production.up.railway.app](https://rewind-frontend-production.up.railway.app) and its `/health` endpoint is available for checks. The intended public reference route is [afrolitehub.com/rewind](https://afrolitehub.com/rewind).

**Keeper configuration:** `NEAR_NETWORK_ID=testnet`, `NEAR_CONTRACT_ID`, `NEAR_RPC_URL`, `POLL_INTERVAL_MS`, and `KEEPER_CREDENTIALS_FILE` are server-side settings. For a disposable Testnet worker, `ALLOW_TESTNET_FAUCET_KEEPER=true` allows initial account bootstrap on a persistent volume. A keeper private key must **never** be published. Do not enable Mainnet worker operation without independent review and explicit authorization.

### Reproducible Testnet-only deployment (new accounts)

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown --locked
# Replace the example account with a NEW account whose signing key YOU securely control.
npx near-cli@4.0.13 create-account <contract-account>.testnet --useFaucet --networkId testnet
npx near-cli@4.0.13 deploy <contract-account>.testnet \
  target/wasm32-unknown-unknown/release/rewind_escrow.wasm \
  --initFunction new \
  --initArgs '{"owner_id":"<contract-account>.testnet"}' \
  --networkId testnet
```

Deployment instructions are **Testnet examples**, not a custody/upgrade plan. Fund contract storage separately. The entire attached `create_transfer` deposit is reserved as the transfer value; it does not provide a sustainable per-transfer storage fee.

## Hackathon submission and remaining work

REWIND is being presented as an **experimental working NEAR Testnet project**, with public documentation, onchain proof, an optional SDK and a standalone app. The [judge guide](HACKATHON.md) explains what to test and what results to expect.

Before final submission:

- [x] Build the current Testnet contract and reference app, with onchain refund and delivery examples.
- [x] Publish public SDK files, integration guide and example (separate from GitHub repository visibility).
- [x] Verify public SDK content and run Git history secret scanning.
- [x] Document known security limitations and the unresolved FullAccess custody issue.
- [ ] **Make the GitHub repository public** once intentionally ready; the repository is currently private.
- [ ] Publish the required public X demonstration showing wallet review, a protected send, immediate transfer status, cancellation and post-expiry delivery.
- [ ] Submit the public repository and demo links using the official hackathon submission process before the organizer's deadline.
- [ ] Review/resolve the open security PR and the outstanding dependency findings separately. These are **production-readiness gates**, not claims that the Testnet demo has been professionally audited.

**Publishing source code is not the same as publishing private keys.** Do not add `.env`, wallet JSON/key files, seed phrases, private signing keys or Railway secrets when changing repository visibility. A public contract ID, transaction hash or public access key is normal blockchain information.

## Historical reference (old variable-duration Testnet contract)

The **original, incompatible** contract `rewind-1794578605.testnet` was used for early proof of refunds, failed-payout recovery and retries. These transactions are preserved for research; they do **not** validate the new fixed-window ABI:

- [Initial deployment](https://testnet.nearblocks.io/txns/Am1ax8RwuCpMjbCVwSKxKg9uXRDUsHCmBJ29PPNVsNPj)
- [Original transfer creation](https://testnet.nearblocks.io/txns/8Xu2R132skKNdNcrY7xPZtHz5zTKm5WEdJu1jkN9Hw2n) and [sender refund](https://testnet.nearblocks.io/txns/2dGcCXuYemEPU51s4ouuuxnmnyFxjkNPDng6S1aVewq5)
- [Second transfer creation](https://testnet.nearblocks.io/txns/AQYonffz2VYEPqze9r8Ma67NN8D9YfV4QaySCqKuAEPD) and [post-expiry release](https://testnet.nearblocks.io/txns/7kbZeZvsusHkSb3FU1xFLpapJ1BJ5E3KhQjsueyhaKdQ)
- [Failed recipient settlement](https://testnet.nearblocks.io/txns/BKGzye6kFvcnBh84MYCKwn4WSF49WSVbrHWoreWJ7N1Z) and [successful retry after recreating the recipient](https://testnet.nearblocks.io/txns/AwPct6oEDyayPm3BPMvkxb4D2UrtMChXLvErnamFC67Z)

---

*Security assessment snapshot: 14 November 2026. This repository is a technical demonstration, not a warranty, an identity-verification service or a guarantee of transaction recovery.*
