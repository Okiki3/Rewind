/**
 * Contract-call builder for the isolated Mainnet escrow candidate.
 * NOT the live Testnet ABI. Do not integrate with real funds until the
 * deployed Mainnet contract, code hash and keys have passed release review.
 */
import { isNearAccountId, parseNearAmount, type ContractCall } from './index';

export const MAINNET_CANDIDATE_STORAGE_FEE_YOCTO = '20000000000000000000000'; // 0.02 NEAR
export const MAINNET_CANDIDATE_MIN_YOCTO = '10000000000000000000000'; // 0.01 NEAR
export const MAINNET_CANDIDATE_MAX_YOCTO = '2000000000000000000000000'; // 2 NEAR
export const MAINNET_CANDIDATE_ABI_VERSION = 'rewind-mainnet-candidate-v1';

/** Attached NEAR = escrowed transfer amount + non-refundable storage fee. */
export function buildMainnetCandidateSendTransaction(
  contractId: string,
  recipient: string,
  amountNear: string,
): ContractCall {
  if (!isNearAccountId(contractId) || !contractId.endsWith('.near') ||
      !isNearAccountId(recipient) || recipient.endsWith('.testnet')) {
    throw new Error('Expected an approved Mainnet contract and Mainnet recipient');
  }
  if (contractId === recipient) throw new Error('Contract cannot receive its own protected payment');
  const amount = BigInt(parseNearAmount(amountNear));
  if (amount < BigInt(MAINNET_CANDIDATE_MIN_YOCTO)) throw new Error('Minimum protected payment is 0.01 NEAR');
  if (amount > BigInt(MAINNET_CANDIDATE_MAX_YOCTO)) throw new Error('Maximum protected payment is 2 NEAR');
  return {
    receiverId: contractId,
    methodName: 'create_transfer',
    args: { recipient, transfer_amount: amount.toString() },
    gas: '30000000000000',
    deposit: (amount + BigInt(MAINNET_CANDIDATE_STORAGE_FEE_YOCTO)).toString(),
  };
}
