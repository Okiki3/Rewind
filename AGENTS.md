# REWIND — AUTHORITATIVE PRODUCT BRIEF

Updated 13 November 2026. This document supersedes earlier instructions describing REWIND primarily as an escrow service, a standalone payment website, or a huge Undo interface.

## Actual product
REWIND is a reusable NEAR payment-protection protocol and wallet integration toolkit. It makes an ordinary NEAR send safer: (1) contextual mistake warnings BEFORE wallet signing; (2) a fixed 60-second cancellation option AFTER a protected transaction is accepted onchain, before recipient delivery. The holding contract is a behind-the-scenes technical mechanism, not the product positioning. Ordinary direct transfers already completed outside REWIND CANNOT be reversed.

## Correct user experience
- Preserve the current afrolitehub.com/rewind landing page, colors, layout and working deployment. Do not redesign the homepage or add marketing sections.
- Normal send flow: recipient, amount, preflight warnings only if justified, Send NEAR button.
- Directly BELOW Send NEAR, small quiet helper text: "Protected by REWIND. You can cancel within 60 seconds after sending, before delivery."
- Do NOT emphasize Undo as giant text/button on the homepage or send screen. After payment, show a small but clear "Cancel transfer" link in the receipt/details/activity while the window remains open, with remaining seconds. It must be accessible even if user leaves the initial screen.
- After window ends show "Awaiting delivery" until confirmed onchain; do not imply countdown itself delivers funds.
- Provide a concise developer integration link/section, not a giant marketing site.

## SDK / wallet integration IS THE CORE DELIVERABLE
- Build a standalone TypeScript/JavaScript library usable by third-party NEAR wallet developers, independent of AfroliteHub, React and My NEAR Wallet.
- Provide preflight function: recipient syntax/account existence via NEAR RPC, similarity to SAVED CONTACTS or prior recipients provided by the host wallet, note first-time destination, detect contract accounts if verifiable, warn of unusually high amounts only against explicit thresholds or real user history. Never make unsupported scam claims or pretend to know intended recipient.
- Provide wallet-agnostic transaction builders: buildProtectedSendTransaction returns standard NEAR FunctionCall action for our contract (receiverId, methodName, args, gas, attached deposit); buildCancelTransaction; getStatus/history helpers. Host wallet signs; REWIND SDK never sees secret keys or signs on behalf of wallet. Existing wallet selector is only a reference demo.
- Demonstrate the SDK in at least one second, small example-wallet integration, and document a copyable developer quickstart. Support any wallet implementing suitable NEAR transaction signing, only after that wallet elects to adopt REWIND. Do not claim REWIND protects other wallets' direct sends without integration.
- Core protection must work without dependence on AfroliteHub hosting or an externally trusted API for custody. Independent release worker is allowed.
- Native NEAR only in MVP, no token swaps or cross-chain integrations.

## Contract invariants
- create_transfer takes a recipient and attached NEAR, NOT user-supplied expires_at_ms. Contract computes expiry = onchain execution timestamp + exactly 60_000 milliseconds with safe arithmetic.
- Original sender only can cancel at any timestamp strictly BEFORE expiry. Release eligible AT/AFTER expiry; recipient and amount immutable. Automated keeper triggers releases as soon as practical after expiry (exact wall-clock time cannot be guaranteed).
- Refund and release use secure asynchronous callbacks and statuses, protect reserved funds/storage costs and guarantee no double settlement. Failed payout must be safely retryable.
- Existing deployed testnet contract accepts configurable deadlines: do not silently alter live obligations or strand funds. Use a fresh version/account if necessary; check outstanding reserves first.
- Run unit and sandbox tests plus actual NEAR testnet signed send/cancel/release/failure-retry transactions. Tests must cover 59,999ms vs 60,000ms boundary, incorrect caller, concurrent transfers, contract reserve and SDK behavior.

## Hosting, privacy and MAINNET
- Source stays Okiki3/Rewind PRIVATE; user handles X demo and later repository publication.
- Preserve working https://afrolitehub.com/rewind and other AfroliteHub services; existing URL is correct.
- Mainnet is the intended FINAL hackathon demo network. Build/test safely on sandbox and testnet first. Do NOT deploy to mainnet or spend real NEAR without explicit owner approval. Mainnet demo, if approved, uses isolated funds, tiny hard caps, and clearly labelled experimental unaudited software.
- Keep UI simple and usable, avoid big Undo-centered marketing. Primary innovation: wallet-integrable preflight mistake prevention plus a quiet cancellation window.
- Ship priority: fixed 60-second contract -> SDK and preflight + reference wallet integration -> keeper & real testnet proof -> minimal UI adjustment -> prepare mainnet.
- Report real compilation and test results, not promises or simulations. Do not add unrelated features.
