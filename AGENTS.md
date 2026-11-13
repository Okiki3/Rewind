# REWIND engineering instructions

## Mission
Ship a working protected-native-NEAR transfer web app for the 2026 NEAR Hackathon. Prioritize correct escrow behavior and a verifiable wallet-connected UI; no simulated payment success.

## Repository & privacy
- This repository (Okiki3/Rewind) is the canonical source of REWIND and must remain PRIVATE until the owner explicitly authorizes publication.
- Make commits or PRs here, not in the existing Afrolite Hub repository.
- Do not write an X post or create a public demo post. The owner will handle publication separately.

## Demo hosting
- Target public URL after testing: https://afrolitehub.com/rewind (this is a *path*, not a subdomain).
- Existing Afrolite Hub runs separately as Next.js 15 on Railway, source Okiki3/Afrolite-Hub. Do not edit, deploy, or disrupt that service while REWIND is under development.
- Keep REWIND independently deployable as its own Railway service. Support a configurable Vite base path /rewind/ and SPA fallbacks; document reverse-proxy routing from the existing Next.js site to REWIND's Railway public host. Avoid forwarding unrelated AfroliteHub routes.
- If path forwarding proves risky close to deadline, use rewind.afrolitehub.com as an isolated fallback. Do not make DNS changes without owner's approval.

## Blockchain safety
- Implement escrow in Rust with near-sdk. User funds go to the contract; sender-only cancellation before deadline; public release after deadline; secure asynchronous transfer callbacks. Never show "paid" until contract confirms.
- Run sandbox/unit tests, testnet deploy and real signed testnet transactions before considering mainnet.
- Mainnet is desired for a tiny-value demonstration only after explicit approval; never deploy to mainnet or transfer real NEAR without it. The MVP is experimental and unaudited.
- Display realistic finality/settling/pending/cancelled states; countdown alone does not settle funds.

## Definition of done
- Genuine wallet connect, deposit, cancel, release, and transfer detail/history views.
- No fake history or onchain state, no hard-coded simulated transaction IDs.
- No double-spend / double-payout; explicit tests for authorization, boundaries, promise failures, storage and reserved funds.
- React/Vite/TypeScript build and Rust tests pass, or precisely report the blocker and test commands.
- README: setup, contract/testnet deployment, environment variables, test commands, demo acceptance checks, known risks, routing to /rewind, and verified transaction hashes only.
- Keep scope tight; don't spend time on airdrops, token swaps, social marketing, or optional AI before working escrow.
