# REWIND Mainnet account owner setup

**Checked 14 November 2026, 15:14 UTC** using public FastNear Mainnet RPC with final block finality.

## Updated owner action (Meteor, mobile)

- **New contract candidate:** `afrolite-rewind-261114.near` created in Meteor and verified to exist on real NEAR Mainnet on 14 Nov 2026 using a public-only RPC check. It has one public FullAccess key and **no contract bytecode**. Public key alone is not proof of signing-key custody.
- **Owner funding confirmed, 14 Nov 2026:** The user completed the transfer from `afrolite.near` in Meteor. [Read-only Mainnet check](https://github.com/Okiki3/Rewind/actions/runs/43621207990) confirmed escrow raw balance **at least 4 NEAR** and estimated spendable above **3.8 NEAR**. Funds are in the separate account; no smart contract has been deployed. **Do not send more money.**
- **Mobile contract deployment:** not yet implemented or independently verified. Do not enter a wallet private key into an external deployment site or pass it to GitHub Actions. The wallet must expressly sign a deployment on the new contract account itself. Deployment will install the **paused-by-default** verified candidate only after secure ownership and release review.
- **Public deposits:** OFF pending independent external audit, keeper and contract verification.

## Proposed account structure

| Purpose | NEAR Mainnet account | Onchain status during check |
| --- | --- | --- |
| Contract owner / owner-only pause signer | `afrolite.near` | Exists; one public FullAccess key; no contract code |
| Separate escrow holding customer transfers | `afrolite-rewind-261114.near` | Exists on Mainnet; one public FullAccess key, no code |
| Separate limited-role keeper | Not yet chosen | Not configured or funded |

The public-only GitHub Actions verification is here:
https://github.com/Okiki3/Rewind/actions/runs/43620921109

**Warning:** Seeing a FullAccess public key proves that *some signing key exists*, not that the user speaking to us controls its matching private key. Wallet control must be verified through a wallet signature on a clearly reviewed transaction or challenge.

## Deployment parameters (not yet active)

```json
{
  "network": "mainnet",
  "owner_id": "afrolite.near",
  "contract_account_id": "afrolite-rewind-261114.near",
  "version": "rewind-mainnet-candidate-v1",
  "deployment": "NOT_DEPLOYED",
  "payments_enabled": false,
  "keeper_enabled": false
}
```

Initialize V2 on the new escrow subaccount with `new({"owner_id":"afrolite.near"})` **after** security approval and deployment of the reviewed WASM to `afrolite-rewind-261114.near`. The `owner_id` field controls the contract's `set_paused` function, **not** its deployment permissions. The deployed account's FullAccess keys control upgrades and must be managed and audited independently.

## Confirmed wallet choice: Meteor

The user selected **Meteor Wallet** to control the proposed owner account `afrolite.near`. Meteor's official web wallet is https://wallet.meteorwallet.app/; its browser extension can also connect to NEAR dApps. This wallet selection is **not proof of control** until the user approves a wallet-backed challenge.

**Owner-only verification (safe to do now)**

1. Open Meteor from a trusted bookmark or directly from the official website. Unlock it locally.
2. Select **NEAR Mainnet** and confirm the active account shown by Meteor is exactly `afrolite.near`.
3. **Funding is already complete**; verify that `afrolite-rewind-261114.near` remains accessible from Meteor and don't send another deposit. No contract code has been deployed.
4. Use a future reviewed Meteor-connected ownership challenge to prove custody of `afrolite.near`. Never copy its full-access private key or seed phrase into a CLI script, website, issue, chat or CI secret.
5. The named account already exists. **Do not CreateAccount again.** Verify separate key custody before authorizing any WASM deployment from `afrolite-rewind-261114.near`; the deployed contract defaults to paused.

**Important:** a normal Meteor sign-in to a dApp does not automatically grant permission to create, deploy or upgrade a contract. The NEAR CLI has a separate interactive create-account/fund-myself flow, but its browser-wallet import is not guaranteed to work directly with Meteor on every device. Do not assume compatibility or import a full-access key into a third-party deployment website. Use only a tested and independently reviewed owner-signing flow.

**Funding recheck:** User reported adding NEAR to `afrolite.near` on 14 Nov 2026. Recheck onchain available funds before preparing any owner-signed escrow funding transaction. This statement is not confirmation of onchain balance.

## Prior subaccount instructions replaced

The earlier plan to create `escrow.afrolite.near` with desktop NEAR CLI is obsolete. The user successfully created `afrolite-rewind-261114.near` directly in Meteor on Android. Use the new account. Never try to execute `CreateAccount` again for an account that already exists.

## Independent audit appointment

Public scope and immutable Testnet evidence: [Audit brief](MAINNET_AUDIT_BRIEF.md) and [independent-audit tracking issue](https://github.com/Okiki3/Rewind/issues/17).

An external auditor has **not** accepted an engagement. Hacken publishes a [NEAR/Rust smart-contract audit intake](https://hacken.io/services/blockchain-security/near-smart-contract-security-audit/) with an estimated **5 to 15 business days** for a full review; their actual availability, cost and timeline must be confirmed directly. An audit enquiry, public GitHub issue, or passing CI is **not** an audit.

## Safe next steps (no private keys in this repository or chat)

1. Using the wallet where you control `afrolite.near`, confirm **Mainnet** and that it is the active signing account. You must authorize the transaction yourself.
2. Choose how to hold the separate escrow account's **FullAccess/upgrade keys**. Prefer audited multisig/DAO control or other professionally managed custody. Do **not** deploy the V2 escrow onto the personal `afrolite.near` account.
3. Commission independent security review against `contract-mainnet/src/lib.rs`, its locked dependencies, exact SHA-256 WASM and security brief. Record and remediate all critical and high findings. Review NEAR Connect's mutable wallet-executor trust boundary too.
4. **Completed:** Mainnet account creation and owner transfer of 4 NEAR, with verified onchain balance. No second transfer, subaccount creation or CLI key import is needed.
5. Verify that `afrolite-rewind-261114.near` now exists onchain and inspect **every** FullAccess public key, permission, deployment policy and intended signer.
6. Deploy the professionally reviewed WASM using your wallet's signing approval, initialize exactly once with owner ID `afrolite.near`, then check `code_hash`, owner, fee, caps, exposure, pause and operating balance. Pin these exact values before enabling any web or keeper signing.
7. Provision an independently controlled, funded keeper account with its own secret storage and audited monitoring. Do not put its credentials into frontend `VITE_*` configuration.
8. Run an owner-approved, strictly capped real-payment settlement, refund and failed-recipient recovery before opening Mainnet payments to anyone else. Update exact contract address and code hash only after verification.

**NO-GO now:** Mainnet V2 is still a tested candidate, not independently audited and not deployed. The latest hardened WASM is SHA-256 `9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333`, with NEAR code hash `BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW`. Onchain Testnet proof: https://github.com/Okiki3/Rewind/actions/runs/43616110769. It now rejects third-party initialisation. The live website's Mainnet mode must remain read-only. A real account creation, funding or contract deployment requires an explicit owner's wallet signature, and no such action was taken by the preflight workflow.

## Read-only commands to re-check before signing

```sh
near account view-account-summary afrolite.near network-config mainnet now
near account list-keys afrolite.near network-config mainnet now
near account view-account-summary afrolite-rewind-261114.near network-config mainnet now
```

The final command should now show the existing named escrow candidate, created in Meteor. It is not deployed. See [near-cli-rs official guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md) for interactive account creation and wallet-backed signing.

Never send your seed phrase, private keys, authentication token, or a keychain export to ChatGPT, GitHub issues, a CI workflow or a public chat.
