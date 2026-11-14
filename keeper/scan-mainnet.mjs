/**
 * Bounded release scan for the new Mainnet candidate contract.
 * Never rescans the entire historic transfer ledger every ten seconds.
 *
 * A durable cursor sweeps the full ID space; recent tail pages are sampled on
 * every poll so newly created payments can be released promptly after expiry.
 */
export async function scanMainnetDueTransfers({
  account,
  contractId,
  cursor = 0,
  now = Date.now,
  pageSize = 30,
  maxCursorPages = 4,
  recentPages = 2,
  logger = console,
}) {
  if (!contractId || !/^[a-z0-9._-]+$/.test(contractId)) throw new Error('Invalid contract account ID');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      !Number.isSafeInteger(maxCursorPages) || maxCursorPages < 1 || maxCursorPages > 10 ||
      !Number.isSafeInteger(recentPages) || recentPages < 0 || recentPages > 4) {
    throw new Error('Invalid bounded-scan parameters');
  }

  const count = Number(await account.viewFunction({
    contractId, methodName: 'get_transfer_count', args: {},
  }));
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid transfer count');
  const results = {
    examined: 0, attempted: 0, released: 0, failed: 0,
    pages: 0, nextCursor: 0, totalTransfers: count,
  };
  if (!count) return results;

  const scanStarts = new Set();
  let index = Number.isSafeInteger(cursor) && cursor >= 0 && cursor < count
    ? Math.floor(cursor / pageSize) * pageSize
    : 0;
  for (let n = 0; n < maxCursorPages && scanStarts.size < Math.ceil(count / pageSize); n++) {
    scanStarts.add(index);
    index = index + pageSize >= count ? 0 : index + pageSize;
  }
  results.nextCursor = index;
  let tail = Math.floor((count - 1) / pageSize) * pageSize;
  for (let n = 0; n < recentPages && tail >= 0; n++) {
    scanStarts.add(tail);
    tail -= pageSize;
  }

  const seenIds = new Set();
  for (const start of scanStarts) {
    const pending = await account.viewFunction({
      contractId, methodName: 'get_pending_transfers',
      args: { from_index: String(start), limit: pageSize },
    });
    if (!Array.isArray(pending)) throw new Error('Invalid pending transfer page');
    results.pages += 1;
    for (const transfer of pending) {
      const id = String(transfer?.id);
      if (!/^\d+$/.test(id) || seenIds.has(id)) continue;
      seenIds.add(id);
      results.examined++;
      if (transfer.status !== 'Pending' ||
          !/^\d+$/.test(String(transfer.expires_at_ms)) ||
          Number(transfer.expires_at_ms) > now()) continue;

      results.attempted++;
      try {
        await account.functionCall({
          contractId, methodName: 'release', args: { transfer_id: id },
          gas: 50_000_000_000_000n, attachedDeposit: 0n,
        });
        const confirmed = await account.viewFunction({
          contractId, methodName: 'get_transfer', args: { transfer_id: id },
        });
        if (confirmed?.status === 'Released') {
          results.released++;
          logger.info('Released transfer ' + id);
        } else {
          results.failed++;
          logger.warn('Settlement pending or failed for transfer ' + id + ': ' + String(confirmed?.status));
        }
      } catch (error) {
        results.failed++;
        logger.warn('Release failed for transfer ' + id + ': ' + String(error));
      }
    }
  }
  return results;
}
