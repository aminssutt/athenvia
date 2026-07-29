import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { athenviaPrisma?: PrismaClient };

export const database =
  globalForPrisma.athenviaPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.athenviaPrisma = database;
}
