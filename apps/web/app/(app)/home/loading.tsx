import { Brand } from "@/components/brand";
import { LoadingState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";

import styles from "./home.module.css";

export default function HomeLoading() {
  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Brand />
          <p className={styles.eyebrow}>My watchlist</p>
          <h1>Your programs</h1>
        </header>
        <LoadingState
          description="Your watchlist will be ready in a moment."
          title="Loading your programs"
        />
      </main>
      <MobileNavigation />
    </div>
  );
}
