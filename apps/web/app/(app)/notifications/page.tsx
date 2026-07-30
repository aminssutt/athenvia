import type { Metadata } from "next";
import Link from "next/link";

import { loadNotificationHistory } from "@/app/api/notifications/history";
import { getAuthenticatedUser } from "@/app/api/settings/authenticated-user";
import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/interface-state";
import { MobileNavigation } from "@/components/mobile-navigation";

import { NotificationHistoryContent } from "./history-list";
import styles from "./notifications.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Review recent Athenvia reminder deliveries.",
  title: "Notifications",
};

export default async function NotificationsPage() {
  const user = await getAuthenticatedUser();
  const items = user ? await loadNotificationHistory(user.id) : null;

  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Brand />
          <p className={styles.eyebrow}>Recent activity</p>
          <h1>Notifications</h1>
          <p className={styles.intro}>
            See which reminders were sent and whether a delivery needs attention.
          </p>
        </header>

        {items ? (
          <NotificationHistoryContent items={items} />
        ) : (
          <EmptyState
            action={
              <Link className={styles.primaryLink} href="/sign-in">
                Sign in
              </Link>
            }
            description="Notification history belongs to your account and stays private."
            title="Sign in to see your history"
          />
        )}
      </main>
      <MobileNavigation />
    </div>
  );
}
