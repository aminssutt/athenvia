import Link from "next/link";

import type { NotificationHistoryItem } from "@/app/api/notifications/history";
import { EmptyState } from "@/components/interface-state";

import { notificationHistoryEmptyCopy, presentNotificationHistory } from "./history-presentation";
import styles from "./notifications.module.css";

type NotificationHistoryContentProps = {
  items: NotificationHistoryItem[];
};

const historyDateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function NotificationHistoryContent({ items }: NotificationHistoryContentProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        action={
          <Link className={styles.primaryLink} href="/home">
            {notificationHistoryEmptyCopy.action}
          </Link>
        }
        description={notificationHistoryEmptyCopy.description}
        title={notificationHistoryEmptyCopy.title}
      />
    );
  }

  return (
    <ol className={styles.historyList} aria-label="Recent notification deliveries">
      {presentNotificationHistory(items).map((item) => {
        return (
          <li key={item.id}>
            <article className={styles.historyCard} data-status={item.status}>
              <div className={styles.cardMetadata}>
                <span className={styles.status}>{item.statusLabel}</span>
                <span className={styles.timestamp}>
                  {item.timestampLabel}{" "}
                  <time dateTime={item.timestampValue}>
                    {historyDateFormatter.format(new Date(item.timestampValue))}
                  </time>
                </span>
              </div>

              <div className={styles.cardCopy}>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
              </div>

              <Link className={styles.programLink} href={item.href}>
                <span>
                  <strong>{item.program.name}</strong>
                  <small>{item.program.universityName}</small>
                </span>
                <span aria-hidden="true">View program &rarr;</span>
              </Link>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
