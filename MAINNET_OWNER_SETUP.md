# REWIND Mainnet account owner setup

**Checked 14 November 2026, 15:14 UTC** using public FastNear Mainnet RPC with final block finality.

## Proposed account structure

| Purpose | NEAR Mainnet account | Onchain status during check |
| --- | --- | --- |
| Contract owner / owner-only pause signer | `afrolite.near` | Exists; one public FullAccess key; no contract code |
| Separate escrow holding customer transfers | `escrow.afrolite.near` | **Does not exist yet** |
| Separate limited-role keeper | Not yet chosen | Not configured or funded |

The public-only GitHub Actions verification is here:
https://github.com/Okiki3/Rewind/actions/runs/43609112281

**Warning:** Seeing a FullAccess public key proves that *some signing key exists*, not that the user speaking to us controls its matching private key. Wallet control must be verified through a wallet signature on a clearly reviewed transaction or challenge.

## Deployment parameters (not yet active)

```json
{
  "network": "mainnet",
  "owner_id": "afrolite.near",
  "contract_account_id": "escrow.afrolite.near",
  "version": "rewind-mainnet-candidate-v1",
  "deployment": "NOT_DEPLOYED",
  "payments_enabled": false,
  "keeper_enabled": false
}
```

Initialize V2 on the new escrow subaccount with `new({"owner_id":"afrolite.near"})` **after** security approval and deployment of the reviewed WASM to `escrow.afrolite.near`. The `owner_id` field controls the contract's `set_paused` function, **not** its deployment permissions. The deployed account's FullAccess keys control upgrades and must be managed and audited independently.

## Confirmed wallet choice: Meteor

The user selected **Meteor Wallet** to control the proposed owner account `afrolite.near`. Meteor's official web wallet is https://wallet.meteorwallet.app/; its browser extension can also connect to NEAR dApps. This wallet selection is **not proof of control** until the user approves a wallet-backed challenge.

**Owner-only verification (safe to do now)**

1. Open Meteor from a trusted bookmark or directly from the official website. Unlock it locally.
2. Select **NEAR Mainnet** and confirm the active account shown by Meteor is exactly `afrolite.near`.
3. Check the account balance privately for future creation/transaction costs. Do not transfer tokens to `escrow.afrolite.near` yet: that account does not exist and no deployment is authorised.
4. Use a future reviewed Meteor-connected ownership challenge to prove custody of `afrolite.near`. Never copy its full-access private key or seed phrase into a CLI script, website, issue, chat or CI secret.
5. Once the V2 contract receives independent security approval and the escrow upgrade-key custody scheme is agreed, use a wallet-signed, human-reviewed transaction to **create and fund** the new `escrow.afrolite.near` subaccount. Confirm all actions, receiver IDs and amounts in Meteor before approval.

**Important:** a normal Meteor sign-in to a dApp does not automatically grant permission to create, deploy or upgrade a contract. The NEAR CLI has a separate interactive create-account/fund-myself flow, but its browser-wallet import is not guaranteed to work directly with Meteor on every device. Do not assume compatibility or import a full-access key into a third-party deployment website. Use only a tested and independently reviewed owner-signing flow.

**Funding recheck:** User reported adding NEAR to `afrolite.near` on 14 Nov 2026. Recheck onchain available funds before preparing any owner-signed escrow funding transaction. This statement is not confirmation of onchain balance.

## Fastest owner-controlled creation path (after funding)

**Verified on Mainnet 14 November 2026:** `afrolite.near` has less than 3.6 NEAR of reported raw account balance; creation of a 3.5 NEAR funded escrow with a small gas/buffer allowance cannot proceed at that balance. First fund your **existing** `afrolite.near` in Meteor. Never send funds to the nonexistent escrow account.

**Actual candidate size:** 219,854 WASM bytes, requiring approximately **2.19854 NEAR storage stake** for code alone at the published 0.00001 NEAR per byte rate. Keys, state, gas and the contract's separate **0.5 NEAR** operating reserve are additional. The unsigned setup proposal requires **3.5 to 10 NEAR** of initial escrow funding; **4 NEAR** is a practical provisional account-creation amount for later independent review, not a guarantee that production costs are covered.

**On your own Windows computer** (no signing keys or seed phrases given to ChatGPT):

1. Install official **near-cli-rs v0.31.1** from the [NEAR CLI Windows MSI release](https://github.com/near/near-cli-rs/releases/tag/v0.31.1). Check `near --version` in a fresh PowerShell window.
2. Only **if `afrolite.near` is already securely available in your local NEAR CLI OS keychain**, the documented owner-signed CLI flow is:

   ```powershell
   near account create-account fund-myself escrow.afrolite.near '4 NEAR' autogenerate-new-keypair save-to-keychain sign-as afrolite.near network-config mainnet sign-with-keychain send
   ```

   This creates a *distinct* escrow FullAccess signing key in your **own local OS keychain** and asks your existing owner key to approve 4 NEAR initial funding (plus transaction fees). Review all transaction details on your device before approval. **Do not run this if you do not already control the `afrolite.near` key in the CLI keychain.**

3. If you use **Meteor only**, and the CLI says it cannot find an `afrolite.near` signing key, **stop**. Meteor browser sign-in is not automatically the same as NEAR CLI keychain access. Do **not** export your Meteor recovery phrase or private key to an online helper, CI, or this chat. The separate [unsigned account-creation proposal](scripts/mainnet-escrow-create-proposal.mjs) is ready; it requires a new securely generated **public** escrow key and explicit wallet-signing integration, not keys pasted into ChatGPT.
4. After signing, confirm `escrow.afrolite.near` exists and its onchain access key is the exact new public key held by **your** secure keychain:

   ```powershell
   near account view-account-summary escrow.afrolite.near network-config mainnet now
   near account list-keys escrow.afrolite.near network-config mainnet now
   ```

**Do not deploy contract code, accept real payment deposits, or unpause the contract based on these steps alone.** An independent audit and verification of the exact WASM are still required. The latest hardened candidate was freshly verified on Testnet with **initial deposits paused by default** (16 passing Rust tests).

## Independent audit appointment

Public scope and immutable Testnet evidence: [Audit brief](MAINNET_AUDIT_BRIEF.md) and [independent-audit tracking issue](https://github.com/Okiki3/Rewind/issues/17).

An external auditor has **not** accepted an engagement. Hacken publishes a [NEAR/Rust smart-contract audit intake](https://hacken.io/services/blockchain-security/near-smart-contract-security-audit/) with an estimated **5 to 15 business days** for a full review; their actual availability, cost and timeline must be confirmed directly. An audit enquiry, public GitHub issue, or passing CI is **not** an audit.

## Safe next steps (no private keys in this repository or chat)

1. Using the wallet where you control `afrolite.near`, confirm **Mainnet** and that it is the active signing account. You must authorize the transaction yourself.
2. Choose how to hold the separate escrow account's **FullAccess/upgrade keys**. Prefer audited multisig/DAO control or other professionally managed custody. Do **not** deploy the V2 escrow onto the personal `afrolite.near` account.
3. Commission independent security review against `contract-mainnet/src/lib.rs`, its locked dependencies, exact SHA-256 WASM and security brief. Record and remediate all critical and high findings. Review NEAR Connect's mutable wallet-executor trust boundary too.
4. After approval, **create** `escrow.afrolite.near` as a subaccount signed by `afrolite.near` using the official NEAR CLI or a compatible wallet; approve the initial funding after confirming the amount, destination, generated FullAccess key custody and storage reserve. You may use the official interactive CLI command `near account create-account` and choose **fund-myself**, Mainnet, owner `afrolite.near`, and a securely stored new subaccount key. **No wallet key is needed by ChatGPT or GitHub.**
5. Verify that `escrow.afrolite.near` now exists onchain and inspect **every** FullAccess public key, permission, deployment policy and intended signer.
6. Deploy the professionally reviewed WASM using your wallet's signing approval, initialize exactly once with owner ID `afrolite.near`, then check `code_hash`, owner, fee, caps, exposure, pause and operating balance. Pin these exact values before enabling any web or keeper signing.
7. Provision an independently controlled, funded keeper account with its own secret storage and audited monitoring. Do not put its credentials into frontend `VITE_*` configuration.
8. Run an owner-approved, strictly capped real-payment settlement, refund and failed-recipient recovery before opening Mainnet payments to anyone else. Update exact contract address and code hash only after verification.

**NO-GO now:** Mainnet V2 is still a tested candidate, not independently audited and not deployed. The latest hardened WASM is SHA-256 `9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333`, with NEAR code hash `BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW`. Onchain Testnet proof: https://github.com/Okiki3/Rewind/actions/runs/43616110769. It now rejects third-party initialisation. The live website's Mainnet mode must remain read-only. A real account creation, funding or contract deployment requires an explicit owner's wallet signature, and no such action was taken by the preflight workflow.

## Read-only commands to re-check before signing

```sh
near account view-account-summary afrolite.near network-config mainnet now
near account list-keys afrolite.near network-config mainnet now
near account view-account-summary escrow.afrolite.near network-config mainnet now
```

The final command will show a missing account until you create the dedicated escrow subaccount. See [near-cli-rs official guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md) for interactive account creation and wallet-backed signing.

Never send your seed phrase, private keys, authentication token, or a keychain export to ChatGPT, GitHub issues, a CI workflow or a public chat.
