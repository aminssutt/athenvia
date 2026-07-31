"use client";

import Link from "next/link";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { MobileNavigation } from "@/components/mobile-navigation";

import { programSubmissionApiTransport } from "./api-transport";
import styles from "./missing-program.module.css";
import {
  approvedDomains,
  degreeOptions,
  MissingProgramSubmissionSchema,
  submitMissingProgram,
} from "./submission";

import type { FormEvent } from "react";
import type { SubmissionResult, UniversityContext } from "./submission";

type MissingProgramFormProps = {
  university: UniversityContext;
};

type FieldErrors = Partial<Record<"degreeType" | "domain" | "officialUrl" | "programName", string>>;

function PendingReviewExplanation({ universityName }: { universityName: string }) {
  return (
    <aside className={styles.reviewNote} aria-labelledby="pending-review-title">
      <span className={styles.reviewIcon} aria-hidden="true">
        ✓
      </span>
      <div>
        <h2 id="pending-review-title">What happens after you send it?</h2>
        <p>
          Your suggestion enters pending review. Athenvia checks that it belongs to {universityName}{" "}
          before making anything public.
        </p>
      </div>
    </aside>
  );
}

export function MissingProgramForm({ university }: MissingProgramFormProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFieldErrors({});
    setResult(null);

    const formData = new FormData(form);
    const parsedSubmission = MissingProgramSubmissionSchema.safeParse({
      universityId: formData.get("universityId"),
      universityName: formData.get("universityName"),
      programName: formData.get("programName"),
      degreeType: formData.get("degreeType"),
      domain: formData.get("domain"),
      officialUrl: formData.get("officialUrl"),
    });

    if (!parsedSubmission.success) {
      const flattenedErrors = parsedSubmission.error.flatten().fieldErrors;
      setFieldErrors({
        degreeType: flattenedErrors.degreeType?.[0],
        domain: flattenedErrors.domain?.[0],
        officialUrl: flattenedErrors.officialUrl?.[0],
        programName: flattenedErrors.programName?.[0],
      });
      window.requestAnimationFrame(() => {
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setIsSubmitting(true);
    const submissionResult = await submitMissingProgram(
      parsedSubmission.data,
      programSubmissionApiTransport,
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
              This program is pending review. It will only appear after its university and details
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
          <h1>Add a missing program</h1>
          <p>Share the program’s basic details for review.</p>
        </div>

        <PendingReviewExplanation universityName={university.universityName} />

        <form className={styles.form} noValidate onSubmit={handleSubmit}>
          <input type="hidden" name="universityId" value={university.universityId} />

          <div className={styles.field}>
            <label htmlFor="university-name">University</label>
            <input
              className={styles.readonlyField}
              id="university-name"
              name="universityName"
              type="text"
              value={university.universityName}
              readOnly
              aria-describedby="university-help"
            />
            <p className={styles.fieldHelp} id="university-help">
              Selected from search. Return to search to choose another university.
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="program-name">Program name</label>
            <input
              id="program-name"
              name="programName"
              type="text"
              autoComplete="off"
              maxLength={160}
              required
              aria-describedby={fieldErrors.programName ? "program-name-error" : undefined}
              aria-invalid={Boolean(fieldErrors.programName)}
            />
            {fieldErrors.programName ? (
              <p className={styles.fieldError} id="program-name-error" role="alert">
                {fieldErrors.programName}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="degree-type">Degree</label>
            <select
              id="degree-type"
              name="degreeType"
              defaultValue=""
              required
              aria-describedby={fieldErrors.degreeType ? "degree-type-error" : undefined}
              aria-invalid={Boolean(fieldErrors.degreeType)}
            >
              <option value="">Choose a degree</option>
              {degreeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldErrors.degreeType ? (
              <p className={styles.fieldError} id="degree-type-error" role="alert">
                {fieldErrors.degreeType}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="program-domain">Domain</label>
            <select
              id="program-domain"
              name="domain"
              defaultValue=""
              required
              aria-describedby={fieldErrors.domain ? "program-domain-error" : undefined}
              aria-invalid={Boolean(fieldErrors.domain)}
            >
              <option value="">Choose a domain</option>
              {approvedDomains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </select>
            {fieldErrors.domain ? (
              <p className={styles.fieldError} id="program-domain-error" role="alert">
                {fieldErrors.domain}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label htmlFor="official-url">
              Official program URL <span>(optional)</span>
            </label>
            <input
              id="official-url"
              name="officialUrl"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="url"
              maxLength={2_048}
              placeholder="https://www.university.edu/program"
              aria-describedby={
                fieldErrors.officialUrl ? "official-url-error" : "official-url-help"
              }
              aria-invalid={Boolean(fieldErrors.officialUrl)}
            />
            <p className={styles.fieldHelp} id="official-url-help">
              Add the university’s own program page if you know it.
            </p>
            {fieldErrors.officialUrl ? (
              <p className={styles.fieldError} id="official-url-error" role="alert">
                {fieldErrors.officialUrl}
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
