import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

import type { ImmutableSnapshotObject, ImmutableSnapshotStore } from "../source-snapshots";

/**
 * Content-addressed snapshot storage on the worker's local disk. Objects are
 * written once with an exclusive create, so a concurrent or retried write of
 * the same immutable object reports `created: false` instead of overwriting.
 */
export class FilesystemSnapshotStore implements ImmutableSnapshotStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  private objectPath(key: string): string {
    const fullPath = normalize(join(this.rootDirectory, key));
    if (fullPath !== this.rootDirectory && !fullPath.startsWith(this.rootDirectory + sep)) {
      throw new TypeError("Snapshot storage keys must stay inside the storage root.");
    }
    return fullPath;
  }

  async putIfAbsent(object: ImmutableSnapshotObject): Promise<{ created: boolean }> {
    const fullPath = this.objectPath(object.key);
    await mkdir(dirname(fullPath), { recursive: true });
    let handle;
    try {
      handle = await open(fullPath, "wx");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        return { created: false };
      }
      throw error;
    }
    try {
      await handle.writeFile(object.body);
    } finally {
      await handle.close();
    }
    return { created: true };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.objectPath(key));
  }
}
