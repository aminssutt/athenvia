#!/usr/bin/env node
/**
 * Data-quality report for the Athenvia catalogue (ticket P4-28).
 *
 * Reads ONLY catalogue tables (universities, university_aliases, programs,
 * program_summaries, sources, intakes, application_windows, domains) and prints
 * a markdown report on stdout. It never touches user tables (users, sessions,
 * accounts, watchlists, notification_*, push_*) and never selects internal
 * confidence scores.
 *
 * Usage:
 *   node scripts/data-quality-report.mjs > docs/data/data-quality-report.md
 *
 * Connection: uses DATABASE_URL from the environment. Like scripts/with-env.mjs,
 * it loads the repo-root .env when present and derives DATABASE_URL from
 * POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / POSTGRES_PORT if needed.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const requiredDatabaseParts = ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"];
if (!process.env.DATABASE_URL && requiredDatabaseParts.every((name) => process.env[name])) {
  const databaseName = encodeURIComponent(process.env.POSTGRES_DB);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const port = encodeURIComponent(process.env.POSTGRES_PORT ?? "5432");
  const user = encodeURIComponent(process.env.POSTGRES_USER);
  process.env.DATABASE_URL = `postgresql://${user}:${password}@localhost:${port}/${databaseName}`;
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Export it (or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB in .env) and retry.",
  );
  process.exit(2);
}

const databaseRequire = createRequire(path.join(repoRoot, "packages", "database", "package.json"));
const { PrismaClient } = databaseRequire("@prisma/client");
const prisma = new PrismaClient();

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

function percent(part, total) {
  if (total === 0) {
    return "n/a";
  }
  return `${Math.round((part / total) * 100)}%`;
}

function ratio(part, total) {
  return `${part}/${total} (${percent(part, total)})`;
}

/** Render a markdown table the same way Prettier formats one (padded columns). */
function table(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(3, header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const line = (cells) =>
    `| ${cells.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [line(headers), separator, ...rows.map(line)].join("\n");
}

function sortByCount(entries) {
  return [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const universities = await prisma.university.findMany({
  orderBy: [{ name: "asc" }],
  select: {
    id: true,
    name: true,
    countryCode: true,
    status: true,
    logoAssetId: true,
    _count: { select: { aliases: true, sources: true } },
  },
});

const programs = await prisma.program.findMany({
  orderBy: [{ university: { name: "asc" } }, { name: "asc" }],
  select: {
    id: true,
    name: true,
    status: true,
    university: { select: { name: true } },
    summary: { select: { programId: true } },
    sources: { select: { sourceType: true, isOfficial: true, lastCheckedAt: true } },
    domains: { select: { domainId: true } },
    intakes: {
      select: {
        status: true,
        year: true,
        month: true,
        applicationWindows: { select: { publicStatus: true } },
      },
    },
  },
});

const [domainCount, aliasCount, sourceCount, intakeCount, windowCount, summaryCount] =
  await Promise.all([
    prisma.domain.count(),
    prisma.universityAlias.count(),
    prisma.source.count(),
    prisma.intake.count(),
    prisma.applicationWindow.count(),
    prisma.programSummary.count(),
  ]);

const allSources = await prisma.source.findMany({
  select: { sourceType: true, isOfficial: true, lastCheckedAt: true, universityId: true },
});

const windowStatusCounts = await prisma.applicationWindow.groupBy({
  by: ["publicStatus"],
  _count: { _all: true },
});

const intakeStatusCounts = await prisma.intake.groupBy({
  by: ["status"],
  _count: { _all: true },
});

await prisma.$disconnect();

const programLabel = (program) => `${program.university.name} — ${program.name}`;

// Derived coverage sets.
const programsWithoutSummary = programs.filter((program) => program.summary === null);
const programsWithoutSources = programs.filter((program) => program.sources.length === 0);
const programsWithoutOfficialSource = programs.filter(
  (program) => !program.sources.some((source) => source.isOfficial),
);
const programsWithoutIntakes = programs.filter((program) => program.intakes.length === 0);
const programsWithoutWindows = programs.filter(
  (program) =>
    program.intakes.length === 0 ||
    program.intakes.every((intake) => intake.applicationWindows.length === 0),
);
const programsAllNotPublished = programs.filter((program) => {
  const windows = program.intakes.flatMap((intake) => intake.applicationWindows);
  return windows.length > 0 && windows.every((window) => window.publicStatus === "NOT_PUBLISHED");
});
const programsWithConfirmedWindow = programs.filter((program) =>
  program.intakes.some((intake) =>
    intake.applicationWindows.some((window) => window.publicStatus === "CONFIRMED"),
  ),
);
const programsWithoutDomains = programs.filter((program) => program.domains.length === 0);

const universitiesWithLogo = universities.filter((university) => university.logoAssetId !== null);
const universitiesWithoutLogo = universities.filter(
  (university) => university.logoAssetId === null,
);
const universitiesWithoutAliases = universities.filter(
  (university) => university._count.aliases === 0,
);
const universitiesWithDirectSource = universities.filter(
  (university) => university._count.sources > 0,
);

const sourceTypeCounts = new Map();
for (const source of allSources) {
  sourceTypeCounts.set(source.sourceType, (sourceTypeCounts.get(source.sourceType) ?? 0) + 1);
}
const officialSourceCount = allSources.filter((source) => source.isOfficial).length;

const sourceTypeProgramCoverage = new Map();
for (const program of programs) {
  for (const type of new Set(program.sources.map((source) => source.sourceType))) {
    sourceTypeProgramCoverage.set(type, (sourceTypeProgramCoverage.get(type) ?? 0) + 1);
  }
}

const freshness = { under7: 0, under30: 0, older: 0, never: 0 };
for (const source of allSources) {
  if (!source.lastCheckedAt) {
    freshness.never += 1;
    continue;
  }
  const ageDays = (now.getTime() - source.lastCheckedAt.getTime()) / DAY_MS;
  if (ageDays < 7) {
    freshness.under7 += 1;
  } else if (ageDays < 30) {
    freshness.under30 += 1;
  } else {
    freshness.older += 1;
  }
}

const statusCount = (records) => {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  }
  return counts;
};
const universityStatusCounts = statusCount(universities);
const programStatusCounts = statusCount(programs);

const windowStatuses = ["CONFIRMED", "EXPECTED", "NOT_PUBLISHED"];
const windowCounts = Object.fromEntries(windowStatuses.map((status) => [status, 0]));
for (const row of windowStatusCounts) {
  windowCounts[row.publicStatus] = row._count._all;
}

const intakeStatuses = ["PLANNED", "OPEN", "CLOSED", "COMPLETED", "UNKNOWN"];
const intakeCounts = Object.fromEntries(intakeStatuses.map((status) => [status, 0]));
for (const row of intakeStatusCounts) {
  intakeCounts[row.status] = row._count._all;
}

const listOrNone = (items, formatter) =>
  items.length === 0 ? "None." : items.map((item) => `- ${formatter(item)}`).join("\n");

const sections = [];

sections.push(`# Athenvia data-quality report

- Generated: ${now.toISOString()} (UTC)
- Scope: catalogue tables only (universities, aliases, programs, summaries, sources, intakes, application windows, domains)
- Regenerate: \`node scripts/data-quality-report.mjs > docs/data/data-quality-report.md\` (requires \`DATABASE_URL\` or \`POSTGRES_*\` variables in \`.env\`)

> Privacy note: this report contains no user data of any kind (no users, sessions, accounts,
> watchlists, notification or push records are read) and exposes no internal confidence scores.`);

sections.push(`## Catalogue overview

${table(
  ["Entity", "Count"],
  [
    ["Universities", universities.length],
    ["University aliases", aliasCount],
    ["Programs", programs.length],
    ["Program summaries", summaryCount],
    ["Sources", sourceCount],
    ["Intakes", intakeCount],
    ["Application windows", windowCount],
    ["Domains", domainCount],
  ],
)}

Entity status (catalogue visibility):

${table(
  ["Entity", "Status", "Count"],
  [
    ...sortByCount([...universityStatusCounts]).map(([status, count]) => [
      "University",
      status,
      count,
    ]),
    ...sortByCount([...programStatusCounts]).map(([status, count]) => ["Program", status, count]),
  ],
)}`);

sections.push(`## Coverage gaps

### Program summaries

- Programs with a summary: ${ratio(programs.length - programsWithoutSummary.length, programs.length)}
- Programs without a summary (hidden in the app by design): ${ratio(programsWithoutSummary.length, programs.length)}

${listOrNone(programsWithoutSummary, programLabel)}

### Sources

- Total sources: ${sourceCount} (official: ${ratio(officialSourceCount, sourceCount)})
- Programs with at least one source: ${ratio(programs.length - programsWithoutSources.length, programs.length)}
- Programs with at least one official source: ${ratio(programs.length - programsWithoutOfficialSource.length, programs.length)}
- Universities with a directly attached (university-level) source: ${ratio(universitiesWithDirectSource.length, universities.length)}

Sources by type:

${table(
  ["Source type", "Sources", "Programs covered"],
  sortByCount([...sourceTypeCounts]).map(([type, count]) => [
    type,
    count,
    ratio(sourceTypeProgramCoverage.get(type) ?? 0, programs.length),
  ]),
)}

Programs without any source:

${listOrNone(programsWithoutSources, programLabel)}

### Application windows

${table(
  ["Public status", "Windows"],
  windowStatuses.map((status) => [status, ratio(windowCounts[status], windowCount)]),
)}

- Programs with at least one CONFIRMED window: ${ratio(programsWithConfirmedWindow.length, programs.length)}
- Programs with no application window at all: ${ratio(programsWithoutWindows.length, programs.length)}
- Programs whose windows are all NOT_PUBLISHED: ${ratio(programsAllNotPublished.length, programs.length)}

Programs with no application window:

${listOrNone(programsWithoutWindows, programLabel)}

Programs whose windows are all NOT_PUBLISHED:

${listOrNone(programsAllNotPublished, programLabel)}

### University logos

- Universities with a logo (\`logo_asset_id\` set): ${ratio(universitiesWithLogo.length, universities.length)}
- Universities without a logo (ticket #87 pending): ${ratio(universitiesWithoutLogo.length, universities.length)}

${listOrNone(universitiesWithoutLogo, (university) => `${university.name} (${university.countryCode})`)}

### University aliases

- Universities with at least one alias: ${ratio(universities.length - universitiesWithoutAliases.length, universities.length)}

Universities without any alias (weaker search/duplicate detection):

${listOrNone(universitiesWithoutAliases, (university) => `${university.name} (${university.countryCode})`)}

### Intakes

${table(
  ["Intake status", "Intakes"],
  intakeStatuses.map((status) => [status, ratio(intakeCounts[status], intakeCount)]),
)}

Programs without any intake:

${listOrNone(programsWithoutIntakes, programLabel)}

### Domains

- Programs with at least one domain: ${ratio(programs.length - programsWithoutDomains.length, programs.length)}

${listOrNone(programsWithoutDomains, programLabel)}

### Source freshness (\`last_checked_at\`)

${table(
  ["Age bucket", "Sources"],
  [
    ["Checked < 7 days ago", ratio(freshness.under7, sourceCount)],
    ["Checked 7–30 days ago", ratio(freshness.under30, sourceCount)],
    ["Checked > 30 days ago", ratio(freshness.older, sourceCount)],
    ["Never checked (null)", ratio(freshness.never, sourceCount)],
  ],
)}`);

const blocking = [];
if (programsWithoutSummary.length > 0) {
  blocking.push(
    `**Programs without a summary (${programsWithoutSummary.length})** — invisible in the app by design:\n\n${listOrNone(programsWithoutSummary, programLabel)}`,
  );
}
if (programsWithoutSources.length > 0) {
  blocking.push(
    `**Programs without any source (${programsWithoutSources.length})** — no verifiable origin for their data:\n\n${listOrNone(programsWithoutSources, programLabel)}`,
  );
}
if (programsWithoutWindows.length > 0) {
  blocking.push(
    `**Programs without any application window (${programsWithoutWindows.length})** — nothing to track or notify on:\n\n${listOrNone(programsWithoutWindows, programLabel)}`,
  );
}
if (universitiesWithoutLogo.length > 0) {
  blocking.push(
    `**Universities without a logo (${universitiesWithoutLogo.length}/${universities.length})** — blocking only if the launch UI requires logos; ticket #87 (logo ingestion) has not been done yet, so 0 logos is expected. See the list under "University logos" above.`,
  );
}
if (programsAllNotPublished.length > 0) {
  blocking.push(
    `**Programs whose windows are all NOT_PUBLISHED (${programsAllNotPublished.length}/${programs.length})** — dates exist but none is publishable; flagship programs in this state will show no actionable deadline at launch. See the list under "Application windows" above.`,
  );
}
if (blocking.length === 0) {
  blocking.push("No launch-blocking records detected.");
}

sections.push(`## Launch-blocking records

${blocking.join("\n\n")}`);

sections.push(`## Notes

- No user data is included in this report: only catalogue tables are read, and no personally
  identifiable information exists in those tables.
- Internal confidence scores (\`application_windows.confidence_score\`,
  \`data_revisions.confidence_score\`) are intentionally NOT selected nor exposed, per the
  product decision to keep confidence scoring internal.`);

console.log(sections.join("\n\n"));
