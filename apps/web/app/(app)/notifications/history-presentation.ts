import type { NotificationHistoryItem } from "@/app/api/notifications/history";

export const notificationHistoryEmptyCopy = {
  action: "View your programs",
  description: "Sent reminders and delivery issues will appear here.",
  title: "No notifications yet",
} as const;

export type PresentedNotificationHistoryItem = NotificationHistoryItem & {
  statusLabel: "Delivery failed" | "Sent";
  timestampLabel: "Scheduled for" | "Sent";
  timestampValue: string;
};

export function presentNotificationHistory(
  items: NotificationHistoryItem[],
): PresentedNotificationHistoryItem[] {
  return items.map((item) => {
    const wasSent = item.status === "SENT";
    const hasSentTimestamp = wasSent && item.sentAt !== null;
    const timestampValue = hasSentTimestamp ? item.sentAt : item.scheduledFor;

    return {
      ...item,
      statusLabel: wasSent ? "Sent" : "Delivery failed",
      timestampLabel: hasSentTimestamp ? "Sent" : "Scheduled for",
      timestampValue: timestampValue ?? item.scheduledFor,
    };
  });
}
