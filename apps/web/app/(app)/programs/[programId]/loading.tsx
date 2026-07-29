import { Brand } from "@/components/brand";
import { LoadingState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";

import styles from "./program-detail.module.css";

export default function ProgramLoading() {
  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.siteHeader}>
          <Brand />
        </header>
        <LoadingState
          description="The program information will be ready in a moment."
          title="Loading program"
        />
      </main>
      <MobileNavigation />
    </div>
  );
}
