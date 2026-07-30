"use client";

import { Brand } from "@/components/brand";
import { ErrorState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";

import styles from "./notifications.module.css";

type NotificationsErrorProps = {
  reset: () => void;
};

export default function NotificationsError({ reset }: NotificationsErrorProps) {
  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Brand />
          <p className={styles.eyebrow}>Recent activity</p>
          <h1>Notifications</h1>
        </header>
        <ErrorState
          description="Your notification history is still private. Please try again."
          onRetry={reset}
          title="We couldn't load notifications"
        />
      </main>
      <MobileNavigation />
    </div>
  );
}
