import { ProgramSummarySchema } from "@athenvia/contracts";
import { mockProgram } from "@athenvia/contracts/mocks";
import { z } from "zod";

import type { ProgramSummary } from "@athenvia/contracts";

export type ProgramLoader = (programId: string) => Promise<unknown>;

const loadMockProgram: ProgramLoader = async (programId) =>
  programId === mockProgram.id ? mockProgram : null;

const IntakeOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1),
});

export type IntakeOption = z.infer<typeof IntakeOptionSchema>;
export type IntakeLoader = (programId: string) => Promise<unknown>;

const mockIntakes: IntakeOption[] = [
  {
    id: "6a3828b7-4852-4f29-90cd-99b74348f652",
    label: mockProgram.intakeLabel,
  },
];

const loadMockIntakes: IntakeLoader = async (programId) =>
  programId === mockProgram.id ? mockIntakes : [];

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

/**
 * Intake identifiers are deliberately loaded by the detail route rather than
 * inferred from an application-window ID. The Follow API requires the real
 * intake selected by the student.
 */
export async function loadProgramIntakes(
  programId: string,
  loader: IntakeLoader = loadMockIntakes,
): Promise<IntakeOption[]> {
  return z.array(IntakeOptionSchema).parse(await loader(programId));
}
