export type ReminderNotificationType = "APPLICATION_OPENING" | "APPLICATION_DEADLINE";
export type ReminderPublicDateStatus = "CONFIRMED" | "EXPECTED" | "NOT_PUBLISHED";
export type ReminderTrackingStatus = "WATCHING" | "OPEN_NOW" | "APPLIED";

export interface ReminderApplicationWindow {
  id: string;
  closesAt: Date | null;
  opensAt: Date | null;
  publicStatus: ReminderPublicDateStatus;
}

export interface ReminderPreference {
  beforeDeadlineDays: readonly number[];
  beforeOpenDays: readonly number[];
  notifyOnOpen: boolean;
}

export interface WatchlistReminderSource {
  applicationWindows: readonly ReminderApplicationWindow[];
  hasActivePushSubscription: boolean;
  preference: ReminderPreference;
  trackingStatus: ReminderTrackingStatus;
  userId: string;
  watchlistId: string;
}

export interface PlannedReminderDelivery {
  dedupeKey: string;
  notificationType: ReminderNotificationType;
  offsetDays: number;
  scheduledFor: Date;
  userId: string;
  watchlistId: string;
  windowId: string;
}

export type ReminderDeliveryStatus = "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";

export interface ExistingReminderDelivery {
  dedupeKey: string;
  id: string;
  scheduledFor: Date;
  status: ReminderDeliveryStatus;
}

export interface ReminderReconciliationResult {
  cancelled: number;
  created: number;
  reactivated: number;
  rescheduled: number;
  unchanged: number;
}
