import { ProgramDetailSchema } from "@athenvia/contracts";

import type { ProgramDetail } from "@athenvia/contracts";

import { findPublicProgramDetail } from "../../../../lib/program-details";

export type ProgramLoader = (programId: string) => Promise<unknown>;
export type IntakeOption = ProgramDetail["intakes"][number];

/**
 * Keeps the page independent from Prisma while enforcing the shared public
 * detail contract at the server-component boundary.
 */
export async function loadProgram(
  programId: string,
  loader: ProgramLoader = findPublicProgramDetail,
): Promise<ProgramDetail | null> {
  const payload = await loader(programId);

  if (payload === null) {
    return null;
  }

  return ProgramDetailSchema.parse(payload);
}
