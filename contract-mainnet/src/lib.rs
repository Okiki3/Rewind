use borsh::BorshSerialize;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const PROTECTION_WINDOW_MS: u64 = 60_000;
const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;
/// Flat, non-refundable storage charge disclosed before wallet approval.
/// A transfer is rejected if this fails to cover its actual new chain storage.
const STORAGE_FEE: u128 = YOCTO / 50; // 0.02 NEAR
const MIN_PAYMENT: u128 = YOCTO / 100; // 0.01 NEAR
const MAX_PAYMENT: u128 = YOCTO * 2; // 2 NEAR per payment
const MAX_ESCROWED: u128 = YOCTO * 50; // 50 NEAR total open escrow cap
const MIN_OPERATING_RESERVE: u128 = YOCTO / 2; // 0.5 NEAR above escrow and storage

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    Transfers,
    SenderCount,
    RecipientCount,
    SenderIndex,
    RecipientIndex,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum TransferStatus {
    Pending,
    Refunding,
    RefundFailed,
    Releasing,
    DeliveryFailed,
    Cancelled,
    Released,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Transfer {
    pub id: U64,
    pub sender: AccountId,
    pub recipient: AccountId,
    /// Payment only, excluding the disclosed storage fee.
    pub amount: U128,
    pub expires_at_ms: U64,
    pub status: TransferStatus,
    pub created_at_ms: U64,
    pub settled_at_ms: Option<U64>,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_settle(&mut self, transfer_id: U64) -> bool;
}

/// This is a NEW contract with a different state layout and create-transfer ABI.
/// DO NOT upgrade the old Testnet escrow in place with this code.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    paused: bool,
    transfers: LookupMap<u64, Transfer>,
    sender_count: LookupMap<AccountId, u64>,
    recipient_count: LookupMap<AccountId, u64>,
    sender_index: LookupMap<(AccountId, u64), u64>,
    recipient_index: LookupMap<(AccountId, u64), u64>,
    next_transfer_id: u64,
    total_reserved: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        require!(!env::state_exists(), "Already initialized");
        Self {
            owner_id,
            paused: false,
            transfers: LookupMap::new(StorageKey::Transfers),
            sender_count: LookupMap::new(StorageKey::SenderCount),
            recipient_count: LookupMap::new(StorageKey::RecipientCount),
            sender_index: LookupMap::new(StorageKey::SenderIndex),
            recipient_index: LookupMap::new(StorageKey::RecipientIndex),
            next_transfer_id: 0,
            total_reserved: 0,
        }
    }

    /// A sender attaches exactly transfer_amount + 0.02 NEAR storage fee.
    /// The fee covers permanent chain history; it is NOT refunded on cancel.
    /// The whole payment amount remains in escrow until settlement.
    #[payable]
    pub fn create_transfer(&mut self, recipient: AccountId, transfer_amount: U128) -> Transfer {
        require!(!self.paused, "New transfers are paused");
        let sender = env::predecessor_account_id();
        let amount = transfer_amount.0;
        require!(sender != recipient, "Sender and recipient must differ");
        require!(amount >= MIN_PAYMENT, "Payment below minimum");
        require!(amount <= MAX_PAYMENT, "Payment exceeds per-transfer cap");
        let required = amount.checked_add(STORAGE_FEE).expect("Deposit overflow");
        require!(
            env::attached_deposit().as_yoctonear() == required,
            "Attach exactly the payment amount plus the published storage fee"
        );
        let new_reserved = self.total_reserved.checked_add(amount).expect("Reserve overflow");
        require!(new_reserved <= MAX_ESCROWED, "Contract escrow exposure cap reached");

        let storage_before = env::storage_usage();
        let now = env::block_timestamp_ms();
        let id = self.next_transfer_id;
        self.next_transfer_id = id.checked_add(1).expect("Transfer index overflow");

        let transfer = Transfer {
            id: U64(id),
            sender,
            recipient,
            amount: U128(amount),
            expires_at_ms: U64(now.checked_add(PROTECTION_WINDOW_MS).expect("Time overflow")),
            status: TransferStatus::Pending,
            created_at_ms: U64(now),
            settled_at_ms: None,
        };

        self.transfers.insert(&id, &transfer);
        self.index_transfer(&transfer.sender, id, true);
        self.index_transfer(&transfer.recipient, id, false);
        self.total_reserved = new_reserved;

        // Prevent storage-subsidy draining via many tiny deposits and
        // prevent diverting still-escrowed payment funds into storage.
        let written_bytes = env::storage_usage().saturating_sub(storage_before) as u128;
        let storage_cost = written_bytes
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .expect("Storage cost overflow");
        require!(storage_cost <= STORAGE_FEE, "Storage fee insufficient for this account pair");
        self.assert_solvency();
        env::log_str(&format!("TRANSFER_CREATED:{}", id));
        transfer
    }

    /// Owner can stop new payments during incidents; refunds and releases
    /// for existing deposits ALWAYS remain available.
    pub fn set_paused(&mut self, paused: bool) {
        require!(env::predecessor_account_id() == self.owner_id, "Only owner");
        self.paused = paused;
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    /// Sender-only cancellation until expiry, or recovery after failed payout.
    pub fn cancel(&mut self, transfer_id: U64) -> Promise {
        let mut transfer = self.must_get(transfer_id.0);
        require!(env::predecessor_account_id() == transfer.sender, "Only sender may cancel");
        require!(
            transfer.status == TransferStatus::RefundFailed
                || transfer.status == TransferStatus::DeliveryFailed
                || env::block_timestamp_ms() < transfer.expires_at_ms.0,
            "Cancellation window closed"
        );
        require!(
            transfer.status == TransferStatus::Pending
                || transfer.status == TransferStatus::RefundFailed
                || transfer.status == TransferStatus::DeliveryFailed,
            "Transfer is not cancellable"
        );
        transfer.status = TransferStatus::Refunding;
        self.transfers.insert(&transfer_id.0, &transfer);
        self.pay_then_confirm(transfer.sender.clone(), &transfer)
    }

    /// Public trigger for automatic delivery after expiry.
    pub fn release(&mut self, transfer_id: U64) -> Promise {
        let mut transfer = self.must_get(transfer_id.0);
        require!(env::block_timestamp_ms() >= transfer.expires_at_ms.0, "Transfer still protected");
        require!(
            transfer.status == TransferStatus::Pending || transfer.status == TransferStatus::DeliveryFailed,
            "Transfer is not deliverable"
        );
        transfer.status = TransferStatus::Releasing;
        self.transfers.insert(&transfer_id.0, &transfer);
        self.pay_then_confirm(transfer.recipient.clone(), &transfer)
    }

    #[private]
    pub fn on_settle(
        &mut self,
        transfer_id: U64,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        let mut transfer = self.must_get(transfer_id.0);
        let intended_status = match transfer.status {
            TransferStatus::Refunding => TransferStatus::Cancelled,
            TransferStatus::Releasing => TransferStatus::Released,
            _ => env::panic_str("Transfer is not settling"),
        };
        if result.is_err() {
            // Failed refund remains sender-recoverable even after the deadline.
            // Failed delivery remains retryable or sender-refundable.
            transfer.status = if intended_status == TransferStatus::Cancelled {
                TransferStatus::RefundFailed
            } else {
                TransferStatus::DeliveryFailed
            };
            self.transfers.insert(&transfer_id.0, &transfer);
            env::log_str(&format!("TRANSFER_SETTLEMENT_FAILED:{}", transfer_id.0));
            return false;
        }
        transfer.status = intended_status;
        transfer.settled_at_ms = Some(U64(env::block_timestamp_ms()));
        self.total_reserved = self.total_reserved.checked_sub(transfer.amount.0).expect("Reserve underflow");
        self.transfers.insert(&transfer_id.0, &transfer);
        env::log_str(&format!("TRANSFER_SETTLED:{}", transfer_id.0));
        true
    }

    pub fn get_transfer(&self, transfer_id: U64) -> Option<Transfer> {
        self.transfers.get(&transfer_id.0)
    }

    pub fn get_transfer_count(&self) -> U64 {
        U64(self.next_transfer_id)
    }

    /// Bounded merge of append-only account indexes, newest first. This
    /// never deserializes, sorts or rewrites the account's entire history.
    pub fn get_transfers_for_account(
        &self,
        account_id: AccountId,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<Transfer> {
        let skip = from_index.unwrap_or(U64(0)).0;
        require!(skip <= 500, "Use a smaller history offset");
        let take = limit.unwrap_or(20).clamp(1, 50) as usize;
        let mut sent = self.sender_count.get(&account_id).unwrap_or(0);
        let mut received = self.recipient_count.get(&account_id).unwrap_or(0);
        let mut seen = 0u64;
        let mut result = Vec::with_capacity(take);

        while result.len() < take && (sent > 0 || received > 0) {
            let sid = if sent > 0 {
                self.sender_index.get(&(account_id.clone(), sent - 1))
            } else { None };
            let rid = if received > 0 {
                self.recipient_index.get(&(account_id.clone(), received - 1))
            } else { None };

            let id = match (sid, rid) {
                (Some(s), Some(r)) if s > r => { sent -= 1; s }
                (Some(_), Some(r)) => { received -= 1; r }
                (Some(s), None) => { sent -= 1; s }
                (None, Some(r)) => { received -= 1; r }
                (None, None) => break,
            };
            if seen >= skip {
                if let Some(transfer) = self.transfers.get(&id) {
                    result.push(transfer);
                }
            }
            seen += 1;
        }
        result
    }

    /// The worker scans a fixed ID range. A cursor and a recent-tail check
    /// in the worker avoid an unbounded scan on every invocation.
    pub fn get_pending_transfers(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Transfer> {
        let start = from_index.unwrap_or(U64(0)).0;
        let take = limit.unwrap_or(30).clamp(1, 50) as u64;
        let end = start.saturating_add(take).min(self.next_transfer_id);
        (start..end)
            .filter_map(|id| self.transfers.get(&id))
            .filter(|t| t.status == TransferStatus::Pending)
            .collect()
    }

    pub fn get_total_reserved(&self) -> U128 { U128(self.total_reserved) }
    pub fn get_owner(&self) -> AccountId { self.owner_id.clone() }
    pub fn get_storage_fee(&self) -> U128 { U128(STORAGE_FEE) }
    pub fn get_min_payment(&self) -> U128 { U128(MIN_PAYMENT) }
    pub fn get_max_payment(&self) -> U128 { U128(MAX_PAYMENT) }

    fn index_transfer(&mut self, account: &AccountId, id: u64, sender: bool) {
        if sender {
            let index = self.sender_count.get(account).unwrap_or(0);
            self.sender_index.insert(&(account.clone(), index), &id);
            self.sender_count.insert(account, &index.checked_add(1).expect("Sender index overflow"));
        } else {
            let index = self.recipient_count.get(account).unwrap_or(0);
            self.recipient_index.insert(&(account.clone(), index), &id);
            self.recipient_count.insert(account, &index.checked_add(1).expect("Recipient index overflow"));
        }
    }

    fn must_get(&self, id: u64) -> Transfer {
        self.transfers.get(&id).expect("Transfer not found")
    }

    fn pay_then_confirm(&self, receiver: AccountId, transfer: &Transfer) -> Promise {
        Promise::new(receiver)
            .transfer(NearToken::from_yoctonear(transfer.amount.0))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_settle(transfer.id)
            )
    }

    fn assert_solvency(&self) {
        let storage_cost = (env::storage_usage() as u128)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .expect("Storage total overflow");
        let minimum = self.total_reserved
            .checked_add(storage_cost)
            .and_then(|n| n.checked_add(MIN_OPERATING_RESERVE))
            .expect("Reserve total overflow");
        require!(env::account_balance().as_yoctonear() >= minimum,
            "Contract needs more independent storage and operating funding");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(a: &str) -> AccountId { a.parse().unwrap() }

    fn context(caller: &str, time_ms: u64, deposit: u128) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(account("escrow.mainnet"))
            .predecessor_account_id(account(caller))
            .signer_account_id(account(caller))
            .block_timestamp(time_ms * 1_000_000)
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        c
    }

    fn setup() -> Contract {
        testing_env!(context("owner.near", 1_000, 0).build());
        Contract::new(account("owner.near"))
    }

    fn create(c: &mut Contract, ms: u64, recipient: &str) {
        testing_env!(context("alice.near", ms, YOCTO + STORAGE_FEE).build());
        c.create_transfer(account(recipient), U128(YOCTO));
    }

    #[test]
    fn accepts_payment_and_charges_separate_storage() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        let t = c.get_transfer(U64(0)).unwrap();
        assert_eq!(t.amount, U128(YOCTO));
        assert_eq!(t.expires_at_ms, U64(61_000));
        assert_eq!(c.get_total_reserved(), U128(YOCTO));
        assert_eq!(c.get_storage_fee(), U128(STORAGE_FEE));
    }

    #[test]
    #[should_panic(expected = "Attach exactly")]
    fn rejects_deposit_without_storage_fee() {
        let mut c = setup();
        testing_env!(context("alice.near", 1_000, YOCTO).build());
        c.create_transfer(account("bob.near"), U128(YOCTO));
    }

    #[test]
    #[should_panic(expected = "Payment exceeds per-transfer cap")]
    fn caps_one_transfer_exposure() {
        let mut c = setup();
        testing_env!(context("alice.near", 1_000, MAX_PAYMENT + STORAGE_FEE + 1).build());
        c.create_transfer(account("bob.near"), U128(MAX_PAYMENT + 1));
    }

    #[test]
    #[should_panic(expected = "Only owner")]
    fn nonowner_cannot_pause() {
        let mut c = setup();
        testing_env!(context("mallory.near", 1_000, 0).build());
        c.set_paused(true);
    }

    #[test]
    fn pause_blocks_new_deposits_but_allows_refund() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("owner.near", 2_000, 0).build());
        c.set_paused(true);
        testing_env!(context("alice.near", 3_000, 0).build());
        let _ = c.cancel(U64(0));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::Refunding);
    }

    #[test]
    fn account_history_merges_sender_and_recipient_without_duplicates() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("bob.near", 1_100, YOCTO + STORAGE_FEE).build());
        c.create_transfer(account("alice.near"), U128(YOCTO));
        let both = c.get_transfers_for_account(account("alice.near"), None, None);
        assert_eq!(both.len(), 2);
        assert_eq!(both[0].id, U64(1));
        assert_eq!(both[1].id, U64(0));
        assert_eq!(c.get_transfers_for_account(account("alice.near"), Some(U64(1)), Some(1))[0].id, U64(0));
    }

    #[test]
    #[should_panic(expected = "Transfer still protected")]
    fn early_release_is_forbidden() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("keeper.near", 60_999, 0).build());
        let _ = c.release(U64(0));
    }

    #[test]
    #[should_panic(expected = "Only sender")]
    fn third_party_cannot_cancel() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("mallory.near", 2_000, 0).build());
        let _ = c.cancel(U64(0));
    }

    #[test]
    fn failed_delivery_stays_refundable() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("keeper.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        testing_env!(context("escrow.mainnet", 61_001, 0).build());
        assert!(!c.on_settle(U64(0), Err(PromiseError::Failed)));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::DeliveryFailed);
        assert_eq!(c.get_total_reserved(), U128(YOCTO));
        testing_env!(context("alice.near", 62_000, 0).build());
        let _ = c.cancel(U64(0));
        testing_env!(context("escrow.mainnet", 62_001, 0).build());
        assert!(c.on_settle(U64(0), Ok(())));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::Cancelled);
        assert_eq!(c.get_total_reserved(), U128(0));
    }

    #[test]
    #[should_panic(expected = "Transfer is not deliverable")]
    fn duplicate_payout_is_prevented() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("keeper.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        let _ = c.release(U64(0));
    }

    #[test]
    fn failed_refund_after_timely_cancel_is_never_deliverable() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("alice.near", 60_999, 0).build());
        let _ = c.cancel(U64(0));
        testing_env!(context("escrow.mainnet", 61_100, 0).build());
        assert!(!c.on_settle(U64(0), Err(PromiseError::Failed)));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::RefundFailed);
        assert!(c.get_pending_transfers(None, None).is_empty());
        testing_env!(context("alice.near", 61_500, 0).build());
        let _ = c.cancel(U64(0));
        testing_env!(context("escrow.mainnet", 61_501, 0).build());
        assert!(c.on_settle(U64(0), Ok(())));
        assert_eq!(c.get_total_reserved(), U128(0));
    }

    #[test]
    fn pause_does_not_lock_existing_payments() {
        let mut c = setup();
        create(&mut c, 1_000, "bob.near");
        testing_env!(context("owner.near", 1_500, 0).build());
        c.set_paused(true);
        testing_env!(context("keeper.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        testing_env!(context("escrow.mainnet", 61_002, 0).build());
        assert!(c.on_settle(U64(0), Ok(())));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Contract needs more independent storage and operating funding")]
    fn cannot_use_reserved_payments_to_subsidize_storage() {
        let mut c = setup();
        let mut low_balance = context("alice.near", 1_000, YOCTO + STORAGE_FEE);
        low_balance.account_balance(NearToken::from_near(1));
        testing_env!(low_balance.build());
        c.create_transfer(account("bob.near"), U128(YOCTO));
    }
}
