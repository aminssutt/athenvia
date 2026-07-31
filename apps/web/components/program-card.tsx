import type { ProgramSummary } from "@athenvia/contracts";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateStatus } from "./date-status";
import styles from "./product-components.module.css";
import { UniversityLogo } from "./university-logo";

type ProgramCardProps = {
  action?: ReactNode;
  href?: string;
  locale?: string;
  program: ProgramSummary;
};

function formatDegreeType(degreeType: ProgramSummary["degreeType"]): string {
  const names: Record<ProgramSummary["degreeType"], string> = {
    MASTER: "Master",
    MBA: "MBA",
    PHD: "PhD",
    OTHER: "Other degree",
  };

  return names[degreeType];
}

function getNextEvent(program: ProgramSummary, locale?: string) {
  const applicationWindow = program.nextWindow;

  if (!applicationWindow) {
    return null;
  }

  // A closed cycle keeps its real deadline, but calling a past date the "next"
  // one would be plainly wrong.
  const deadlineHasPassed =
    applicationWindow.closesAt !== null && new Date(applicationWindow.closesAt) < new Date();

  const event = applicationWindow.closesAt
    ? {
        label: deadlineHasPassed
          ? "Applications closed"
          : applicationWindow.roundName
            ? `${applicationWindow.roundName} deadline`
            : "Next deadline",
        value: applicationWindow.closesAt,
      }
    : applicationWindow.opensAt
      ? { label: "Applications open", value: applicationWindow.opensAt }
      : null;

  if (!event) {
    return null;
  }

  return {
    label: event.label,
    // Pinned to UTC like every other catalogue date formatter: deadlines are
    // stored as instants, and rendering them in the viewer's zone would shift
    // the published calendar day for anyone west of UTC.
    value: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(event.value),
    ),
  };
}

export function ProgramCard({ action, href, locale, program }: ProgramCardProps) {
  const nextEvent = getNextEvent(program, locale);
  const publicStatus = program.nextWindow?.publicStatus ?? "NOT_PUBLISHED";
  const programMetadata = [
    formatDegreeType(program.degreeType),
    program.location,
    program.durationMonths ? `${program.durationMonths} months` : null,
    program.intakeLabel,
  ].filter((value): value is string => Boolean(value));

  return (
    <article className={styles.programCard}>
      <div className={styles.programCardHeading}>
        <UniversityLogo
          logoUrl={program.university.logoUrl}
          size="medium"
          universityName={program.university.name}
        />
        <div className={styles.programCardIdentity}>
          <p className={styles.programUniversity}>{program.university.name}</p>
          <h3 className={styles.programTitle}>
            {href ? (
              <Link className={styles.programLink} href={href}>
                {program.name}
              </Link>
            ) : (
              program.name
            )}
          </h3>
        </div>
      </div>

      <ul className={styles.programMetadata} aria-label="Program details">
        {programMetadata.map((value, index) => (
          <li key={`${value}-${index}`}>{value}</li>
        ))}
      </ul>

      {nextEvent ? (
        <dl className={styles.programNextEvent}>
          <div>
            <dt>{nextEvent.label}</dt>
            <dd>{nextEvent.value}</dd>
          </div>
        </dl>
      ) : null}

      <DateStatus status={publicStatus} showDescription />
      {action ? <div className={styles.programCardAction}>{action}</div> : null}
    </article>
  );
}
