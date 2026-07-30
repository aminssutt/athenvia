import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";

import { MissingProgramForm } from "./missing-program-form";
import styles from "./missing-program.module.css";
import { UniversityContextSchema } from "./submission";

export const metadata: Metadata = {
  title: "Add a missing program",
  description: "Suggest a university program for Athenvia to review.",
};

type MissingProgramPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstQueryValue(value: string | string[] | undefined): string {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return firstValue?.trim() ?? "";
}

export default async function MissingProgramPage({ searchParams }: MissingProgramPageProps) {
  const resolvedSearchParams = await searchParams;
  const parsedUniversity = UniversityContextSchema.safeParse({
    universityId: firstQueryValue(resolvedSearchParams.universityId),
    universityName: firstQueryValue(resolvedSearchParams.universityName),
  });

  if (!parsedUniversity.success) {
    return (
      <div className={styles.appFrame}>
        <main className={styles.main}>
          <header className={styles.siteHeader}>
            <Brand />
          </header>
          <section className={styles.missingContext} aria-labelledby="missing-university-title">
            <span aria-hidden="true">?</span>
            <h1 id="missing-university-title">Choose a university first</h1>
            <p>Start from search and select the university that should contain this program.</p>
            <Link href="/search">Return to search</Link>
          </section>
        </main>
        <MobileNavigation />
      </div>
    );
  }

  return <MissingProgramForm university={parsedUniversity.data} />;
}
