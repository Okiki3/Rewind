use borsh::BorshSerialize;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// Every REWIND payment has the same onchain cancellation period.
const PROTECTION_WINDOW_MS: u64 = 60_000;

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    Transfers,
    SenderTransfers,
    RecipientTransfers,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum TransferStatus {
    Pending,
    Refunding,
    RefundFailed,
    Releasing,
    Cancelled,
    Released,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Transfer {
    pub id: U64,
    pub sender: AccountId,
    pub recipient: AccountId,
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

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    transfers: LookupMap<u64, Transfer>,
    sender_transfers: LookupMap<AccountId, Vec<u64>>,
    recipient_transfers: LookupMap<AccountId, Vec<u64>>,
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
            transfers: LookupMap::new(StorageKey::Transfers),
            sender_transfers: LookupMap::new(StorageKey::SenderTransfers),
            recipient_transfers: LookupMap::new(StorageKey::RecipientTransfers),
            next_transfer_id: 0,
            total_reserved: 0,
        }
    }

    /// Holds a native NEAR payment for exactly 60 seconds after acceptance.
    /// The contract account must be separately funded for storage.
    #[payable]
    pub fn create_transfer(&mut self, recipient: AccountId) -> Transfer {
        let sender = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        let now = now_ms();
        require!(amount > 0, "Attach a positive NEAR amount");
        require!(recipient != sender, "Sender and recipient must differ");
        // No wallet or frontend can supply or extend the protection window.
        let expires_at_ms = now.checked_add(PROTECTION_WINDOW_MS).expect("Timestamp overflow");

        let id = self.next_transfer_id;
        self.next_transfer_id = id.checked_add(1).expect("Transfer id overflow");
        let transfer = Transfer {
            id: U64(id),
            sender,
            recipient,
            amount: U128(amount),
            expires_at_ms: U64(expires_at_ms),
            status: TransferStatus::Pending,
            created_at_ms: U64(now),
            settled_at_ms: None,
        };
        self.total_reserved = self
            .total_reserved
            .checked_add(amount)
            .expect("Reserved balance overflow");
        self.transfers.insert(&id, &transfer);
        append_id(&mut self.sender_transfers, &transfer.sender, id);
        append_id(&mut self.recipient_transfers, &transfer.recipient, id);
        self.assert_reserves_are_funded();
        env::log_str(&format!("TRANSFER_CREATED:{}", id));
        transfer
    }

    /// The sender may request a refund only while the deadline has not arrived.
    pub fn cancel(&mut self, transfer_id: U64) -> Promise {
        let mut transfer = self.must_get(transfer_id.0);
        require!(
            env::predecessor_account_id() == transfer.sender,
            "Only the sender may cancel"
        );
        // A failed refund keeps the sender's timely cancellation request valid,
        // even if the 60-second window has elapsed during the failed receipt.
        require!(
            transfer.status == TransferStatus::RefundFailed
                || now_ms() < transfer.expires_at_ms.0,
            "Cancellation window closed"
        );
        require!(
            transfer.status == TransferStatus::Pending
                || transfer.status == TransferStatus::RefundFailed,
            "Transfer is not pending"
        );
        transfer.status = TransferStatus::Refunding;
        self.transfers.insert(&transfer_id.0, &transfer);
        self.pay_then_confirm(transfer.sender.clone(), &transfer)
    }

    /// Anyone may trigger delivery, but only after the deadline.
    pub fn release(&mut self, transfer_id: U64) -> Promise {
        let mut transfer = self.must_get(transfer_id.0);
        require!(
            now_ms() >= transfer.expires_at_ms.0,
            "Transfer is still protected"
        );
        require!(
            transfer.status == TransferStatus::Pending,
            "Transfer is not pending"
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
        let final_status = match transfer.status {
            TransferStatus::Refunding => TransferStatus::Cancelled,
            TransferStatus::Releasing => TransferStatus::Released,
            _ => env::panic_str("Transfer is not settling"),
        };

        if result.is_err() {
            // A refund already initiated in time must NEVER become
            // releasable just because the outbound refund failed.
            transfer.status = if final_status == TransferStatus::Cancelled {
                TransferStatus::RefundFailed
            } else {
                TransferStatus::Pending
            };
            self.transfers.insert(&transfer_id.0, &transfer);
            env::log_str(&format!("TRANSFER_SETTLEMENT_FAILED:{}", transfer_id.0));
            return false;
        }

        transfer.status = final_status;
        transfer.settled_at_ms = Some(U64(now_ms()));
        self.total_reserved = self
            .total_reserved
            .checked_sub(transfer.amount.0)
            .expect("Reserved balance underflow");
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

    pub fn get_transfers_for_account(
        &self,
        account_id: AccountId,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<Transfer> {
        let mut ids = self.sender_transfers.get(&account_id).unwrap_or_default();
        ids.extend(
            self.recipient_transfers
                .get(&account_id)
                .unwrap_or_default(),
        );
        ids.sort_unstable();
        ids.dedup();
        ids.reverse();
        let start = from_index.unwrap_or(U64(0)).0 as usize;
        let take = limit.unwrap_or(20).min(50) as usize;
        ids.into_iter()
            .skip(start)
            .take(take)
            .filter_map(|id| self.transfers.get(&id))
            .collect()
    }

    /// Paginated discovery for permissionless release workers.
    /// Fetching the next page uses a stable numeric ID range, not recent history.
    pub fn get_pending_transfers(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Transfer> {
        let start = from_index.unwrap_or(U64(0)).0;
        let take = limit.unwrap_or(30).clamp(1, 50) as u64;
        let end = start.saturating_add(take).min(self.next_transfer_id);
        (start..end)
            .filter_map(|id| self.transfers.get(&id))
            .filter(|transfer| transfer.status == TransferStatus::Pending)
            .collect()
    }

    pub fn get_total_reserved(&self) -> U128 {
        U128(self.total_reserved)
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
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
                    .on_settle(transfer.id),
            )
    }

    fn assert_reserves_are_funded(&self) {
        let storage_cost = env::storage_byte_cost()
            .saturating_mul(env::storage_usage() as u128)
            .as_yoctonear();
        let available = env::account_balance()
            .as_yoctonear()
            .checked_sub(storage_cost)
            .unwrap_or(0);
        require!(
            available >= self.total_reserved,
            "Contract needs additional storage funding"
        );
    }
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn append_id(index: &mut LookupMap<AccountId, Vec<u64>>, account_id: &AccountId, id: u64) {
    let mut ids = index.get(account_id).unwrap_or_default();
    ids.push(id);
    index.insert(account_id, &ids);
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 10u128.pow(24);

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn context(predecessor: &str, now_ms: u64, deposit: u128) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("escrow.test.near"))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .block_timestamp(now_ms * 1_000_000)
            .account_balance(NearToken::from_near(20))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        builder
    }

    fn contract() -> Contract {
        Contract::new(account("owner.test.near"))
    }

    fn create(c: &mut Contract, now: u64) {
        testing_env!(context("alice.test.near", now, ONE_NEAR).build());
        c.create_transfer(account("bob.test.near"));
    }

    #[test]
    fn creates_real_reservation() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        let transfer = c.get_transfer(U64(0)).unwrap();
        assert_eq!(transfer.amount, U128(ONE_NEAR));
        assert_eq!(transfer.status, TransferStatus::Pending);
        assert_eq!(transfer.expires_at_ms, U64(61_000));
        assert_eq!(c.get_total_reserved(), U128(ONE_NEAR));
    }

    #[test]
    #[should_panic(expected = "Only the sender may cancel")]
    fn rejects_unauthorized_cancel() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("mallory.test.near", 1_500, 0).build());
        let _ = c.cancel(U64(0));
    }

    #[test]
    #[should_panic(expected = "Transfer is still protected")]
    fn rejects_early_release() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("bob.test.near", 60_999, 0).build());
        let _ = c.release(U64(0));
    }

    #[test]
    #[should_panic(expected = "Cancellation window closed")]
    fn rejects_cancel_at_expiry() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("alice.test.near", 61_000, 0).build());
        let _ = c.cancel(U64(0));
    }

    #[test]
    #[should_panic(expected = "Attach a positive NEAR amount")]
    fn rejects_zero_deposit() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        testing_env!(context("alice.test.near", 1_000, 0).build());
        c.create_transfer(account("bob.test.near"));
    }

    #[test]
    fn account_history_is_real_and_deduplicated() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("bob.test.near", 1_100, ONE_NEAR).build());
        c.create_transfer(account("alice.test.near"));
        let alice = c.get_transfers_for_account(account("alice.test.near"), None, None);
        assert_eq!(alice.len(), 2);
        assert_eq!(alice[0].id, U64(1));
        assert_eq!(alice[1].id, U64(0));
    }

    #[test]
    fn boundary_is_strict_cancel_then_release() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("alice.test.near", 60_999, 0).build());
        let _ = c.cancel(U64(0));
        assert_eq!(
            c.get_transfer(U64(0)).unwrap().status,
            TransferStatus::Refunding
        );

        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("carol.test.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        assert_eq!(
            c.get_transfer(U64(0)).unwrap().status,
            TransferStatus::Releasing
        );
    }

    #[test]
    #[should_panic(expected = "Transfer is not pending")]
    fn blocks_double_payout_while_callback_pending() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("carol.test.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        let _ = c.release(U64(0));
    }

    #[test]
    fn failed_callback_restores_pending_and_retry_is_safe() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("carol.test.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        testing_env!(context("escrow.test.near", 61_001, 0).build());
        assert!(!c.on_settle(U64(0), Err(PromiseError::Failed)));
        assert_eq!(
            c.get_transfer(U64(0)).unwrap().status,
            TransferStatus::Pending
        );
        assert_eq!(c.get_total_reserved(), U128(ONE_NEAR));

        testing_env!(context("carol.test.near", 61_002, 0).build());
        let _ = c.release(U64(0));
        testing_env!(context("escrow.test.near", 61_003, 0).build());
        assert!(c.on_settle(U64(0), Ok(())));
        assert_eq!(
            c.get_transfer(U64(0)).unwrap().status,
            TransferStatus::Released
        );
        assert_eq!(c.get_total_reserved(), U128(0));
    }

    #[test]
    fn failed_refund_stays_sender_recoverable_after_expiry() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("alice.test.near", 60_999, 0).build());
        let _ = c.cancel(U64(0));
        testing_env!(context("escrow.test.near", 61_002, 0).build());
        assert!(!c.on_settle(U64(0), Err(PromiseError::Failed)));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::RefundFailed);
        assert_eq!(c.get_total_reserved(), U128(ONE_NEAR));
        // Sending to the recipient is forbidden after the refund attempt.
        assert!(c.get_pending_transfers(None, None).is_empty());
        testing_env!(context("alice.test.near", 61_500, 0).build());
        let _ = c.cancel(U64(0));
        testing_env!(context("escrow.test.near", 61_501, 0).build());
        assert!(c.on_settle(U64(0), Ok(())));
        assert_eq!(c.get_transfer(U64(0)).unwrap().status, TransferStatus::Cancelled);
    }

    #[test]
    fn pending_page_scans_all_id_ranges() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        create(&mut c, 1_001);
        assert_eq!(c.get_pending_transfers(Some(U64(0)), Some(1)).len(), 1);
        assert_eq!(c.get_pending_transfers(Some(U64(1)), Some(1)).len(), 1);
        assert_eq!(c.get_pending_transfers(Some(U64(2)), Some(1)).len(), 0);
    }

    #[test]
    #[should_panic(expected = "Transfer is not settling")]
    fn callback_cannot_finalize_twice() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        create(&mut c, 1_000);
        testing_env!(context("carol.test.near", 61_000, 0).build());
        let _ = c.release(U64(0));
        testing_env!(context("escrow.test.near", 61_001, 0).build());
        c.on_settle(U64(0), Ok(()));
        c.on_settle(U64(0), Ok(()));
    }

    #[test]
    #[should_panic(expected = "Contract needs additional storage funding")]
    fn refuses_to_create_if_storage_would_invade_reserves() {
        testing_env!(context("owner.test.near", 1_000, 0).build());
        let mut c = contract();
        let mut poor = context("alice.test.near", 1_000, ONE_NEAR);
        poor.account_balance(NearToken::from_yoctonear(ONE_NEAR));
        testing_env!(poor.build());
        c.create_transfer(account("bob.test.near"));
    }
}
