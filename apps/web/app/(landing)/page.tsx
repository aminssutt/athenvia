import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { StandaloneRedirect } from "@/components/standalone-redirect";

import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "University application reminders",
  description:
    "Find a university program, follow it and get a calm reminder before applications open or close.",
};

function ShareIcon() {
  return (
    <svg aria-hidden="true" className={styles.stepIcon} fill="none" viewBox="0 0 24 24">
      <path d="M12 15V3m0 0L8 7m4-4 4 4" />
      <path d="M7 10H5.75A1.75 1.75 0 0 0 4 11.75v6.5C4 19.216 4.784 20 5.75 20h12.5A1.75 1.75 0 0 0 20 18.25v-6.5A1.75 1.75 0 0 0 18.25 10H17" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className={styles.stepIcon} fill="none" viewBox="0 0 24 24">
      <rect height="16" rx="3" width="16" x="4" y="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" className={styles.stepIcon} fill="none" viewBox="0 0 24 24">
      <path d="m4 11 8-7 8 7v7.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5V11Z" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <StandaloneRedirect />

      <header className={styles.header}>
        <Brand />
        <Link className={styles.headerLink} href="/privacy">
          Privacy
        </Link>
      </header>

      <div className={styles.mainContent}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Find a program. Follow it.</p>
            <h1 id="landing-title">Never miss an application date.</h1>
            <p className={styles.intro}>
              Athenvia reminds you at the right time—before applications open or close.
            </p>
            <a className={styles.primaryButton} href="#install">
              Install Athenvia
              <span aria-hidden="true">↓</span>
            </a>
            <p className={styles.ctaNote}>Free to use · Made for your iPhone Home Screen</p>
          </div>

          <div className={styles.previewWrap} aria-label="Athenvia app preview">
            <div className={styles.previewGlow} aria-hidden="true" />
            <div className={styles.phone}>
              <div className={styles.phoneTop} aria-hidden="true">
                <span>9:41</span>
                <span className={styles.phonePill} />
                <span>●●●</span>
              </div>
              <div className={styles.previewHeader}>
                <div>
                  <p className={styles.previewKicker}>Your programs</p>
                  <p className={styles.previewTitle}>Watching</p>
                </div>
                <span className={styles.avatar} aria-hidden="true">
                  A
                </span>
              </div>

              <article className={styles.programCard}>
                <div className={styles.programHeading}>
                  <span className={styles.universityMark} aria-hidden="true">
                    N
                  </span>
                  <div>
                    <h2>MSc Venture Creation</h2>
                    <p>National University of Singapore</p>
                  </div>
                </div>
                <div className={styles.dateRow}>
                  <span className={`${styles.status} ${styles.statusWaiting}`}>
                    Not published yet
                  </span>
                  <span className={styles.dateHint}>Checking for updates</span>
                </div>
              </article>

              <article className={`${styles.programCard} ${styles.secondaryCard}`}>
                <div className={styles.programHeading}>
                  <span className={styles.universityMark} aria-hidden="true">
                    E
                  </span>
                  <div>
                    <h2>MSc Data Science</h2>
                    <p>ETH Zürich</p>
                  </div>
                </div>
                <div className={styles.dateRow}>
                  <span className={`${styles.status} ${styles.statusConfirmed}`}>
                    Confirmed by the university
                  </span>
                  <strong className={styles.dateHint}>30 Nov</strong>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.install} id="install" aria-labelledby="install-title">
          <div className={styles.installHeading}>
            <p className={styles.eyebrow}>Install on iPhone</p>
            <h2 id="install-title">Keep Athenvia one tap away.</h2>
            <p>No App Store needed. Install it directly from Safari.</p>
          </div>
          <ol className={styles.steps}>
            <li>
              <ShareIcon />
              <span>
                Tap the Safari <strong>share button</strong>.
              </span>
            </li>
            <li>
              <PlusIcon />
              <span>
                Choose <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li>
              <HomeIcon />
              <span>
                Open Athenvia from the <strong>new icon</strong>.
              </span>
            </li>
          </ol>
        </section>
      </div>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} Athenvia</span>
      </footer>
    </main>
  );
}
