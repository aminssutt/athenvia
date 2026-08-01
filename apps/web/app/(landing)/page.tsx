import { getUniversityMonogram } from "@athenvia/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment, type CSSProperties } from "react";

import { Brand } from "@/components/brand";
import { StandaloneRedirect } from "@/components/standalone-redirect";
import { getUniversityLogoAsset } from "@/components/university-logo-assets";

import styles from "./landing.module.css";
import { ScrollReveal } from "./scroll-reveal";

export const metadata: Metadata = {
  title: "University application reminders",
  description:
    "Find a university program, follow it and get a calm reminder before applications open or close.",
};

const HEADLINE_WORDS = ["Never", "miss", "an", "application", "date."];

/* Inline style helper for the staggered scroll reveals; the CSS module reads
   the custom property as the element's transition delay. */
function revealDelay(step: number): CSSProperties {
  return { "--reveal-delay": `calc(${step} * var(--stagger-step) * 2)` } as CSSProperties;
}

/* Marketing wordmarks only: the live catalogue drives the real product pages,
   while this strip just names the calibre of universities inside it. */
const UNIVERSITY_ROWS: string[][] = [
  [
    "University of Oxford",
    "University of Cambridge",
    "Massachusetts Institute of Technology",
    "Imperial College London",
    "ETH Zürich",
    "EPFL",
    "University College London",
    "Columbia University",
  ],
  [
    "UC Berkeley",
    "UCLA",
    "Cornell Tech",
    "Tsinghua University",
    "Seoul National University",
    "National University of Singapore",
    "HEC Paris",
    "École Polytechnique",
  ],
];

const VALUE_CARDS = [
  {
    title: "Verified with the university",
    copy: "Every date traces back to an official page. When nothing is published yet, Athenvia says so instead of guessing.",
  },
  {
    title: "One calm reminder",
    copy: "A single push at the right moment — no feeds, no streaks, no noise between you and the deadline.",
  },
  {
    title: "Lives on your Home Screen",
    copy: "A real app feel straight from Safari, with your programs one tap away and readable offline.",
  },
] as const;

const PRICING_PLANS = [
  {
    name: "Free",
    price: "€0",
    period: "forever",
    tagline: "Everything you need to stop refreshing admissions pages.",
    features: [
      "Follow programs across the catalogue",
      "Push reminders before deadlines",
      "Installs from Safari in one tap",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Max",
    price: "€19.90",
    period: "per year",
    tagline: "For the season you apply everywhere at once.",
    features: [
      "Everything in Free",
      "Unlimited followed programs",
      "Priority date verification",
      "New universities first",
    ],
    cta: "Go Max at launch",
    featured: true,
  },
] as const;

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

function MarqueeRow({ names, reverse }: { names: string[]; reverse?: boolean }) {
  const items = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className={styles.marqueeGroup}>
      {names.map((name) => {
        const logo = getUniversityLogoAsset(name);
        return (
          <li key={name} className={styles.marqueeItem}>
            <span aria-hidden="true" className={styles.marqueeMark}>
              {logo ? (
                <img alt="" decoding="async" loading="lazy" src={logo} />
              ) : (
                getUniversityMonogram(name)
              )}
            </span>
            {name}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={styles.marquee}>
      <div
        className={
          reverse ? `${styles.marqueeTrack} ${styles.marqueeReverse}` : styles.marqueeTrack
        }
      >
        {items(false)}
        {/* Second copy makes the loop seamless; hidden from assistive tech. */}
        {items(true)}
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <StandaloneRedirect />
      <ScrollReveal />

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Brand />
          <nav aria-label="Landing sections" className={styles.headerNav}>
            <a className={styles.headerLink} href="#universities">
              Universities
            </a>
            <a className={styles.headerLink} href="#pricing">
              Pricing
            </a>
            <Link className={styles.headerLink} href="/privacy">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <div className={styles.mainContent}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Find a program. Follow it.</p>
            <h1 id="landing-title">
              {HEADLINE_WORDS.map((word, index) => (
                <Fragment key={word}>
                  <span className={styles.headlineWord}>
                    <span
                      className={styles.headlineWordInner}
                      style={{ animationDelay: `calc(${index} * var(--stagger-step) * 1.6)` }}
                    >
                      {word}
                    </span>
                  </span>{" "}
                </Fragment>
              ))}
            </h1>
            <p className={styles.intro}>
              Athenvia reminds you at the right time—before applications open or close.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryButton} href="#install">
                Install Athenvia
                <span aria-hidden="true">↓</span>
              </a>
              <a className={styles.secondaryButton} href="#pricing">
                See pricing
              </a>
            </div>
            <p className={styles.ctaNote}>Free to use · Made for your iPhone Home Screen</p>
          </div>

          <div className={styles.previewWrap} aria-label="Athenvia app preview">
            <div className={styles.previewGlow} aria-hidden="true" />
            {/* Device-frame composite: the app capture sits behind the frame
                asset, whose screen area is knocked out (transparent), so the
                shot shows through exactly like a photographed phone. */}
            <div className={styles.deviceFrame}>
              <span className={styles.deviceScreen} aria-hidden="true">
                <img alt="" decoding="async" src="/marketing/screen-search.png" />
              </span>
              <img
                alt=""
                className={styles.deviceChrome}
                decoding="async"
                height={1037}
                src="/marketing/iphone-frame.webp"
                width={520}
              />
            </div>
          </div>
        </section>

        <section
          className={styles.universities}
          id="universities"
          aria-labelledby="universities-title"
        >
          <div className={styles.sectionHeading} data-reveal>
            <p className={styles.eyebrow}>The catalogue</p>
            <h2 id="universities-title">Programs from universities worth the wait.</h2>
            <p className={styles.sectionIntro}>
              20+ universities and 50+ graduate programs, each date checked against the official
              admissions page.
            </p>
          </div>
          <div className={styles.marqueeStack} data-reveal style={revealDelay(1)}>
            <MarqueeRow names={UNIVERSITY_ROWS[0]} />
            <MarqueeRow names={UNIVERSITY_ROWS[1]} reverse />
          </div>
        </section>

        <section className={styles.values} aria-label="Why Athenvia">
          <ul className={styles.valueGrid}>
            {VALUE_CARDS.map((card, index) => (
              <li
                key={card.title}
                className={styles.valueCard}
                data-reveal
                style={revealDelay(index)}
              >
                <span aria-hidden="true" className={styles.valueIndex}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{card.title}</h3>
                <p>{card.copy}</p>
              </li>
            ))}
          </ul>
        </section>

        <div aria-hidden="true" className={styles.ticker}>
          <div className={styles.tickerTrack}>
            <span>Follow · Verify · Remind · </span>
            <span>Follow · Verify · Remind · </span>
          </div>
        </div>

        <section className={styles.pricing} id="pricing" aria-labelledby="pricing-title">
          <div className={styles.sectionHeading} data-reveal>
            <p className={styles.eyebrow}>Pricing</p>
            <h2 id="pricing-title">Start free. Upgrade when it matters.</h2>
            <p className={styles.sectionIntro}>
              Launch pricing preview — both plans are placeholders until launch day.
            </p>
          </div>
          <div className={styles.planGrid}>
            {PRICING_PLANS.map((plan, index) => (
              <article
                key={plan.name}
                className={plan.featured ? `${styles.plan} ${styles.planFeatured}` : styles.plan}
                data-reveal
                style={revealDelay(index)}
              >
                {plan.featured ? <span className={styles.planBadge}>Early access</span> : null}
                <h3>{plan.name}</h3>
                <p className={styles.planPrice}>
                  {plan.price}
                  <span> / {plan.period}</span>
                </p>
                <p className={styles.planTagline}>{plan.tagline}</p>
                <ul className={styles.planFeatures}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a
                  className={plan.featured ? styles.planCtaFeatured : styles.planCta}
                  href="#install"
                >
                  {plan.cta}
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.install} id="install" aria-labelledby="install-title">
          <div className={styles.installHeading} data-reveal>
            <p className={styles.eyebrow}>Install on iPhone</p>
            <h2 id="install-title">Keep Athenvia one tap away.</h2>
            <p>No App Store needed. Install it directly from Safari.</p>
          </div>
          <ol className={styles.steps} data-reveal style={revealDelay(1)}>
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
        <p className={styles.footerLine} data-reveal>
          Your next deadline, remembered.
        </p>
        <a className={styles.footerCta} data-reveal href="#install">
          Start free on iPhone
        </a>
        <span className={styles.footerLegal}>© {new Date().getFullYear()} Athenvia</span>
      </footer>
    </main>
  );
}
