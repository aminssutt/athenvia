import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { database } from "./client";
import { countSeedFiles, importSeedFiles } from "./seed-import";
import { readSeedFile } from "./seed-format";

type SeedCommand = {
  dryRun: boolean;
  files: URL[];
};

const seedDirectory = new URL("../../../data/seed/", import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function defaultSeedFiles(): Promise<URL[]> {
  const entries = await readdir(seedDirectory);
  const productionFiles = entries
    .filter((entry) => /^p4-\d{2}\.json$/u.test(entry))
    .sort((left, right) => left.localeCompare(right, "en"));
  const selected = productionFiles.length > 0 ? productionFiles : ["sample.json"];
  return selected.map((entry) => new URL(entry, seedDirectory));
}

async function parseCommand(arguments_: readonly string[]): Promise<SeedCommand> {
  const dryRun = arguments_.includes("--dry-run");
  const unknownOptions = arguments_.filter(
    (argument) => argument.startsWith("-") && argument !== "--dry-run" && argument !== "--",
  );
  if (unknownOptions.length > 0) {
    throw new TypeError(`Unknown seed option: ${unknownOptions.join(", ")}`);
  }
  const paths = arguments_.filter((argument) => !argument.startsWith("-") && argument !== "--");
  return {
    dryRun,
    files:
      paths.length > 0
        ? paths.map((path) => pathToFileURL(resolve(repositoryRoot, path)))
        : await defaultSeedFiles(),
  };
}

const command = await parseCommand(process.argv.slice(2));

try {
  const seeds = await Promise.all(command.files.map(async (file) => readSeedFile(file)));
  const counts = command.dryRun ? countSeedFiles(seeds) : await importSeedFiles(database, seeds);
  const fileNames = command.files.map((file) => fileURLToPath(file));
  console.log(
    JSON.stringify(
      {
        mode: command.dryRun ? "dry-run" : "import",
        files: fileNames,
        records: counts,
        summaryPersistence: "deferred-to-issue-148",
      },
      null,
      2,
    ),
  );
} finally {
  await database.$disconnect();
}
