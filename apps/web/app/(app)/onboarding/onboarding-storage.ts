export const ONBOARDING_STORAGE_KEY = "athenvia:onboarding:v1";

export const targetIntakeOptions = [
  { label: "Spring 2027", value: "spring-2027" },
  { label: "Fall 2027", value: "fall-2027" },
  { label: "Spring 2028", value: "spring-2028" },
  { label: "Fall 2028", value: "fall-2028" },
  { label: "2029 or later", value: "2029-or-later" },
] as const;

export type TargetIntake = (typeof targetIntakeOptions)[number]["value"];

export type StoredOnboarding = {
  completed: true;
  targetIntake: TargetIntake | null;
  version: 1;
};

export function isTargetIntake(value: string): value is TargetIntake {
  return targetIntakeOptions.some((option) => option.value === value);
}

export function isStoredOnboarding(value: unknown): value is StoredOnboarding {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredOnboarding>;

  return (
    candidate.version === 1 &&
    candidate.completed === true &&
    (candidate.targetIntake === null ||
      (typeof candidate.targetIntake === "string" && isTargetIntake(candidate.targetIntake)))
  );
}

export function readStoredOnboarding(storage: Storage): StoredOnboarding | null {
  const serialized = storage.getItem(ONBOARDING_STORAGE_KEY);

  if (!serialized) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    return isStoredOnboarding(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredOnboarding(storage: Storage, targetIntake: TargetIntake | null): void {
  const onboarding: StoredOnboarding = {
    completed: true,
    targetIntake,
    version: 1,
  };

  storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(onboarding));
}
