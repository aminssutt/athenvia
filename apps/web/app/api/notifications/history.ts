import { database } from "@athenvia/database";

import type { DeliveryStatus, NotificationType } from "@athenvia/database";

const HISTORY_LIMIT = 50;

const notificationCopy = {
  APPLICATION_DEADLINE: {
    description: "A reminder about an upcoming application deadline.",
    title: "Application deadline",
  },
  APPLICATION_OPENING: {
    description: "A reminder that an application period is opening.",
    title: "Applications opening",
  },
  DATE_CHANGED: {
    description: "A published application date changed.",
    title: "Application date updated",
  },
  SUBMISSION_APPROVED: {
    description: "A submitted catalogue update was approved.",
    title: "Submission approved",
  },
} as const satisfies Record<NotificationType, { description: string; title: string }>;

export type NotificationHistoryItem = {
  description: string;
  href: string;
  id: string;
  notificationType: NotificationType;
  program: {
    id: string;
    name: string;
    universityName: string;
  };
  scheduledFor: string;
  sentAt: string | null;
  status: Extract<DeliveryStatus, "FAILED" | "SENT">;
  title: string;
};

type NotificationHistoryClient = Pick<typeof database, "notificationDelivery">;

function terminalHistoryStatus(status: DeliveryStatus): Extract<DeliveryStatus, "FAILED" | "SENT"> {
  if (status === "FAILED" || status === "SENT") {
    return status;
  }

  throw new Error("Notification history query returned a non-terminal status.");
}

export async function loadNotificationHistory(
  userId: string,
  client: NotificationHistoryClient = database,
): Promise<NotificationHistoryItem[]> {
  const deliveries = await client.notificationDelivery.findMany({
    where: {
      status: {
        in: ["SENT", "FAILED"],
      },
      userId,
      watchlist: {
        is: {
          userId,
        },
      },
    },
    orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
    select: {
      id: true,
      notificationType: true,
      scheduledFor: true,
      sentAt: true,
      status: true,
      watchlist: {
        select: {
          program: {
            select: {
              id: true,
              name: true,
              university: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return deliveries.map((delivery) => {
    const copy = notificationCopy[delivery.notificationType];
    const program = delivery.watchlist.program;

    return {
      description: copy.description,
      href: `/programs/${program.id}`,
      id: delivery.id,
      notificationType: delivery.notificationType,
      program: {
        id: program.id,
        name: program.name,
        universityName: program.university.name,
      },
      scheduledFor: delivery.scheduledFor.toISOString(),
      sentAt: delivery.sentAt?.toISOString() ?? null,
      status: terminalHistoryStatus(delivery.status),
      title: copy.title,
    };
  });
}
