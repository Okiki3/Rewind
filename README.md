# REWIND

## Current development status (new fixed-60s protocol)

**The current Mainnet/testnet production sites have NOT yet been upgraded to this revision.** Existing testnet proofs below relate to the earlier variable-duration contract. They verify earlier escrow mechanics, NOT the new fixed-60-second implementation.

This private feature branch introduces:
- An immutable 60-second cancellation period computed inside the smart contract.
- A small wallet-neutral TypeScript library in `sdk/` exposing preflight checks and NEAR transaction builders.
- A modest change to the normal Send NEAR UI: quiet helper copy below Send, contextual warnings and a small cancellation action in transfer details.
- A separate optional permissionless settlement worker in `keeper/`, which must be deployed and funded before automated delivery can happen.
- A new safe refund-failure state, so an unsuccessful cancellation cannot later be delivered.

**Critical:** The existing testnet contract `rewind-1794578605.testnet` still takes a caller-supplied expiration and is NOT compatible with this frontend revision. Do not deploy the new frontend against that old contract. Deploy a fresh contract account after testing and configure the frontend with its new ID.

### Checks and builds

```bash
npm ci
npm run build
npm test
npx tsc --project sdk/tsconfig.json
node --test keeper/scan.test.mjs
cargo test --locked
cargo build --release --target wasm32-unknown-unknown --locked
```

Run `npm install` inside `keeper/` to install its independent NEAR signer dependency. For auto-release, create a separate Railway **worker** service from this repository with root directory `/keeper`, start command `npm start`, and configure `NEAR_NETWORK_ID`, `NEAR_CONTRACT_ID`, `KEEPER_ACCOUNT_ID` and `KEEPER_PRIVATE_KEY` securely (never commit secrets). The worker wallet needs enough NEAR to cover gas. Without a live keeper, delivery must be manually triggered after the period expires.

A wallet provider can integrate the protocol without opening this site; see [SDK integration guide](sdk/README.md). The SDK returns a NEAR FunctionCall object and the host wallet performs the signing. Only payments intentionally routed through REWIND qualify for cancellation.

**Mainnet is intended only for a limited, owner-approved smoke test** after verified Testnet deployment and security checks. This remains unaudited financial code. Do not send Mainnet funds to the old testnet contract ID or interpret prior testnet receipts as proof that the new version is deployed.


Protected, cancellable native NEAR transfers. REWIND locks a deposit in a Rust escrow contract, lets only its sender cancel before a fixed deadline, and permits release to the recipient after that deadline. Settlement becomes final only after the NEAR transfer promise succeeds.

> Experimental, unaudited Testnet software. Do not send Mainnet funds. A limited Mainnet demonstration requires explicit owner approval.

## Verified Testnet deployment

- Contract: `rewind-1794578605.testnet`
- Network: NEAR Testnet
- Contract deploy + initialization: [`Am1ax8RwuCpMjbCVwSKxKg9uXRDUsHCmBJ29PPNVsNPj`](https://testnet.nearblocks.io/txns/Am1ax8RwuCpMjbCVwSKxKg9uXRDUsHCmBJ29PPNVsNPj)
- Protected transfer #0 creation (0.01 NEAR): [`8Xu2R132skKNdNcrY7xPZtHz5zTKm5WEdJu1jkN9Hw2n`](https://testnet.nearblocks.io/txns/8Xu2R132skKNdNcrY7xPZtHz5zTKm5WEdJu1jkN9Hw2n)
- Sender refund with successful callback: [`2dGcCXuYemEPU51s4ouuuxnmnyFxjkNPDng6S1aVewq5`](https://testnet.nearblocks.io/txns/2dGcCXuYemEPU51s4ouuuxnmnyFxjkNPDng6S1aVewq5)
- Protected transfer #1 creation (0.01 NEAR): [`AQYonffz2VYEPqze9r8Ma67NN8D9YfV4QaySCqKuAEPD`](https://testnet.nearblocks.io/txns/AQYonffz2VYEPqze9r8Ma67NN8D9YfV4QaySCqKuAEPD)
- Post-expiry recipient release with successful callback: [`7kbZeZvsusHkSb3FU1xFLpapJ1BJ5E3KhQjsueyhaKdQ`](https://testnet.nearblocks.io/txns/7kbZeZvsusHkSb3FU1xFLpapJ1BJ5E3KhQjsueyhaKdQ)
- Protected transfer #2 creation for live failure recovery: [`2xeoiSQju1en4HViUkWuU5t6tPV7yv2gnGJZk75ULkfK`](https://testnet.nearblocks.io/txns/2xeoiSQju1en4HViUkWuU5t6tPV7yv2gnGJZk75ULkfK)
- Failed recipient transfer with callback restoring `Pending`: [`BKGzye6kFvcnBh84MYCKwn4WSF49WSVbrHWoreWJ7N1Z`](https://testnet.nearblocks.io/txns/BKGzye6kFvcnBh84MYCKwn4WSF49WSVbrHWoreWJ7N1Z)
- Safe retry after recreating the recipient, callback-confirmed `Released`: [`AwPct6oEDyayPm3BPMvkxb4D2UrtMChXLvErnamFC67Z`](https://testnet.nearblocks.io/txns/AwPct6oEDyayPm3BPMvkxb4D2UrtMChXLvErnamFC67Z)

Onchain reads showed transfer #0 as `Cancelled`, transfers #1 and #2 as `Released`, and `get_total_reserved` as `0`. For transfer #2, the recipient account was deliberately deleted before release: the failed promise callback restored `Pending` and preserved the full reserve, then a retry succeeded after the account was recreated. These are genuine signed Testnet transactions, not simulations.

## Contract guarantees

- The entire attached deposit is reserved for one transfer.
- Only the original sender can cancel, and only while `now < expires_at_ms`.
- Anyone can trigger release, but only while `now >= expires_at_ms`; funds always go to the named recipient.
- `Refunding` and `Releasing` intermediate states prevent concurrent or double payouts.
- A failed promise callback restores `Pending`, retaining the reserve for a safe retry.
- Only the contract itself may invoke the settlement callback.
- The contract refuses deposits if its unreserved balance cannot cover contract storage.
- Account history is read from contract state; the frontend contains no fake transactions.

## Local development

Requirements: Node.js 22+, npm, and stable Rust with the `wasm32-unknown-unknown` target.

```bash
cp .env.example .env
npm ci
npm run dev
```

The frontend uses NEAR Wallet for genuine wallet approval and NEAR RPC for views. It never treats a countdown, a submitted wallet request, or a rejected request as settlement success.

## Build and test

```bash
cargo test
cargo build --target wasm32-unknown-unknown --release
npm run build
npm start
```

The Rust suite covers authorization, zero deposits, early release, the exact expiry boundary, callback failures and retries, double payout attempts, repeated callbacks, account history, storage funding, and reserved-balance accounting.

## Reproducible Testnet deployment

The commands below use NEAR CLI against Testnet only. Replace account names; never change `--networkId testnet` to Mainnet without explicit approval.

```bash
npx near-cli@4.0.13 create-account <contract-account>.testnet --useFaucet --networkId testnet
npx near-cli@4.0.13 deploy <contract-account>.testnet \
  target/wasm32-unknown-unknown/release/rewind_escrow.wasm \
  --initFunction new \
  --initArgs '{"owner_id":"<contract-account>.testnet"}' \
  --networkId testnet
```

Fund the contract account separately for storage. The attached deposit passed to `create_transfer` is entirely reserved as the payment amount.

## Frontend configuration

All variables are build-time Vite variables:

| Variable | Purpose |
| --- | --- |
| `VITE_NEAR_NETWORK_ID` | Must be `testnet` for the current deployment |
| `VITE_NEAR_CONTRACT_ID` | Deployed escrow account |
| `VITE_NEAR_NODE_URL` | NEAR JSON-RPC URL |
| `VITE_NEAR_WALLET_URL` | Wallet sign-in URL |
| `VITE_NEAR_HELPER_URL` | Account helper URL |
| `VITE_BASE_PATH` | `/` standalone or `/rewind/` behind the intended path route |

## Railway and `/rewind` routing

REWIND is independently deployable. `railway.toml` builds the Vite app and starts a small static server with SPA fallback at both `/` and `/rewind/`. The production Railway service should set the six variables above, including `VITE_BASE_PATH=/rewind/`.

- Independent live host: https://rewind-frontend-production.up.railway.app
- Path-ready view: https://rewind-frontend-production.up.railway.app/rewind/
- Health check: https://rewind-frontend-production.up.railway.app/health

The independent service was tested for HTTP health, root and `/rewind/` HTML, prefixed JavaScript/CSS assets, and a complete headless Chromium render. It is connected to this private repository and redeploys from `main`.

Do not modify AfroliteHub until the standalone Railway health check, root page, `/rewind/` page, static assets, wallet redirect, and a full Testnet create/cancel/release flow pass. Only then, configure AfroliteHub to proxy exactly `/rewind` and `/rewind/:path*` to the independent REWIND host. Do not forward unrelated paths. `rewind.afrolitehub.com` is the safer fallback if path proxying cannot be validated before the deadline. DNS or AfroliteHub changes require owner approval.

## Known risks and remaining work

- The contract is unit-tested and exercised on Testnet, but has not received an independent audit.
- Promise-failure recovery is covered by automated tests and a real failed-then-retried Testnet settlement; more adversarial review is still recommended.
- Per-account history stores a growing vector and should be redesigned or capped before high-volume use.
- Wallet Selector's current NEAR cryptography dependency tree reports low-severity `elliptic` advisories; monitor upstream updates before Mainnet.
- No Mainnet contract exists and no Mainnet funds have been spent.
