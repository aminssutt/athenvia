import type { Logger } from "pino";

import type { RecordSourceSnapshotInput, RecordSourceSnapshotResult } from "@athenvia/database";

import type { OfficialSourceFetchResult } from "../fetch";
import { canonicalSourceContentHash, storeSourceSnapshot } from "../source-snapshots";

import type { ImmutableSnapshotStore } from "../source-snapshots";

export type FetchableSource = {
  id: string;
  url: string;
  isOfficial: boolean;
  contentHash: string | null;
  /** Official domain of the owning university, when one is linked. */
  universityOfficialDomain: string | null;
};

export type FetchProcessorDependencies = {
  loadSource: (sourceId: string) => Promise<FetchableSource | null>;
  fetchOfficialSource: (
    url: string,
    approvedHosts: readonly string[],
  ) => Promise<OfficialSourceFetchResult>;
  objectStore: ImmutableSnapshotStore;
  /** Records the check instant and observed HTTP status on the source row. */
  recordSourceCheck: (
    sourceId: string,
    checkedAt: Date,
    httpStatus: number | null,
  ) => Promise<void>;
  enqueueParse: (sourceSnapshotId: string) => Promise<void>;
  /** Test seam for the snapshot metadata write; production uses the default. */
  persistSnapshot?: (input: RecordSourceSnapshotInput) => Promise<RecordSourceSnapshotResult>;
  logger: Logger;
  now?: () => Date;
};

export type FetchProcessorResult = {
  outcome: "FETCHED" | "SKIPPED" | "UNCHANGED";
  sourceSnapshotId: string | null;
};

/**
 * Approved hosts for one source: its own URL host plus the university's
 * official domain (with and without `www.`). Anything else — including
 * redirects out of this set — is refused by the fetcher.
 */
export function approvedHostsForSource(source: FetchableSource): string[] {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(source.url).hostname.toLowerCase());
  } catch {
    // An unparsable stored URL yields no host and the fetch fails loudly below.
  }
  if (source.universityOfficialDomain) {
    const domain = source.universityOfficialDomain.toLowerCase();
    hosts.add(domain);
    hosts.add(`www.${domain}`);
  }
  return [...hosts];
}

/**
 * Fetches one official source, records the immutable snapshot and hands newly
 * seen content to the parse stage. Unchanged content refreshes the check
 * timestamp without producing a snapshot or any downstream work.
 */
export async function processFetchJob(
  sourceId: string,
  dependencies: FetchProcessorDependencies,
): Promise<FetchProcessorResult> {
  const now = dependencies.now ?? (() => new Date());
  const source = await dependencies.loadSource(sourceId);
  if (!source) {
    dependencies.logger.warn({ event: "pipeline.fetch_source_missing", sourceId });
    return { outcome: "SKIPPED", sourceSnapshotId: null };
  }
  if (!source.isOfficial) {
    dependencies.logger.info({ event: "pipeline.fetch_source_not_official", sourceId });
    return { outcome: "SKIPPED", sourceSnapshotId: null };
  }

  const approvedHosts = approvedHostsForSource(source);
  let fetched: OfficialSourceFetchResult;
  try {
    fetched = await dependencies.fetchOfficialSource(source.url, approvedHosts);
  } catch (error) {
    await dependencies.recordSourceCheck(sourceId, now(), null);
    throw error;
  }
  await dependencies.recordSourceCheck(sourceId, now(), fetched.status);

  if (fetched.status < 200 || fetched.status >= 300) {
    dependencies.logger.warn({
      event: "pipeline.fetch_source_http_error",
      httpStatus: fetched.status,
      sourceId,
    });
    return { outcome: "SKIPPED", sourceSnapshotId: null };
  }

  const contentHash = canonicalSourceContentHash(fetched.body);
  const unchanged = source.contentHash === contentHash;

  const stored = await storeSourceSnapshot(
    {
      body: fetched.body,
      capturedAt: now(),
      contentType: fetched.contentType,
      sourceId,
    },
    { objectStore: dependencies.objectStore, persistSnapshot: dependencies.persistSnapshot },
  );

  if (unchanged && !stored.created) {
    dependencies.logger.info({ event: "pipeline.fetch_source_unchanged", sourceId });
    return { outcome: "UNCHANGED", sourceSnapshotId: stored.snapshot.id };
  }

  await dependencies.enqueueParse(stored.snapshot.id);
  dependencies.logger.info({
    event: "pipeline.fetch_snapshot_recorded",
    newSnapshot: stored.created,
    sourceId,
    sourceSnapshotId: stored.snapshot.id,
  });
  return { outcome: "FETCHED", sourceSnapshotId: stored.snapshot.id };
}
