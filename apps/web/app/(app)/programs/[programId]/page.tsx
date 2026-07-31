import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { ProgramDetail } from "@athenvia/contracts";

import { Brand } from "@/components/brand";
import { DateStatus } from "@/components/date-status";
import { MobileNavigation } from "@/components/mobile-navigation";
import { UniversityLogo } from "@/components/university-logo";

import { FollowProgram } from "./follow-program";
import styles from "./program-detail.module.css";
import { loadProgram } from "./program-data";

type ProgramPageProps = {
  params: Promise<{ programId: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
});

export const dynamic = "force-dynamic";

const degreeNames: Record<ProgramDetail["degreeType"], string> = {
  MASTER: "Master",
  MBA: "MBA",
  PHD: "PhD",
  OTHER: "Other degree",
};

function formatDuration(durationMonths: number | null): string {
  if (!durationMonths) {
    return "Not published";
  }

  return `${durationMonths} ${durationMonths === 1 ? "month" : "months"}`;
}

function PublishedDate({ value }: { value: string | null }) {
  if (!value) {
    return <span className={styles.missingValue}>Not published yet</span>;
  }

  return <time dateTime={value}>{dateFormatter.format(new Date(value))}</time>;
}

function safeOfficialSource(sourceUrl: string | null): string | null {
  if (!sourceUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(sourceUrl);

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username.length > 0 ||
      parsedUrl.password.length > 0
    ) {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: ProgramPageProps): Promise<Metadata> {
  const { programId } = await params;
  const program = await loadProgram(programId);

  return {
    title: program?.name ?? "Program not found",
  };
}

export default async function ProgramPage({ params }: ProgramPageProps) {
  const { programId } = await params;
  const program = await loadProgram(programId);

  if (!program) {
    notFound();
  }

  const applicationWindow = program.nextWindow;
  const applicationSource = safeOfficialSource(applicationWindow?.officialSourceUrl ?? null);
  const summarySource = safeOfficialSource(program.summary.officialSourceUrl);
  const publicStatus = applicationWindow?.publicStatus ?? "NOT_PUBLISHED";
  // A closed cycle keeps its real deadline, but calling a past date the "next"
  // one would be plainly wrong.
  const deadlineHasPassed =
    applicationWindow?.closesAt != null && new Date(applicationWindow.closesAt) < new Date();

  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.siteHeader}>
          <Brand />
        </header>

        <article className={styles.program}>
          <header className={styles.programHeader}>
            <UniversityLogo
              logoUrl={program.university.logoUrl}
              size="large"
              universityName={program.university.name}
            />
            <div>
              <p className={styles.universityName}>{program.university.name}</p>
              <h1>{program.name}</h1>
            </div>
          </header>

          <section className={styles.card} aria-labelledby="program-overview">
            <h2 id="program-overview">Program overview</h2>
            <dl className={styles.details}>
              <div>
                <dt>Degree</dt>
                <dd>{degreeNames[program.degreeType]}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {program.location ?? <span className={styles.missingValue}>Not published</span>}
                </dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(program.durationMonths)}</dd>
              </div>
              <div>
                <dt>Intake</dt>
                <dd>{program.intakeLabel}</dd>
              </div>
              {applicationWindow?.roundName ? (
                <div>
                  <dt>Application round</dt>
                  <dd>{applicationWindow.roundName}</dd>
                </div>
              ) : null}
            </dl>

            {program.domains.length > 0 ? (
              <ul className={styles.domains} aria-label="Program domains">
                {program.domains.map((domain) => (
                  <li key={domain}>{domain}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="program-summary">
            <h2 id="program-summary">About this program</h2>
            <p className={styles.summaryText}>{program.summary.text}</p>
            {summarySource ? (
              <a
                className={styles.inlineSourceLink}
                href={summarySource}
                rel="noopener noreferrer"
                target="_blank"
              >
                Read the official programme source
                <span aria-hidden="true"> ↗</span>
                <span className={styles.visuallyHidden}> (opens in a new tab)</span>
              </a>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="application-dates">
            <div className={styles.sectionHeading}>
              <h2 id="application-dates">Application dates</h2>
              <DateStatus status={publicStatus} showDescription />
            </div>
            <dl className={styles.dateDetails}>
              <div>
                <dt>Applications open</dt>
                <dd>
                  <PublishedDate value={applicationWindow?.opensAt ?? null} />
                </dd>
              </div>
              <div>
                <dt>{deadlineHasPassed ? "Applications closed" : "Next deadline"}</dt>
                <dd>
                  <PublishedDate value={applicationWindow?.closesAt ?? null} />
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.sourceCard} aria-labelledby="official-source">
            <div>
              <h2 id="official-source">Official source</h2>
              <p>Check the university page for the latest application information.</p>
            </div>
            {applicationSource ? (
              <a
                className={styles.sourceLink}
                href={applicationSource}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open official university source
                <span aria-hidden="true"> ↗</span>
                <span className={styles.visuallyHidden}> (opens in a new tab)</span>
              </a>
            ) : (
              <p className={styles.missingSource}>Official source not available yet.</p>
            )}
          </section>

          <FollowProgram intakes={program.intakes} programId={program.id} />
        </article>
      </main>
      <MobileNavigation />
    </div>
  );
}
