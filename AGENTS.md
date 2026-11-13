# REWIND binding product specification — November 13, 2026

## What we are actually building
REWIND is a native NEAR PAYMENT MISTAKE-PREVENTION AND 60-SECOND UNDO dApp. This is not an escrow marketplace, nor a user-configurable time-lock product.
User flow: enter intended recipient and amount -> get preflight mistake checks -> approve protected send -> show visible 60-second Undo option -> original sender may cancel within the interval -> otherwise release worker initiates delivery after expiry. Smart contract temporarily holds funds because direct settled transfers CANNOT be reversed. Do not market REWIND as a generic escrow.

## Exactly 60 seconds, ONCHAIN
The smart contract MUST calculate its own expiry as env::block_timestamp_ms() + 60_000 from transaction execution, with checked arithmetic. Remove any caller-controlled expires_at_ms argument, minutes state or duration field. Test boundary: before +60_000ms cancel allowed; at +60_000ms cancel blocked and release allowed. Timer in UI is informational, never authoritative.

## Preflight checks before wallet signing
Validate NEAR account ID, validate named account exists where possible; compare recipient to user-saved contacts and known past recipients for visually similar or edit-distance typos; warn about first-time destination and contract accounts when verifiable; flag unusually high amount ONLY based on defined prior payments or a user-set threshold. Avoid invented scam risk scores, and do not claim to know user's intention from the string alone. Provide a prominent correction option and a deliberate confirm action. Do not block legitimate contract recipients solely because they have deployed code.

## 60-second Undo and reliable delivery
Fund contract from wallet in a genuine onchain transaction; show an obvious Undo control while status is Pending and onchain deadline not passed. Only original sender can cancel within 60 seconds, with async refund callback. After expiry an independently deployed Railway worker or equivalent monitors and triggers delivery idempotently and retries safely; the contract must enforce destination, timing and prevent duplicate payments. A manual fallback may remain for worker outages. Do not claim exact release at 60 seconds because network and worker can delay. Do not mark success until confirmed by the blockchain.

## Preserve site and private repository
Keep current REWIND design, landing page and https://afrolitehub.com/rewind routing. Do not add marketing sections or redesign the homepage. The main app should emphasize sender mistake checks and quick Undo. Mark any hero graphic as illustrative. Wallet-connected users should see true onchain transfer history automatically. Keep source Okiki3/Rewind PRIVATE, and do not publish X posts.

## MAINNET target with safety gate
The user explicitly wants the finished demonstration on NEAR MAINNET, not merely testnet. Make mainnet fully configurable; run unit/sandbox and signed Testnet validation first as safety checks. Prepare a fresh mainnet contract deployment, tiny-value end-to-end smoke test and wallet network configuration, but NEVER spend real NEAR, sign mainnet transactions, or deploy on mainnet without owner's explicit approval. The mainnet app must not point to the testnet contract. This is unaudited financial software: no production-security claims, restrict demo exposure/value.

## Verify before calling it ready
Unit/integration tests: sender-only cancellation, exact 60s boundary, amount and address review, concurrent deposits/reserves, no double settlement, async callback failures/retry, reliable automatic release worker, wallet rejection, and true finality messages. A previously deployed Testnet contract used caller-chosen expiry: do not silently mutate existing escrow agreements or strand funds. Consider fresh corrected contract. Report actual test commands, results, transaction hashes, outstanding blockers.

---

## Prior engineering instructions (still applicable unless overridden above)

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
