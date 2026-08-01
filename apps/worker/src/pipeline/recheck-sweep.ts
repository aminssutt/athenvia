import type { Logger } from "pino";

export type RecheckableSource = {
  id: string;
};

export type RecheckSweepDependencies = {
  /**
   * Official, programme-linked sources whose last check is older than the
   * cutoff (or that were never checked), oldest first, capped at `limit`.
   * Registry-only university sources are never candidates: they carry no
   * application dates and re-crawling tens of thousands of them would be
   * pure noise.
   */
  findStaleSources: (checkedBefore: Date, limit: number) => Promise<RecheckableSource[]>;
  enqueueFetch: (sourceId: string, dedupeKey: string) => Promise<void>;
  logger: Logger;
  now?: () => Date;
};

export type RecheckSweepOptions = {
  recheckDays: number;
  batchSize: number;
};

export type RecheckSweepResult = {
  enqueued: number;
};

/**
 * Periodic safety net that keeps official programme sources fresh: any source
 * not checked within the recheck window is enqueued for a fetch. The per-day
 * dedupe key makes the sweep idempotent while a job is still queued or the
 * sweep fires more than once a day.
 */
export async function runSourceRecheckSweep(
  options: RecheckSweepOptions,
  dependencies: RecheckSweepDependencies,
): Promise<RecheckSweepResult> {
  const now = dependencies.now ?? (() => new Date());
  const currentTime = now();
  const cutoff = new Date(currentTime.getTime() - options.recheckDays * 24 * 60 * 60 * 1_000);
  const staleSources = await dependencies.findStaleSources(cutoff, options.batchSize);

  const day = currentTime.toISOString().slice(0, 10);
  let enqueued = 0;
  for (const source of staleSources) {
    await dependencies.enqueueFetch(source.id, `fetch:${source.id}:${day}`);
    enqueued += 1;
  }

  if (enqueued > 0) {
    dependencies.logger.info({ enqueued, event: "pipeline.recheck_sweep_enqueued" });
  }
  return { enqueued };
}
