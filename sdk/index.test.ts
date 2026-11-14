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
    expect(result.valid).toBe(false);
  });
  it('returns only one blocking error for nonexistent accounts, even with saved contacts and an amount alert', async () => {
    const result = await preflight({
      recipient: 'afroliteee.testnet', amountNear: '0.1', network: 'testnet',
      contacts: [{ address: 'afrolite.testnet' }],
      recentRecipients: ['friend.testnet'], warnAboveNear: '0.01',
      fetcher: missing,
    });
    expect(result.valid).toBe(false);
    expect(result.verifiedAccount).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('missing_account');
    expect(result.warnings[0].message).toContain('afroliteee.testnet');
    expect(result.warnings[0].message).toContain('Did you mean afrolite.testnet');
  });
  it('returns one clear invalid-format error with no unrelated warnings', async () => {
    const result = await preflight({
      recipient: 'wrong..testnet', amountNear: '0.1', network: 'testnet',
      contacts: [{ address: 'wrong.testnet' }], fetcher: missing,
    });
    expect(result.valid).toBe(false);
    expect(result.warnings).toEqual([{ code: 'invalid_address', message: 'Enter a valid NEAR account address.' }]);
  });
  it('keeps optional alerts for valid addresses only', async () => {
    const result = await preflight({
      recipient: 'al1ce.testnet', amountNear: '1', network: 'testnet',
      contacts: [{ address: 'alice.testnet' }], warnAboveNear: '0.5',
      fetcher: verified,
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['lookalike', 'large_amount']);
    expect(result.warnings.map((w) => w.code)).not.toContain('first_time');
  });
  it('uses supported Testnet RPC instead of deprecated near.org addresses', async () => {
    const requested: string[] = [];
    const checked = await preflight({
      recipient: 'afrolite.testnet', amountNear: '0.5', network: 'testnet',
      fetcher: async (input) => {
        requested.push(String(input));
        return verified();
      },
    });
    expect(requested).toEqual(['https://rpc.testnet.fastnear.com']);
    expect(checked.valid).toBe(true);
    expect(checked.verifiedAccount).toBe(true);
    expect(checked.warnings).toHaveLength(0);
  });
  it('falls back to a second RPC on a deprecated endpoint error', async () => {
    const called: string[] = [];
    const checked = await preflight({
      recipient: 'afrolite.testnet', amountNear: '0.1', network: 'testnet',
      fetcher: async (input) => {
        called.push(String(input));
        return called.length === 1
          ? { ok: true, json: async () => ({ error: { code: -429, message: 'RPC deprecated' } }) } as Response
          : verified();
      },
    });
    expect(called).toEqual(['https://rpc.testnet.fastnear.com', 'https://near-testnet.drpc.org']);
    expect(checked.valid).toBe(true);
    expect(checked.verifiedAccount).toBe(true);
    expect(checked.warnings).toHaveLength(0);
  });
  it('does not call an unresponsive RPC a suspicious recipient or allow an unverified send', async () => {
    const checked = await preflight({
      recipient: 'afrolite.testnet', amountNear: '0.1', network: 'testnet',
      fetcher: async () => { throw new Error('HTTP 429'); },
    });
    expect(checked.valid).toBe(false);
    expect(checked.warnings).toEqual([expect.objectContaining({ code: 'unverified' })]);
    expect(checked.warnings[0].message).toMatch(/temporarily unavailable/);
  });
  it('flags unusual amounts only against a supplied threshold', async () => {
    const result = await preflight({
      recipient: 'winner.testnet', amountNear: '10', warnAboveNear: '1',
      network: 'testnet', fetcher: verified,
    });
    expect(result.warnings.map((x) => x.code)).toContain('large_amount');
  });
});
