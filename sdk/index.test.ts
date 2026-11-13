import { describe, expect, it } from 'vitest';
import { buildCancelTransaction, buildProtectedSendTransaction, isNearAccountId, parseNearAmount, preflight, PROTECTION_WINDOW_MS } from './index';

const verified = async () => ({ ok: true, json: async () => ({ result: { code_hash: '11111111111111111111111111111111' } }) }) as Response;
const missing = async () => ({ ok: true, json: async () => ({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } }) }) as Response;

describe('REWIND wallet SDK', () => {
  it('sets fixed protection in the protocol, not user transaction arguments', () => {
    expect(PROTECTION_WINDOW_MS).toBe(60_000);
    expect(buildProtectedSendTransaction('rewind.testnet', 'winner.testnet', '1.5')).toEqual({
      receiverId: 'rewind.testnet',
      methodName: 'create_transfer',
      args: { recipient: 'winner.testnet' },
      gas: '30000000000000',
      deposit: '1500000000000000000000000',
    });
  });
  it('checks amount and identifiers', () => {
    expect(parseNearAmount('0.1')).toBe('100000000000000000000000');
    expect(() => parseNearAmount('0')).toThrow();
    expect(isNearAccountId('winner.testnet')).toBe(true);
    expect(isNearAccountId('wrong..testnet')).toBe(false);
    expect(() => buildCancelTransaction('rewind.testnet', '1x')).toThrow();
  });
  it('catches a near-match to a saved contact', async () => {
    const result = await preflight({
      recipient: 'al1ce.testnet', amountNear: '1', network: 'testnet',
      contacts: [{ address: 'alice.testnet' }], fetcher: verified,
    });
    expect(result.warnings.map((x) => x.code)).toContain('lookalike');
  });
  it('warns for an absent account without claiming fraud', async () => {
    const result = await preflight({
      recipient: 'wrong.testnet', amountNear: '1', network: 'testnet', fetcher: missing,
    });
    expect(result.warnings.map((x) => x.code)).toContain('missing_account');
  });
  it('flags unusual amounts only against a supplied threshold', async () => {
    const result = await preflight({
      recipient: 'winner.testnet', amountNear: '10', warnAboveNear: '1',
      network: 'testnet', fetcher: verified,
    });
    expect(result.warnings.map((x) => x.code)).toContain('large_amount');
  });
});
