"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";

import {
  DEFAULT_DEADLINE_REMINDER_DAYS,
  DEFAULT_OPENING_REMINDER_DAYS,
  NotificationSettingsResponseSchema,
} from "@athenvia/contracts";

import styles from "./settings.module.css";

import type {
  DeadlineReminderDay,
  NotificationSettingsResponse as NotificationSettings,
  OpeningReminderDay,
} from "@athenvia/contracts";

type PreferenceKey = "dateChangeAlerts";
type LoadState = "anonymous" | "error" | "loading" | "ready";

const PREFERENCE_ROWS: Array<{
  description: string;
  key: PreferenceKey;
  label: string;
}> = [
  {
    description: "An alert when a university changes a tracked date.",
    key: "dateChangeAlerts",
    label: "Date changes",
  },
];

function offsetLabel(day: number, eventName: string): string {
  return day === 0 ? `On ${eventName} day` : `${day} days before`;
}

function toggleOffset<T extends number>(selected: T[], day: T, orderedDays: readonly T[]): T[] {
  const next = selected.includes(day)
    ? selected.filter((selectedDay) => selectedDay !== day)
    : [...selected, day];
  return orderedDays.filter((allowedDay) => next.includes(allowedDay));
}

async function unsubscribeBrowserPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

export function SettingsClient() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletePanelOpen, setDeletePanelOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/settings/notifications", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (response.status === 401) {
          setLoadState("anonymous");
          return;
        }

        if (!response.ok) {
          throw new Error("Settings request failed.");
        }

        setSettings(NotificationSettingsResponseSchema.parse(await response.json()));
        setLoadState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setLoadState("error");
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  async function savePreferences(next: NotificationSettings, action: string) {
    if (!settings || settings.trackedPrograms === 0) {
      return;
    }

    const previous = settings;
    setSettings(next);
    setBusyAction(action);
    setNotice(null);

    try {
      const response = await fetch("/api/settings/notifications", {
        body: JSON.stringify({
          dateChangeAlerts: next.dateChangeAlerts,
          deadlineReminderDays: next.deadlineReminderDays,
          openingReminderDays: next.openingReminderDays,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error("Settings update failed.");
      }

      setSettings(NotificationSettingsResponseSchema.parse(await response.json()));
      setNotice("Notification preferences saved.");
    } catch {
      setSettings(previous);
      setNotice("We could not save that change. Please try again.");
    } finally {
      setBusyAction(null);
    }
  }

  function updatePreference(key: PreferenceKey, enabled: boolean) {
    if (!settings) {
      return;
    }
    void savePreferences({ ...settings, [key]: enabled }, key);
  }

  function updateOpeningDays(days: OpeningReminderDay[], action: string) {
    if (!settings) {
      return;
    }
    void savePreferences(
      {
        ...settings,
        openingReminderDays: days,
        openingReminders: days.length > 0,
      },
      action,
    );
  }

  function updateDeadlineDays(days: DeadlineReminderDay[], action: string) {
    if (!settings) {
      return;
    }
    void savePreferences(
      {
        ...settings,
        deadlineReminderDays: days,
        deadlineReminders: days.length > 0,
      },
      action,
    );
  }

  async function unsubscribe() {
    setBusyAction("unsubscribe");
    setNotice(null);

    try {
      const response = await fetch("/api/settings/notifications/unsubscribe", {
        credentials: "same-origin",
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unsubscribe failed.");
      }

      setSettings((current) => (current ? { ...current, activePushSubscriptions: 0 } : current));

      try {
        await unsubscribeBrowserPush();
        setNotice("Push notifications are off on every device.");
      } catch {
        setNotice("Server delivery is off. This browser could not clear its local subscription.");
      }
    } catch {
      setNotice("We could not unsubscribe this account. Please try again.");
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "DELETE") {
      return;
    }

    setBusyAction("delete");
    setNotice(null);

    try {
      const response = await fetch("/api/settings/account", {
        body: JSON.stringify({ confirmation: deleteConfirmation }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Account deletion failed.");
      }
    } catch {
      setNotice("We could not confirm account deletion. Refresh before trying again.");
      setBusyAction(null);
      return;
    }

    try {
      await signOut({ callbackUrl: "/home", redirect: false });
    } finally {
      window.location.assign("/home");
    }
  }

  if (loadState === "loading") {
    return (
      <section className={styles.stateCard} aria-live="polite" aria-busy="true">
        <span className={styles.spinner} aria-hidden="true" />
        <div>
          <h2>Loading your settings</h2>
          <p>Checking this device and your synced preferences.</p>
        </div>
      </section>
    );
  }

  if (loadState === "anonymous") {
    return (
      <div className={styles.sections}>
        <section className={styles.stateCard} aria-labelledby="sync-settings-title">
          <span className={styles.lockMark} aria-hidden="true">
            A
          </span>
          <div>
            <h2 id="sync-settings-title">Your local access stays open</h2>
            <p>
              Search and public program information work without an account. Sign in only when you
              want synced watchlists and notification controls.
            </p>
          </div>
          <Link className={styles.primaryLink} href="/sign-in?callbackUrl=%2Fsettings">
            Sign in to manage settings
          </Link>
        </section>

        <section className={styles.card} aria-labelledby="privacy-title">
          <div className={styles.cardHeading}>
            <p className={styles.sectionLabel}>Privacy</p>
            <h2 id="privacy-title">Anonymous by default</h2>
            <p>No account is required to browse Athenvia’s public university data.</p>
          </div>
        </section>
      </div>
    );
  }

  if (loadState === "error" || !settings) {
    return (
      <section className={styles.stateCard} role="alert">
        <div>
          <h2>Settings are temporarily unavailable</h2>
          <p>Your existing choices were not changed. Refresh the page to try again.</p>
        </div>
      </section>
    );
  }

  const preferencesDisabled = settings.trackedPrograms === 0 || busyAction !== null;

  return (
    <div className={styles.sections}>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <section className={styles.card} id="notifications" aria-labelledby="notifications-title">
        <div className={styles.cardHeading}>
          <p className={styles.sectionLabel}>Notifications</p>
          <h2 id="notifications-title">Only the updates you need</h2>
          <p>
            These choices apply to {settings.trackedPrograms} tracked{" "}
            {settings.trackedPrograms === 1 ? "program" : "programs"}.
          </p>
        </div>

        <div className={styles.preferenceList}>
          {PREFERENCE_ROWS.map((preference) => (
            <div className={styles.preferenceRow} key={preference.key}>
              <div>
                <h3>{preference.label}</h3>
                <p>{preference.description}</p>
              </div>
              <button
                className={styles.switch}
                type="button"
                role="switch"
                aria-checked={settings[preference.key]}
                aria-label={`${preference.label}: ${settings[preference.key] ? "on" : "off"}`}
                disabled={preferencesDisabled}
                onClick={() => void updatePreference(preference.key, !settings[preference.key])}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <fieldset className={styles.scheduleGroup} disabled={preferencesDisabled}>
          <legend>Application openings</legend>
          <div className={styles.scheduleHeading}>
            <p>Choose exactly when Athenvia should remind you before applications open.</p>
            <button
              className={styles.switch}
              type="button"
              role="switch"
              aria-checked={settings.openingReminderDays.length > 0}
              aria-label={`Application openings: ${
                settings.openingReminderDays.length > 0 ? "on" : "off"
              }`}
              onClick={() =>
                updateOpeningDays(
                  settings.openingReminderDays.length > 0 ? [] : [...DEFAULT_OPENING_REMINDER_DAYS],
                  "opening-reminders",
                )
              }
            >
              <span aria-hidden="true" />
            </button>
          </div>
          <div className={styles.offsetOptions}>
            {DEFAULT_OPENING_REMINDER_DAYS.map((day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={settings.openingReminderDays.includes(day)}
                  onChange={() =>
                    updateOpeningDays(
                      toggleOffset(
                        settings.openingReminderDays,
                        day,
                        DEFAULT_OPENING_REMINDER_DAYS,
                      ),
                      `opening-${day}`,
                    )
                  }
                />
                <span>{offsetLabel(day, "opening")}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.scheduleGroup} disabled={preferencesDisabled}>
          <legend>Upcoming deadlines</legend>
          <div className={styles.scheduleHeading}>
            <p>Pick the useful checkpoints before an application deadline.</p>
            <button
              className={styles.switch}
              type="button"
              role="switch"
              aria-checked={settings.deadlineReminderDays.length > 0}
              aria-label={`Upcoming deadlines: ${
                settings.deadlineReminderDays.length > 0 ? "on" : "off"
              }`}
              onClick={() =>
                updateDeadlineDays(
                  settings.deadlineReminderDays.length > 0
                    ? []
                    : [...DEFAULT_DEADLINE_REMINDER_DAYS],
                  "deadline-reminders",
                )
              }
            >
              <span aria-hidden="true" />
            </button>
          </div>
          <div className={styles.offsetOptions}>
            {DEFAULT_DEADLINE_REMINDER_DAYS.map((day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={settings.deadlineReminderDays.includes(day)}
                  onChange={() =>
                    updateDeadlineDays(
                      toggleOffset(
                        settings.deadlineReminderDays,
                        day,
                        DEFAULT_DEADLINE_REMINDER_DAYS,
                      ),
                      `deadline-${day}`,
                    )
                  }
                />
                <span>{offsetLabel(day, "deadline")}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {settings.trackedPrograms === 0 ? (
          <p className={styles.helperText}>
            Add a program to your watchlist before customising its reminders.
          </p>
        ) : null}

        <div className={styles.unsubscribeRow}>
          <div>
            <h3>Push delivery</h3>
            <p>
              {settings.activePushSubscriptions === 0
                ? "No active device subscriptions."
                : `${settings.activePushSubscriptions} active ${
                    settings.activePushSubscriptions === 1 ? "device" : "devices"
                  }.`}
            </p>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={busyAction !== null}
            onClick={() => void unsubscribe()}
          >
            {busyAction === "unsubscribe" ? "Turning off…" : "Unsubscribe all"}
          </button>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="account-title">
        <div className={styles.cardHeading}>
          <p className={styles.sectionLabel}>Account</p>
          <h2 id="account-title">Access and privacy</h2>
          <p>Control your current session and the private data attached to your account.</p>
        </div>

        <button
          className={styles.secondaryButton}
          type="button"
          disabled={busyAction !== null}
          onClick={() => void signOut({ callbackUrl: "/home" })}
        >
          Sign out
        </button>

        <div className={styles.dangerZone}>
          <div>
            <h3>Delete account</h3>
            <p>
              Removes watchlists, private notes, notification history, devices and login sessions.
              Public contributions are kept without your identity.
            </p>
          </div>

          {!deletePanelOpen ? (
            <button
              className={styles.dangerOutlineButton}
              type="button"
              disabled={busyAction !== null}
              onClick={() => setDeletePanelOpen(true)}
            >
              Delete my account
            </button>
          ) : (
            <div className={styles.confirmationPanel}>
              <label htmlFor="delete-confirmation">
                Type <strong>DELETE</strong> to confirm
              </label>
              <input
                id="delete-confirmation"
                autoComplete="off"
                spellCheck="false"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
              <div className={styles.confirmationActions}>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  disabled={busyAction === "delete"}
                  onClick={() => {
                    setDeletePanelOpen(false);
                    setDeleteConfirmation("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className={styles.dangerButton}
                  type="button"
                  disabled={deleteConfirmation !== "DELETE" || busyAction === "delete"}
                  onClick={() => void deleteAccount()}
                >
                  {busyAction === "delete" ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
