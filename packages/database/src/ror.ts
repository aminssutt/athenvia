import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { database } from "./client";
import { importRorRecords, mapRorRecord, planRorImport, type RorRecord } from "./ror-import";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cacheDirectory = join(repositoryRoot, "data", "ror-cache");
const ZENODO_LATEST_URL =
  "https://zenodo.org/api/records?communities=ror-data&sort=mostrecent&size=1";

type RorCommand = {
  countries: readonly string[] | null;
  dryRun: boolean;
  file: string | null;
  limit: number | null;
};

function parseCommand(arguments_: readonly string[]): RorCommand {
  const command: RorCommand = { countries: null, dryRun: false, file: null, limit: null };
  const queue = [...arguments_];
  while (queue.length > 0) {
    const argument = queue.shift()!;
    if (argument === "--" || argument.length === 0) {
      continue;
    }
    if (argument === "--dry-run") {
      command.dryRun = true;
    } else if (argument === "--limit") {
      const value = Number(queue.shift());
      if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError("--limit requires a positive integer.");
      }
      command.limit = value;
    } else if (argument === "--countries") {
      const value = queue.shift();
      if (!value) {
        throw new TypeError("--countries requires a comma-separated list of ISO codes.");
      }
      command.countries = value.split(",").map((code) => code.trim().toUpperCase());
    } else if (argument.startsWith("-")) {
      throw new TypeError(`Unknown ROR import option: ${argument}`);
    } else if (command.file) {
      throw new TypeError("Only one dump file can be imported at a time.");
    } else {
      command.file = resolve(repositoryRoot, argument);
    }
  }
  return command;
}

function extractZip(zipPath: string, destination: string): void {
  const tarBinary =
    process.platform === "win32" ? join("C:", "Windows", "System32", "tar.exe") : "tar";
  try {
    execFileSync(tarBinary, ["-xf", zipPath, "-C", destination], { stdio: "pipe" });
    return;
  } catch {
    // GNU tar cannot read zip archives; fall back to unzip.
  }
  execFileSync("unzip", ["-o", zipPath, "-d", destination], { stdio: "pipe" });
}

function findDumpJson(directory: string): string | null {
  const entries = readdirSync(directory)
    .filter((entry) => /ror-data\.json$/u.test(entry))
    .sort((left, right) => right.localeCompare(left, "en"));
  return entries.length > 0 ? join(directory, entries[0]!) : null;
}

async function downloadLatestDump(): Promise<string> {
  mkdirSync(cacheDirectory, { recursive: true });

  const listing = (await (await fetch(ZENODO_LATEST_URL)).json()) as {
    hits: { hits: { files?: { key: string; links: { self: string } }[] }[] };
  };
  const files = listing.hits.hits[0]?.files ?? [];
  const archive = files.find((file) => file.key.endsWith("-ror-data.zip"));
  if (!archive) {
    throw new Error("Could not find a ROR data dump archive in the latest Zenodo record.");
  }

  const extracted = join(cacheDirectory, archive.key.replace(/\.zip$/u, ".json"));
  const cached = findDumpJson(cacheDirectory);
  if (cached === extracted) {
    console.error(`Using cached dump ${extracted}`);
    return extracted;
  }

  console.error(`Downloading ${archive.key} ...`);
  const response = await fetch(archive.links.self);
  if (!response.ok) {
    throw new Error(`Dump download failed with HTTP ${response.status}.`);
  }
  const zipPath = join(cacheDirectory, archive.key);
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  extractZip(zipPath, cacheDirectory);

  const dump = findDumpJson(cacheDirectory);
  if (!dump) {
    throw new Error("The downloaded archive did not contain a ror-data.json file.");
  }
  return dump;
}

function dumpCheckedAt(dumpPath: string): Date {
  const match = /(\d{4}-\d{2}-\d{2})-ror-data\.json$/u.exec(dumpPath);
  return match ? new Date(`${match[1]}T00:00:00.000Z`) : new Date();
}

const command = parseCommand(process.argv.slice(2));

try {
  const dumpPath = command.file ?? (await downloadLatestDump());
  console.error(`Reading ${dumpPath} ...`);
  let records = JSON.parse(readFileSync(dumpPath, "utf8")) as RorRecord[];
  if (!Array.isArray(records)) {
    throw new TypeError("The ROR dump must be a JSON array of records.");
  }
  if (command.countries) {
    const wanted = new Set(command.countries);
    records = records.filter((record) =>
      wanted.has(record.locations?.[0]?.geonames_details?.country_code?.trim().toUpperCase() ?? ""),
    );
  }
  if (command.limit !== null) {
    records = records.slice(0, command.limit);
  }

  if (command.dryRun) {
    const candidates = records.flatMap((record) => {
      const candidate = mapRorRecord(record);
      return candidate ? [candidate] : [];
    });
    const plan = planRorImport(candidates, []);
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          file: dumpPath,
          records: {
            scanned: records.length,
            eligible: candidates.length,
            universities: plan.creates.length,
            aliases: plan.aliases.length,
            skippedDuplicates: plan.skippedDuplicates,
          },
        },
        null,
        2,
      ),
    );
  } else {
    const counts = await importRorRecords(database, records, {
      checkedAt: dumpCheckedAt(dumpPath),
    });
    console.log(JSON.stringify({ mode: "import", file: dumpPath, records: counts }, null, 2));
  }
} finally {
  await database.$disconnect();
}
