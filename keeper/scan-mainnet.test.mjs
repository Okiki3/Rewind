import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanMainnetDueTransfers } from './scan-mainnet.mjs';

describe('bounded Mainnet escrow keeper', () => {
  it('scans a bounded history window plus the newest payments', async () => {
    const starts = [];
    const executed = [];
    const alreadyReleased = new Set();
    const account = {
      async viewFunction({methodName, args}) {
        if (methodName === 'get_transfer_count') return '300';
        if (methodName === 'get_pending_transfers') {
          starts.push(Number(args.from_index));
          const first = Number(args.from_index);
          return [first, first+1].map((id) => ({
            id: String(id), expires_at_ms: '1000', status: 'Pending',
          }));
        }
        return { status: alreadyReleased.has(args.transfer_id) ? 'Released' : 'Pending' };
      },
      async functionCall({args}) {
        executed.push(args.transfer_id);
        alreadyReleased.add(args.transfer_id);
      },
    };
    const result = await scanMainnetDueTransfers({
      account, contractId: 'rewind.near', cursor: 0, now: () => 2000,
      logger: {info(){}, warn(){}},
    });
    assert.deepEqual(starts, [0,30,60,90,270,240]);
    assert.equal(result.pages, 6);
    assert.equal(result.nextCursor, 120);
    assert.equal(result.released, 12);
    assert.equal(executed.length, 12);
    assert.ok(!starts.includes(120), 'Older history must wait until the next scan');
  });

  it('advances cursor, wraps around and avoids duplicate newest page', async () => {
    const starts = [];
    const account = {
      async viewFunction({methodName, args}) {
        if (methodName === 'get_transfer_count') return '60';
        if (methodName === 'get_pending_transfers') {
          starts.push(Number(args.from_index));
          return [];
        }
      },
      async functionCall() { throw new Error('Nothing pending'); },
    };
    const result = await scanMainnetDueTransfers({
      account, contractId: 'rewind.near', cursor: 30, now: () => 2000,
    });
    assert.deepEqual(starts, [30,0]);
    assert.equal(result.pages, 2);
    assert.equal(result.nextCursor, 30);
  });

  it('never releases unexpired transfers and avoids claiming in-flight callbacks succeeded', async () => {
    let sent = 0;
    const warnings = [];
    const account = {
      async viewFunction({methodName}) {
        if (methodName === 'get_transfer_count') return '2';
        if (methodName === 'get_pending_transfers') return [
          {id:'0', expires_at_ms:'9999', status:'Pending'},
          {id:'1', expires_at_ms:'1000', status:'Pending'},
        ];
        return {status:'Releasing'};
      },
      async functionCall() { sent++; },
    };
    const result = await scanMainnetDueTransfers({
      account, contractId:'rewind.near', now:() => 2000,
      logger:{info(){}, warn(message){warnings.push(message)}},
    });
    assert.equal(sent, 1);
    assert.equal(result.released, 0);
    assert.equal(result.failed, 1);
    assert.equal(warnings.length, 1);
  });

  it('handles an empty contract and rejects unbounded scanning parameters', async () => {
    const account = { async viewFunction(){ return '0'; } };
    assert.equal((await scanMainnetDueTransfers({account,contractId:'rewind.near'})).pages, 0);
    await assert.rejects(
      scanMainnetDueTransfers({account,contractId:'rewind.near',maxCursorPages:100000}),
      /bounded-scan/,
    );
  });
});
