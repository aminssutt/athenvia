import { Brand } from "@/components/brand";
import { LoadingState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";

import styles from "./notifications.module.css";

export default function NotificationsLoading() {
  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Brand />
          <p className={styles.eyebrow}>Recent activity</p>
          <h1>Notifications</h1>
        </header>
        <LoadingState
          description="Your recent deliveries will be ready in a moment."
          title="Loading notifications"
        />
      </main>
      <MobileNavigation />
    </div>
  );
}
