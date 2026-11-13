/**
 * REWIND native NEAR wallet integration library.
 * Does not handle private keys, and does not sign on behalf of a wallet.
 */
export const PROTECTION_WINDOW_MS = 60_000;
export const DEFAULT_GAS = '30000000000000';
export const SETTLEMENT_GAS = '50000000000000';
const YOCTO = 10n ** 24n;

export type Network = 'mainnet' | 'testnet';
export type WarningCode = 'lookalike' | 'first_time' | 'contract_account' | 'unverified' | 'missing_account' | 'large_amount';
export interface Contact { name?: string; address: string }
export interface Warning { code: WarningCode; message: string }
export interface Review {
  recipient: string;
  warnings: Warning[];
  verifiedAccount: boolean;
  valid: boolean;
}
export interface PreflightOptions {
  recipient: string;
  amountNear: string;
  network: Network;
  contacts?: Contact[];
  recentRecipients?: string[];
  warnAboveNear?: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}
export interface ContractCall {
  receiverId: string;
  methodName: string;
  args: Record<string, string>;
  gas: string;
  deposit: string;
}

export function isNearAccountId(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  // Named NEAR accounts and 64-character implicit addresses.
  return /^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*)$/.test(value);
}

export function parseNearAmount(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,24})?$/.test(normalized)) throw new Error('Invalid NEAR amount');
  const parts = normalized.split('.');
  const amount = BigInt(parts[0]) * YOCTO + BigInt((parts[1] || '').padEnd(24, '0'));
  if (amount <= 0n) throw new Error('Enter an amount greater than zero');
  return amount.toString();
}

function distanceAtMostTwo(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return previous[b.length] > 0 && previous[b.length] <= (Math.min(a.length, b.length) < 7 ? 1 : 2);
}

export async function preflight(options: PreflightOptions): Promise<Review> {
  const recipient = options.recipient.trim().toLowerCase();
  if (!isNearAccountId(recipient)) {
    return { recipient, valid: false, verifiedAccount: false, warnings: [
      { code: 'unverified', message: 'This is not a valid NEAR account format.' },
    ] };
  }
  // Parse before asking wallet to sign: reject invalid or zero-value amounts.
  const amount = BigInt(parseNearAmount(options.amountNear));
  const warnings: Warning[] = [];
  const known = [
    ...(options.contacts || []).map((c) => c.address.toLowerCase()),
    ...(options.recentRecipients || []).map((r) => r.toLowerCase()),
  ];
  const looksLike = known.find((item) => item !== recipient && distanceAtMostTwo(item, recipient));
  if (looksLike) {
    warnings.push({ code: 'lookalike', message: 'Double-check: this resembles your known address ' + looksLike + '.' });
  }
  if (known.length > 0 && !known.includes(recipient)) {
    warnings.push({ code: 'first_time', message: 'You have not previously used this recipient in the supplied contact/history list.' });
  }
  if (options.warnAboveNear && amount > BigInt(parseNearAmount(options.warnAboveNear))) {
    warnings.push({ code: 'large_amount', message: 'This amount exceeds your configured safety threshold of ' + options.warnAboveNear + ' NEAR.' });
  }
  const rpcUrl = options.rpcUrl || (options.network === 'mainnet' ? 'https://rpc.mainnet.near.org' : 'https://rpc.testnet.near.org');
  let verifiedAccount = false;
  try {
    const fetcher = options.fetcher || fetch;
    const response = await fetcher(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'rewind-account-check', method: 'query',
        params: { request_type: 'view_account', finality: 'final', account_id: recipient },
      }),
    });
    if (!response.ok) throw new Error('RPC HTTP ' + response.status);
    const result = await response.json() as {
      result?: { code_hash?: string };
      error?: { cause?: { name?: string }; message?: string };
    };
    if (result.error) {
      if (result.error.cause?.name === 'UNKNOWN_ACCOUNT') {
        warnings.push({ code: 'missing_account', message: 'Recipient account was not found on ' + options.network + '. Check for a typo.' });
      } else {
        throw new Error(result.error.message || 'Unable to verify recipient');
      }
    } else if (result.result) {
      verifiedAccount = true;
      // An account with an empty contract has the canonical empty code hash.
      if (result.result.code_hash && result.result.code_hash !== '11111111111111111111111111111111') {
        warnings.push({ code: 'contract_account', message: 'This recipient is a smart contract account. Only send if you know it can receive the funds.' });
      }
    } else {
      throw new Error('Malformed RPC response');
    }
  } catch {
    warnings.push({ code: 'unverified', message: 'Could not verify the recipient onchain. Verify the address before sending.' });
  }
  return { recipient, warnings, valid: true, verifiedAccount };
}

export function buildProtectedSendTransaction(contractId: string, recipient: string, amountNear: string): ContractCall {
  if (!isNearAccountId(contractId) || !isNearAccountId(recipient)) throw new Error('Invalid NEAR account');
  if (contractId === recipient) throw new Error('Contract cannot be payment recipient');
  return {
    receiverId: contractId,
    methodName: 'create_transfer',
    args: { recipient },
    gas: DEFAULT_GAS,
    deposit: parseNearAmount(amountNear),
  };
}

export function buildCancelTransaction(contractId: string, transferId: string): ContractCall {
  if (!isNearAccountId(contractId) || !/^\d+$/.test(transferId)) throw new Error('Invalid transfer');
  return { receiverId: contractId, methodName: 'cancel', args: { transfer_id: transferId }, gas: SETTLEMENT_GAS, deposit: '0' };
}

export function buildReleaseTransaction(contractId: string, transferId: string): ContractCall {
  if (!isNearAccountId(contractId) || !/^\d+$/.test(transferId)) throw new Error('Invalid transfer');
  return { receiverId: contractId, methodName: 'release', args: { transfer_id: transferId }, gas: SETTLEMENT_GAS, deposit: '0' };
}
