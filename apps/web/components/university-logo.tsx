"use client";

import { getUniversityMonogram } from "@athenvia/ui";
import { useState } from "react";

import styles from "./product-components.module.css";
import { getUniversityLogoAsset } from "./university-logo-assets";

type UniversityLogoProps = {
  logoUrl: string | null;
  size?: "small" | "medium" | "large";
  universityName: string;
};

export function UniversityLogo({ logoUrl, size = "medium", universityName }: UniversityLogoProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  // A curated database URL always wins; the bundled launch-catalogue mark
  // fills in while logo curation (#87) is still under way.
  const source = logoUrl ?? getUniversityLogoAsset(universityName);
  const showMonogram = !source || failedSource === source;
  const accessibleLabel = showMonogram ? `${universityName} monogram` : `${universityName} logo`;

  return (
    <span
      className={styles.universityLogo}
      data-size={size}
      role="img"
      aria-label={accessibleLabel}
    >
      {showMonogram ? (
        <span aria-hidden="true">{getUniversityMonogram(universityName)}</span>
      ) : (
        // A native image keeps approved remote assets independent of Next.js host configuration.
        <img
          className={styles.universityLogoImage}
          src={source}
          alt=""
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(source)}
        />
      )}
    </span>
  );
}
