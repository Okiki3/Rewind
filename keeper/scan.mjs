/**
 * Permissionless, idempotent release worker for REWIND transfers.
 * All timing and recipient rules are enforced by the NEAR contract, not here.
 */
export async function scanAndRelease({ account, contractId, now = Date.now, logger = console }) {
  const count = Number(await account.viewFunction({ contractId, methodName: 'get_transfer_count', args: {} }));
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid transfer count');
  const result = { examined: 0, attempted: 0, released: 0, failed: 0 };
  for (let start = 0; start < count; start += 30) {
    const pending = await account.viewFunction({
      contractId, methodName: 'get_pending_transfers',
      args: { from_index: String(start), limit: 30 },
    });
    if (!Array.isArray(pending)) throw new Error('Invalid pending response');
    for (const transfer of pending) {
      result.examined += 1;
      if (transfer.status !== 'Pending' || Number(transfer.expires_at_ms) > now()) continue;
      result.attempted += 1;
      try {
        await account.functionCall({
          contractId, methodName: 'release', args: { transfer_id: String(transfer.id) },
          gas: BigInt('50000000000000'), attachedDeposit: 0n,
        });
        const updated = await account.viewFunction({
          contractId, methodName: 'get_transfer',
          args: { transfer_id: String(transfer.id) },
        });
        if (updated?.status === 'Released') {
          result.released += 1;
          logger.info('Released transfer ' + transfer.id);
        } else {
          result.failed += 1;
          logger.warn('Transfer still not released: ' + transfer.id + ' (' + String(updated?.status) + ')');
        }
      } catch (error) {
        result.failed += 1;
        logger.warn('Release attempt failed for ' + transfer.id + ': ' + String(error));
      }
    }
  }
  return result;
}
