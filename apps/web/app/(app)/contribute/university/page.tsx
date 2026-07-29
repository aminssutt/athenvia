import type { Metadata } from "next";

import { MissingUniversityForm } from "./missing-university-form";

export const metadata: Metadata = {
  title: "Add a missing university",
  description: "Suggest a university for Athenvia to review.",
};

type MissingUniversityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstQueryValue(value: string | string[] | undefined): string {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return firstValue?.trim().slice(0, 120) ?? "";
}

export default async function MissingUniversityPage({ searchParams }: MissingUniversityPageProps) {
  const resolvedSearchParams = await searchParams;
  const prefilledName =
    firstQueryValue(resolvedSearchParams.name) || firstQueryValue(resolvedSearchParams.query);

  return <MissingUniversityForm prefilledName={prefilledName} />;
}
