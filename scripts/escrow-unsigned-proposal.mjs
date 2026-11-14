/**
 * Creates a STRICTLY UNSIGNED NEAR Mainnet subaccount transaction proposal.
 * No wallet credentials or seed phrases are accepted by this module.
 */
export const OWNER_ID = 'afrolite.near';
export const ESCROW_ID = 'escrow.afrolite.near';
export const MIN_FUND_NEAR = '3.5';
export const MAX_FUND_NEAR = '10';
const YOCTO = 10n ** 24n;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value) {
  if (typeof value !== 'string' || !value) throw Error('Public key is missing');
  let n = 0n;
  for (const ch of value) {
    const d = BASE58.indexOf(ch);
    if (d < 0) throw Error('Invalid base58 public key');
    n = n * 58n + BigInt(d);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of value) { if (ch !== '1') break; out.unshift(0); }
  return new Uint8Array(out);
}

export function validateEscrowPublicKey(value) {
  if (typeof value !== 'string' || !value.startsWith('ed25519:')) {
    throw Error('Use a new ed25519: public key, never a private key or seed phrase');
  }
  if (value.includes(' ') || value.length > 100) throw Error('Public key contains extra content');
  const bytes = decodeBase58(value.slice('ed25519:'.length));
  if (bytes.length !== 32) throw Error('Ed25519 public key must decode to exactly 32 bytes');
  if (bytes.every(v => v === 0)) throw Error('Invalid zero public key');
  return value;
}

export function parseFundingYocto(value) {
  if (typeof value !== 'string' || !/^(?:[0-9]+)(?:\.[0-9]{1,24})?$/.test(value)) {
    throw Error('Enter NEAR funding as a decimal string with at most 24 places');
  }
  const [whole, fractional = ''] = value.split('.');
  const amount = BigInt(whole) * YOCTO + BigInt(fractional.padEnd(24, '0'));
  if (amount < 35n * YOCTO / 10n || amount > 10n * YOCTO) {
    throw Error('Pilot account creation funding must be between 3.5 and 10 NEAR');
  }
  return amount.toString();
}

/** These actions are signed by afrolite.near and received by escrow.afrolite.near. */
export function createUnsignedEscrowProposal({ publicKey, fundingNear, ownerPublicKeys = [] }) {
  const verifiedKey = validateEscrowPublicKey(publicKey);
  if (ownerPublicKeys.includes(verifiedKey)) {
    throw Error('Escrow upgrade signing key must be distinct from afrolite.near owner key');
  }
  const deposit = parseFundingYocto(fundingNear);
  return {
    network: 'mainnet',
    signerId: OWNER_ID,
    receiverId: ESCROW_ID,
    actions: [
      { type: 'CreateAccount' },
      { type: 'Transfer', params: { deposit } },
      { type: 'AddKey', params: { publicKey: verifiedKey, accessKey: { permission: 'FullAccess' } } },
    ],
    verifiedContractDeployment: false,
    isSigned: false,
    isBroadcast: false,
    readyForPublicEscrowFunds: false,
  };
}
