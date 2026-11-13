# REWIND

Protected, cancellable NEAR transfers.

> Status: Under active development. This is not yet a live or audited payment service. Do not send real funds until the contract has been tested and explicitly approved for a limited mainnet demonstration.

## Objective

Send native NEAR into a time-locked smart-contract escrow. Before the deadline, only the original sender may cancel and request a refund. After the deadline, the original recipient can receive the funds through a contract-controlled release. Every settlement must account for NEAR asynchronous transfer callbacks, and the interface must reflect actual onchain state.

## Deployment plan

- Source: this private repository during development.
- Development and integration tests: NEAR sandbox and testnet.
- Limited mainnet demonstration: only after successful tests and explicit approval, with minimal amounts.
- Demo website: independently deployed application, eventually available at `https://afrolitehub.com/rewind` through a carefully tested route/proxy on the separate Afrolite Hub deployment; `https://rewind.afrolitehub.com` is a lower-risk fallback.
- Do not alter `Okiki3/Afrolite-Hub` while building the core REWIND prototype.

## Acceptance criteria

1. Genuine wallet-signed contract transactions create protected transfers.
2. Sender-only cancel works strictly before expiry.
3. Release works only after expiry.
4. Refund and release finality are verified through NEAR promise callbacks.
5. No double payout; retries after failures remain safe.
6. Wallet rejection and pending states do not display false success.
7. Automated contract tests and frontend build pass.
8. Document reproducible testnet demo transactions before requesting any real mainnet funding.

Development instructions, deploy commands, and test results will be added as the implementation is built.
