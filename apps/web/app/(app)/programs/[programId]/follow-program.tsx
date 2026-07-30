"use client";

import Link from "next/link";
import { useState } from "react";

import { FollowRequestError, requestProgramFollow } from "./follow-program-request";
import styles from "./program-detail.module.css";

import type { IntakeOption } from "./program-data";

export const FOLLOW_SUCCEEDED_EVENT = "athenvia:follow-succeeded";

type FollowPhase = "idle" | "optimistic" | "followed" | "error";

type FollowProgramProps = {
  intakes: IntakeOption[];
  programId: string;
};

export function FollowProgram({ intakes, programId }: FollowProgramProps) {
  const [selectedIntakeId, setSelectedIntakeId] = useState(intakes[0]?.id ?? "");
  const [phase, setPhase] = useState<FollowPhase>("idle");
  const [requiresAuthentication, setRequiresAuthentication] = useState(false);

  async function followSelectedIntake() {
    if (!selectedIntakeId || phase === "optimistic" || phase === "followed") {
      return;
    }

    // The UI confirms immediately. Any failed request restores the actionable
    // Follow state and keeps the selected intake intact.
    setRequiresAuthentication(false);
    setPhase("optimistic");

    try {
      const result = await requestProgramFollow(programId, selectedIntakeId);
      setPhase("followed");
      window.dispatchEvent(
        new CustomEvent(FOLLOW_SUCCEEDED_EVENT, {
          detail: result,
        }),
      );
    } catch (error) {
      setRequiresAuthentication(
        error instanceof FollowRequestError && error.code === "AUTH_REQUIRED",
      );
      setPhase("error");
    }
  }

  if (intakes.length === 0) {
    return (
      <div className={styles.followPanel}>
        <p className={styles.followMessage}>No intake is available to follow yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.followPanel}>
      <label htmlFor="follow-intake">Intake to follow</label>
      <select
        id="follow-intake"
        value={selectedIntakeId}
        onChange={(event) => {
          setSelectedIntakeId(event.target.value);
          setPhase("idle");
          setRequiresAuthentication(false);
        }}
        disabled={phase === "optimistic" || phase === "followed"}
      >
        {intakes.map((intake) => (
          <option key={intake.id} value={intake.id}>
            {intake.label}
          </option>
        ))}
      </select>

      {phase === "followed" ? (
        <p className={styles.followSuccess} role="status">
          Program followed. Reminder setup is ready for the next step.
        </p>
      ) : null}
      {phase === "error" ? (
        <div className={styles.followError} role="alert">
          <p>
            {requiresAuthentication
              ? "Sign in to keep this program in your private watchlist."
              : "We could not follow this program. Your selection was kept; please try again."}
          </p>
          {requiresAuthentication ? <Link href="/sign-in">Sign in</Link> : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void followSelectedIntake()}
        disabled={phase === "optimistic" || phase === "followed"}
      >
        {phase === "optimistic"
          ? "Following…"
          : phase === "followed"
            ? "Following"
            : "Follow this program"}
      </button>
    </div>
  );
}
