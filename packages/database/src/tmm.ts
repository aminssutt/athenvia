import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { database } from "./client";
import {
  importTmmRecords,
  mapTmmRecord,
  planTmmImport,
  repairTmmUniversityDuplicates,
  type TmmRecord,
} from "./tmm-import";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cacheDirectory = join(repositoryRoot, "data", "tmm-cache");
const EXPORT_URL =
  "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-tmm-donnees-du-portail-dinformation-trouver-mon-master-parcours-de-format/exports/json";

type TmmCommand = {
  dryRun: boolean;
  file: string | null;
  limit: number | null;
};

function parseCommand(arguments_: readonly string[]): TmmCommand {
  const command: TmmCommand = { dryRun: false, file: null, limit: null };
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
    } else if (argument.startsWith("-")) {
      throw new TypeError(`Unknown TMM import option: ${argument}`);
    } else if (command.file) {
      throw new TypeError("Only one dump file can be imported at a time.");
    } else {
      command.file = resolve(repositoryRoot, argument);
    }
  }
  return command;
}

async function downloadDump(): Promise<string> {
  mkdirSync(cacheDirectory, { recursive: true });
  const target = join(cacheDirectory, "tmm-parcours.json");
  if (existsSync(target)) {
    console.error(`Using cached dump ${target}`);
    return target;
  }
  console.error("Downloading the TMM parcours export ...");
  const response = await fetch(EXPORT_URL);
  if (!response.ok) {
    throw new Error(`TMM export download failed with HTTP ${response.status}.`);
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

const command = parseCommand(process.argv.slice(2));

try {
  const dumpPath = command.file ?? (await downloadDump());
  console.error(`Reading ${dumpPath} ...`);
  let records = JSON.parse(readFileSync(dumpPath, "utf8")) as TmmRecord[];
  if (!Array.isArray(records)) {
    throw new TypeError("The TMM export must be a JSON array of records.");
  }

  // Only the most recent campaign in the dataset: older years re-list the
  // same parcours and would only multiply natural-key duplicates.
  const latestYear = records.reduce<string | null>(
    (latest, record) =>
      record.annee && (!latest || record.annee > latest) ? record.annee : latest,
    null,
  );
  records = records.filter((record) => record.annee === latestYear);
  if (command.limit !== null) {
    records = records.slice(0, command.limit);
  }

  // The next September cycle: TMM programmes land with a planned intake and
  // no published dates, never with the dataset's historical ones.
  const intakeYear = new Date().getUTCFullYear() + 1;

  if (command.dryRun) {
    const candidates = records.flatMap((record) => {
      const candidate = mapTmmRecord(record);
      return candidate ? [candidate] : [];
    });
    const plan = planTmmImport(candidates, [], new Map());
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          file: dumpPath,
          campaign: latestYear,
          intakeYear,
          records: {
            scanned: records.length,
            eligible: candidates.length,
            universities: plan.newUniversities.length,
            programs: plan.programs.length,
            skippedDuplicates: plan.skippedDuplicates,
          },
        },
        null,
        2,
      ),
    );
  } else {
    const repaired = await repairTmmUniversityDuplicates(database);
    const counts = await importTmmRecords(database, records, { intakeYear });
    console.log(
      JSON.stringify(
        {
          mode: "import",
          file: dumpPath,
          campaign: latestYear,
          intakeYear,
          repaired,
          records: counts,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await database.$disconnect();
}
