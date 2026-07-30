"use client";

import { useState } from "react";

import type { AdminReviewItem } from "@/app/api/admin/reviews/service";

import styles from "./review.module.css";

function displayValue(value: AdminReviewItem["oldValue"]): string {
  if (value === null) {
    return "No previous value";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function ReviewQueue({ initialReviews }: { initialReviews: AdminReviewItem[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    setBusyId(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/reviews/${id}`, {
        body: JSON.stringify({ decision }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "The review could not be saved.");
      }
      setReviews((current) => current.filter((review) => review.id !== id));
      setMessage(`Revision ${body.status === "APPROVED" ? "approved" : "rejected"} and audited.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  if (reviews.length === 0) {
    return (
      <section className={styles.empty}>
        <h2>Queue clear</h2>
        <p>There are no pending catalogue changes to review.</p>
      </section>
    );
  }

  return (
    <section aria-label="Pending reviews" className={styles.queue}>
      <div className={styles.summary}>
        <strong>{reviews.length}</strong>
        <span>{reviews.length === 1 ? "pending change" : "pending changes"}</span>
      </div>
      {message ? (
        <p aria-live="polite" className={styles.message}>
          {message}
        </p>
      ) : null}
      {reviews.map((review) => (
        <article className={styles.card} key={review.id}>
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.entity}>{review.entityType.replaceAll("_", " ")}</p>
              <h2>{review.fieldName}</h2>
            </div>
            <span className={review.hasConflict ? styles.conflict : styles.pending}>
              {review.hasConflict ? "Conflicting evidence" : "Pending"}
            </span>
          </div>

          <dl className={styles.values}>
            <div>
              <dt>Current</dt>
              <dd>
                <pre>{displayValue(review.oldValue)}</pre>
              </dd>
            </div>
            <div>
              <dt>Proposed</dt>
              <dd>
                <pre>{displayValue(review.newValue)}</pre>
              </dd>
            </div>
          </dl>

          <div className={styles.evidence}>
            <h3>Evidence</h3>
            {review.source ? (
              <>
                <a href={review.source.url} rel="noreferrer" target="_blank">
                  Open official source
                </a>
                <p>
                  {review.source.sourceType.replaceAll("_", " ")}
                  {review.source.capturedAt
                    ? ` · captured ${new Date(review.source.capturedAt).toLocaleDateString("en-GB")}`
                    : ""}
                </p>
              </>
            ) : (
              <p>No linked source snapshot. Review manually.</p>
            )}
            <p>
              Proposed by {review.creator} · {new Date(review.createdAt).toLocaleString("en-GB")}
            </p>
          </div>

          {review.hasConflict ? (
            <p className={styles.conflictHelp}>
              Reject competing values first. The last remaining candidate can then be approved.
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.reject}
              disabled={busyId !== null}
              onClick={() => void decide(review.id, "REJECT")}
              type="button"
            >
              Reject
            </button>
            <button
              className={styles.approve}
              disabled={busyId !== null}
              onClick={() => void decide(review.id, "APPROVE")}
              type="button"
            >
              {busyId === review.id ? "Saving…" : "Approve"}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
