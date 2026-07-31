"use client";

import Link from "next/link";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";

import { universitySubmissionApiTransport } from "./api-transport";
import styles from "./missing-university.module.css";
import { MissingUniversitySubmissionSchema, submitMissingUniversity } from "./submission";

import type { FormEvent } from "react";
import type { SubmissionResult } from "./submission";

type MissingUniversityFormProps = {
  prefilledName: string;
};

type FieldErrors = Partial<Record<"country" | "officialWebsite" | "universityName", string>>;

function PendingReviewExplanation() {
  return (
    <aside className={styles.reviewNote} aria-labelledby="pending-review-title">
      <span className={styles.reviewIcon} aria-hidden="true">
        ✓
      </span>
      <div>
        <h2 id="pending-review-title">What happens after you send it?</h2>
        <p>
          Your suggestion enters pending review. Athenvia checks the university details before
          making anything public.
        </p>
      </div>
    </aside>
  );
}

export function MissingUniversityForm({ prefilledName }: MissingUniversityFormProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFieldErrors({});
    setResult(null);

    const formData = new FormData(form);
    const parsedSubmission = MissingUniversitySubmissionSchema.safeParse({
      universityName: formData.get("universityName"),
      country: formData.get("country"),
      officialWebsite: formData.get("officialWebsite"),
    });

    if (!parsedSubmission.success) {
      const flattenedErrors = parsedSubmission.error.flatten().fieldErrors;
      setFieldErrors({
        country: flattenedErrors.country?.[0],
        officialWebsite: flattenedErrors.officialWebsite?.[0],
        universityName: flattenedErrors.universityName?.[0],
      });
      window.requestAnimationFrame(() => {
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setIsSubmitting(true);
    const submissionResult = await submitMissingUniversity(
      parsedSubmission.data,
      universitySubmissionApiTransport,
    );
    setResult(submissionResult);
    setIsSubmitting(false);
  }

  if (result?.status === "pending_review") {
    return (
      <div className={styles.appFrame}>
        <main className={styles.main}>
          <header className={styles.siteHeader}>
            <Brand />
          </header>
          <section className={styles.confirmation} aria-labelledby="submission-confirmation-title">
            <span aria-hidden="true">✓</span>
            <h1 id="submission-confirmation-title">Sent for review</h1>
            <p>
              This university is pending review. It will only appear in Athenvia after its details
              are checked.
            </p>
            <Link href="/home">Return home</Link>
          </section>
        </main>
        <MobileNavigation />
      </div>
    );
  }

  return (
    <div className={styles.appFrame}>
      <main className={styles.main}>
        <header className={styles.siteHeader}>
          <Brand />
        </header>

        <div className={styles.heading}>
          <p className={styles.eyebrow}>Help improve search</p>
          <h1>Add a missing university</h1>
          <p>
            Share the basic details and Athenvia will review them before the university appears in
            search.
          </p>
        </div>

        <PendingReviewExplanation />

        <form className={styles.form} noValidate onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="university-name">University name</label>
            <input
              id="university-name"
              name="universityName"
              type="text"
              autoComplete="organization"
              defaultValue={prefilledName}
              maxLength={120}
              required
              aria-describedby={fieldErrors.universityName ? "university-name-error" : undefined}
              aria-invalid={Boolean(fieldErrors.universityName)}
            />
            {fieldErrors.universityName ? (
              <p className={styles.fieldError} id="university-name-error" role="alert">
                {fieldErrors.universityName}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="university-country">Country</label>
            <input
              id="university-country"
              name="country"
              type="text"
              autoComplete="country-name"
              maxLength={80}
              required
              aria-describedby={
                fieldErrors.country ? "university-country-error" : "university-country-help"
              }
              aria-invalid={Boolean(fieldErrors.country)}
            />
            <p className={styles.fieldHelp} id="university-country-help">
              Enter the country’s full name.
            </p>
            {fieldErrors.country ? (
              <p className={styles.fieldError} id="university-country-error" role="alert">
                {fieldErrors.country}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="official-website">
              Official website <span>(optional)</span>
            </label>
            <input
              id="official-website"
              name="officialWebsite"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="url"
              maxLength={2_048}
              placeholder="https://www.university.edu"
              aria-describedby={
                fieldErrors.officialWebsite ? "official-website-error" : "official-website-help"
              }
              aria-invalid={Boolean(fieldErrors.officialWebsite)}
            />
            <p className={styles.fieldHelp} id="official-website-help">
              Add the university’s own website if you know it.
            </p>
            {fieldErrors.officialWebsite ? (
              <p className={styles.fieldError} id="official-website-error" role="alert">
                {fieldErrors.officialWebsite}
              </p>
            ) : null}
          </div>

          {result?.status === "unavailable" ? (
            <div className={styles.unavailable} role="alert">
              <h2>Submissions aren’t available yet</h2>
              <p>
                Your details were not sent or saved. Please keep them and try again when submissions
                open.
              </p>
            </div>
          ) : null}

          <div className={styles.actions}>
            <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Checking details…" : "Send for review"}
            </button>
            <Link className={styles.secondaryLink} href="/search">
              Back to search
            </Link>
          </div>
        </form>
      </main>
      <MobileNavigation />
    </div>
  );
}
