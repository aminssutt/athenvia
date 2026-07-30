import type { Metadata } from "next";

import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";

import { SettingsClient } from "./settings-client";
import styles from "./settings.module.css";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage Athenvia notifications, privacy and account access.",
};

export default function SettingsPage() {
  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Brand />
          <p className={styles.eyebrow}>Your space</p>
          <h1>Settings</h1>
          <p className={styles.intro}>Keep the useful reminders. Control everything else.</p>
        </header>

        <SettingsClient />
      </main>
      <MobileNavigation />
    </div>
  );
}
