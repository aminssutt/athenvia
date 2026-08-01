import type { UniversitySearchResult } from "@athenvia/contracts";
import Link from "next/link";

import styles from "./product-components.module.css";
import { UniversityLogo } from "./university-logo";

type UniversityCardProps = {
  university: UniversitySearchResult;
};

const regionNames = new Intl.DisplayNames("en", { type: "region" });

function formatLocation(university: UniversitySearchResult): string {
  let countryName: string | undefined;
  try {
    countryName = regionNames.of(university.countryCode);
  } catch {
    countryName = undefined;
  }
  const country = countryName ?? university.countryCode;
  return university.city ? `${university.city}, ${country}` : country;
}

export function UniversityCard({ university }: UniversityCardProps) {
  const suggestionLink = `/contribute/program?universityId=${encodeURIComponent(
    university.id,
  )}&universityName=${encodeURIComponent(university.name)}`;

  return (
    <article className={styles.universityCard}>
      <div className={styles.programCardHeading}>
        <UniversityLogo logoUrl={null} size="medium" universityName={university.name} />
        <div className={styles.programCardIdentity}>
          <h3 className={styles.universityCardTitle}>{university.name}</h3>
          <p className={styles.universityCardLocation}>{formatLocation(university)}</p>
        </div>
      </div>

      <div className={styles.universityCardFooter}>
        <p className={styles.universityCardCount}>
          {university.programCount === 0
            ? "No tracked programs yet"
            : `${university.programCount} tracked ${university.programCount === 1 ? "program" : "programs"}`}
        </p>
        <div className={styles.universityCardActions}>
          {university.officialWebsite ? (
            <a href={university.officialWebsite} rel="noopener noreferrer" target="_blank">
              Website
            </a>
          ) : null}
          <Link href={suggestionLink}>Suggest a program</Link>
        </div>
      </div>
    </article>
  );
}
