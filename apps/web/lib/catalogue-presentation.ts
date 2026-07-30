import type { ApplicationWindow } from "@athenvia/contracts";

type PublicWindowInput = {
  closesAt: Date | null;
  id: string;
  opensAt: Date | null;
  publicStatus: ApplicationWindow["publicStatus"];
  roundName: string | null;
  source: {
    isOfficial: boolean;
    programId: string | null;
    url: string;
  } | null;
};

export function safeOfficialUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function formatIntakeLabel(year: number, month: number | null): string {
  if (!month || month < 1 || month > 12) {
    return String(year);
  }

  const monthName = new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, 1)));

  return `${monthName} ${year}`;
}

export function toPublicApplicationWindow(
  window: PublicWindowInput | undefined,
  programId: string,
): ApplicationWindow | null {
  if (!window) {
    return null;
  }

  const officialSourceUrl =
    window.source?.isOfficial && window.source.programId === programId
      ? safeOfficialUrl(window.source.url)
      : null;

  return {
    closesAt: window.closesAt?.toISOString() ?? null,
    id: window.id,
    officialSourceUrl,
    opensAt: window.opensAt?.toISOString() ?? null,
    publicStatus: window.publicStatus,
    roundName: window.roundName,
  };
}

export function nextUsefulDate(
  windows: readonly Pick<PublicWindowInput, "closesAt" | "opensAt">[],
  now: Date = new Date(),
): string | null {
  const nowValue = now.getTime();
  const nextTimestamp = windows
    .flatMap(({ closesAt, opensAt }) => [opensAt, closesAt])
    .filter((value): value is Date => value instanceof Date && value.getTime() >= nowValue)
    .map((value) => value.getTime())
    .sort((left, right) => left - right)[0];

  return nextTimestamp === undefined ? null : new Date(nextTimestamp).toISOString();
}
