import { ProgramSummarySchema } from "@athenvia/contracts";
import { mockProgram } from "@athenvia/contracts/mocks";

import type { ProgramSummary } from "@athenvia/contracts";

export type ProgramLoader = (programId: string) => Promise<unknown>;

const loadMockProgram: ProgramLoader = async (programId) =>
  programId === mockProgram.id ? mockProgram : null;

/**
 * Keeps the page independent from its transport while enforcing the shared
 * public contract at the route boundary.
 */
export async function loadProgram(
  programId: string,
  loader: ProgramLoader = loadMockProgram,
): Promise<ProgramSummary | null> {
  const payload = await loader(programId);

  if (payload === null) {
    return null;
  }

  return ProgramSummarySchema.parse(payload);
}

export function getMockProgramId(): string {
  return mockProgram.id;
}
