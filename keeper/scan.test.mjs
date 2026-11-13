import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanAndRelease } from './scan.mjs';

describe('permissionless release keeper', () => {
  it('releases expired transfers, skips unexpired, scans multiple pages', async () => {
    const released = [];
    const account = {
      async viewFunction({ methodName, args }) {
        if (methodName === 'get_transfer_count') return '32';
        if (methodName === 'get_pending_transfers') {
          return args.from_index === '0'
            ? [{ id: '0', expires_at_ms: '1000', status: 'Pending' }, { id: '1', expires_at_ms: '9999', status: 'Pending' }]
            : [{ id: '31', expires_at_ms: '1000', status: 'Pending' }];
        }
        return { status: released.includes(args.transfer_id) ? 'Released' : 'Pending' };
      },
      async functionCall({ args }) { released.push(args.transfer_id); },
    };
    const result = await scanAndRelease({
      account, contractId: 'rewind.testnet', now: () => 2000,
      logger: { info() {}, warn() {} },
    });
    assert.deepEqual(released, ['0', '31']);
    assert.equal(result.released, 2);
    assert.equal(result.attempted, 2);
  });

  it('does not report settlement as success if callback did not release', async () => {
    const account = {
      async viewFunction({ methodName }) {
        if (methodName === 'get_transfer_count') return '1';
        if (methodName === 'get_pending_transfers') return [{ id: '0', expires_at_ms: '1000', status: 'Pending' }];
        return { status: 'Pending' };
      },
      async functionCall() {},
    };
    const result = await scanAndRelease({
      account, contractId: 'rewind.testnet', now: () => 2000,
      logger: { info() {}, warn() {} },
    });
    assert.equal(result.released, 0);
    assert.equal(result.failed, 1);
  });
});
