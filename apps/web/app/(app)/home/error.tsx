"use client";

import { Brand } from "@/components/brand";
import { ErrorState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";

import styles from "./home.module.css";

type HomeErrorProps = {
  reset: () => void;
};

export default function HomeError({ reset }: HomeErrorProps) {
  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Brand />
          <p className={styles.eyebrow}>My watchlist</p>
          <h1>Your programs</h1>
        </header>
        <ErrorState
          description="Your programs are still safe. Please try again."
          onRetry={reset}
          title="We couldn’t show your programs"
        />
      </main>
      <MobileNavigation />
    </div>
  );
}
