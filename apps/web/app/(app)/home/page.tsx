import type { Metadata } from "next";
import Link from "next/link";

import type { WatchlistItem } from "@athenvia/contracts";

import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";
import { ProgramCard } from "@/components/program-card";

import styles from "./home.module.css";
import { loadWatchlist } from "./watchlist-data";

export const metadata: Metadata = {
  title: "My programs",
};

type WatchlistSectionProps = {
  emptyDescription: string;
  emptyTitle: string;
  items: WatchlistItem[];
  title: string;
};

const nextDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatProgramCount(count: number): string {
  return `${count} ${count === 1 ? "program" : "programs"}`;
}

function NextUsefulDate({ value }: { value: string | null }) {
  return (
    <dl className={styles.nextUsefulDate}>
      <div>
        <dt>Next useful date</dt>
        <dd>
          {value ? (
            <time dateTime={value}>{nextDateFormatter.format(new Date(value))}</time>
          ) : (
            "To be announced"
          )}
        </dd>
      </div>
    </dl>
  );
}

function WatchlistSection({ emptyDescription, emptyTitle, items, title }: WatchlistSectionProps) {
  const sectionId = `watchlist-${title.toLocaleLowerCase().replace(/\s+/gu, "-")}`;

  return (
    <section className={styles.section} aria-labelledby={sectionId}>
      <div className={styles.sectionHeading}>
        <h2 id={sectionId}>{title}</h2>
        <span aria-label={formatProgramCount(items.length)}>{items.length}</span>
      </div>

      {items.length > 0 ? (
        <div className={styles.programList}>
          {items.map((item) => (
            <ProgramCard
              key={item.id}
              action={<NextUsefulDate value={item.nextUsefulDate} />}
              href={`/programs/${item.program.id}`}
              locale="en"
              program={item.program}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          action={
            <Link className={styles.addProgramLink} href="/search">
              Add a program
            </Link>
          }
          description={emptyDescription}
          title={emptyTitle}
        />
      )}
    </section>
  );
}

export default async function HomePage() {
  const watchlist = await loadWatchlist();

  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerBar}>
            <Brand />
            <Link className={styles.authLink} href="/sign-in">
              Sign in to sync
            </Link>
          </div>
          <p className={styles.eyebrow}>My watchlist</p>
          <h1>Your programs</h1>
          <p className={styles.intro}>The next useful dates, without the noise.</p>
        </header>

        <div className={styles.sections}>
          <WatchlistSection
            emptyDescription="Add a program to start watching its application dates."
            emptyTitle="No programs yet"
            items={watchlist.watching}
            title="Watching"
          />
          <WatchlistSection
            emptyDescription="Add a program and we’ll show it here when applications open."
            emptyTitle="Nothing is open right now"
            items={watchlist.openNow}
            title="Open now"
          />
          <WatchlistSection
            emptyDescription="Add a program, then mark it applied after you submit."
            emptyTitle="No applications marked yet"
            items={watchlist.applied}
            title="Applied"
          />
        </div>
      </main>
      <MobileNavigation />
    </div>
  );
}
