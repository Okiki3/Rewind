/**
 * Example third-party NEAR wallet integration.
 * This file does not use the AfroliteHub frontend or wallet selector.
 * A host wallet supplies its own signing method and confirmation dialog.
 */
import {
  preflight,
  buildProtectedSendTransaction,
  buildCancelTransaction,
  type Review,
  type Network,
} from '../../sdk/index';

export interface HostWallet {
  accountId: string;
  signFunctionCall: (args: {
    receiverId: string;
    methodName: string;
    args: Record<string, string>;
    gas: string;
    deposit: string;
  }) => Promise<{ transactionHash: string }>;
}

export async function sendViaRewind(options: {
  wallet: HostWallet;
  contractId: string;
  network: Network;
  recipient: string;
  amountNear: string;
  contacts?: Array<{ address: string }>;
  warnAboveNear?: string;
  confirmReview: (review: Review, amountNear: string) => Promise<boolean>;
  fetcher?: typeof fetch;
}) {
  const review = await preflight({
    network: options.network,
    recipient: options.recipient,
    amountNear: options.amountNear,
    contacts: options.contacts,
    warnAboveNear: options.warnAboveNear,
    fetcher: options.fetcher,
  });
  if (!review.valid) throw new Error('Recipient requires correction before sending');
  // Every transfer is explicitly reviewed. Any detected risk is presented here.
  if (!await options.confirmReview(review, options.amountNear)) {
    return { submitted: false as const };
  }
  const transaction = buildProtectedSendTransaction(
    options.contractId, review.recipient, options.amountNear,
  );
  const proof = await options.wallet.signFunctionCall(transaction);
  return { submitted: true as const, transactionHash: proof.transactionHash };
}

export async function cancelViaRewind(wallet: HostWallet, contractId: string, transferId: string) {
  // Only the sender will be authorised by REWIND's onchain contract.
  return wallet.signFunctionCall(buildCancelTransaction(contractId, transferId));
}
