# REWIND V2 Mainnet deployment — public evidence

**Status as verified 14 Nov 2026:** contract installed and initialized, `paused=true`. NOT an externally audited or active financial product.

| Property | Verified value |
| --- | --- |
| Network | NEAR Mainnet |
| Deployed account | [`afrolite-rewind-261114.near`](https://nearblocks.io/address/afrolite-rewind-261114.near) |
| Contract owner returned by `get_owner` | `afrolite.near` |
| `is_paused` | `true` (no new public deposits) |
| Contract account's FullAccess public keys | 1 (key custody still warrants independent review) |
| Exact NEAR code hash | `BNVC3dFi3HigCqTAtW2sxxW8vJLNrPzi3yTXDjwBdstW` |
| SHA-256 of submitted verified 219,854-byte WASM | `9a15f0f7cd347566982a5dbbf7eb994037c1932bed2f22f8c1c14981975ac333` |
| Owner-signed atomic deploy + initialize transaction | [View on NearBlocks](https://nearblocks.io/txns/GJuZ8MrQmRwS6UNCYk3zMHhyA254JCfy4mzMJs3jeA1f) |
| Public candidate source | [`contract-mainnet/src/lib.rs`](contract-mainnet/src/lib.rs) |
| Pinned dependencies | [`contract-mainnet/Cargo.lock`](contract-mainnet/Cargo.lock) |
| Adversarial audit scope | [`MAINNET_AUDIT_BRIEF.md`](MAINNET_AUDIT_BRIEF.md) |

## Verification sequence

1. The owner's Android Termux script first checked the contract account (4.000000 NEAR raw), registered FullAccess public key, empty code hash, and pinned artifact SHA-256. The preflight was read-only.
2. The owner signed one transaction containing `DeployContract` and a self-account `new({"owner_id":"afrolite.near"})` initialization action. The script returned the transaction hash above.
3. An immediate read using finality `final` still showed the pre-deployment account state. A subsequent read-only `--check` showed the expected code hash, raw balance **3.998224 NEAR**, estimated spendable **1.796744 NEAR**, and contract methods confirming owner `afrolite.near` and `paused=true`.
4. Approx. **2.20 NEAR** is reserved against contract storage and is **not** a recipient payment. Balances are historical and may change.

These outputs were supplied by the owner from a locally executed Termux script. Onchain account/transaction links make the claims independently checkable. Do **not** submit a second deployment transaction.

## Review or reproduce

```sh
cargo test --manifest-path contract-mainnet/Cargo.toml --locked
cargo build --manifest-path contract-mainnet/Cargo.toml --release --target wasm32-unknown-unknown --locked
```

The separate Testnet V1 contract remains the live demo. The main website's Mainnet selector only performs read-only checks; the V2 contract has not been opened to customer funds. The private keys used for deployment are not part of this repository. We do not collect wallet recovery phrases.

## Remaining requirements (no claim of completion)

- Independent NEAR security audit against the exact compiled WASM and the full refund/callback/storage model.
- Upgrade-key custody/rotation review; private signing key was handled locally by the owner and must remain secret.
- Separately provisioned Mainnet keeper, monitoring and incidents/pausing procedures.
- Carefully limited real-money settlement/refund reconciliation **after** independent safety approval and a separate explicit owner go-live decision.

**Hackathon submission claim:** deployed paused V2 candidate plus fully working live Testnet protected-payment prototype. **Not** a launched Mainnet payment service.
