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

## Safe next steps (no private keys in this repository or chat)

1. Using the wallet where you control `afrolite.near`, confirm **Mainnet** and that it is the active signing account. You must authorize the transaction yourself.
2. Choose how to hold the separate escrow account's **FullAccess/upgrade keys**. Prefer audited multisig/DAO control or other professionally managed custody. Do **not** deploy the V2 escrow onto the personal `afrolite.near` account.
3. Commission independent security review against `contract-mainnet/src/lib.rs`, its locked dependencies, exact SHA-256 WASM and security brief. Record and remediate all critical and high findings. Review NEAR Connect's mutable wallet-executor trust boundary too.
4. After approval, **create** `escrow.afrolite.near` as a subaccount signed by `afrolite.near` using the official NEAR CLI or a compatible wallet; approve the initial funding after confirming the amount, destination, generated FullAccess key custody and storage reserve. You may use the official interactive CLI command `near account create-account` and choose **fund-myself**, Mainnet, owner `afrolite.near`, and a securely stored new subaccount key. **No wallet key is needed by ChatGPT or GitHub.**
5. Verify that `escrow.afrolite.near` now exists onchain and inspect **every** FullAccess public key, permission, deployment policy and intended signer.
6. Deploy the professionally reviewed WASM using your wallet's signing approval, initialize exactly once with owner ID `afrolite.near`, then check `code_hash`, owner, fee, caps, exposure, pause and operating balance. Pin these exact values before enabling any web or keeper signing.
7. Provision an independently controlled, funded keeper account with its own secret storage and audited monitoring. Do not put its credentials into frontend `VITE_*` configuration.
8. Run an owner-approved, strictly capped real-payment settlement, refund and failed-recipient recovery before opening Mainnet payments to anyone else. Update exact contract address and code hash only after verification.

**NO-GO now:** Mainnet V2 is still a tested candidate, not independently audited and not deployed. The live website's Mainnet mode must remain read-only. A real account creation, funding or contract deployment requires an explicit owner's wallet signature, and no such action was taken by the preflight workflow.

## Read-only commands to re-check before signing

```sh
near account view-account-summary afrolite.near network-config mainnet now
near account list-keys afrolite.near network-config mainnet now
near account view-account-summary escrow.afrolite.near network-config mainnet now
```

The final command will show a missing account until you create the dedicated escrow subaccount. See [near-cli-rs official guide](https://github.com/near/near-cli-rs/blob/main/docs/GUIDE.en.md) for interactive account creation and wallet-backed signing.

Never send your seed phrase, private keys, authentication token, or a keychain export to ChatGPT, GitHub issues, a CI workflow or a public chat.
