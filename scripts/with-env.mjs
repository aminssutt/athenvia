import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const requiredDatabaseParts = ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"];
if (!process.env.DATABASE_URL && requiredDatabaseParts.every((name) => process.env[name])) {
  const databaseName = encodeURIComponent(process.env.POSTGRES_DB);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const port = encodeURIComponent(process.env.POSTGRES_PORT ?? "5432");
  const user = encodeURIComponent(process.env.POSTGRES_USER);
  process.env.DATABASE_URL = `postgresql://${user}:${password}@localhost:${port}/${databaseName}`;
}

if (!process.env.REDIS_URL && process.env.REDIS_PASSWORD) {
  const password = encodeURIComponent(process.env.REDIS_PASSWORD);
  const port = encodeURIComponent(process.env.REDIS_PORT ?? "6379");
  process.env.REDIS_URL = `redis://:${password}@localhost:${port}`;
}

const arguments_ = process.argv.slice(2);
if (arguments_.length === 0) {
  console.error("Usage: node scripts/with-env.mjs <pnpm arguments>");
  process.exit(2);
}

const packageManagerEntry = process.env.npm_execpath;
if (!packageManagerEntry) {
  console.error("Run this command through the package manager, for example: corepack pnpm dev");
  process.exit(2);
}

const child = spawn(process.execPath, [packageManagerEntry, ...arguments_], {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
