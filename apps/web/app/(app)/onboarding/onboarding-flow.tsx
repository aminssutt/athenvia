"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Brand } from "@/components/brand";

import styles from "./onboarding.module.css";
import {
  isTargetIntake,
  readStoredOnboarding,
  saveStoredOnboarding,
  targetIntakeOptions,
} from "./onboarding-storage";

import type { FormEvent } from "react";
import type { TargetIntake } from "./onboarding-storage";

type Step = 1 | 2;

function IntroIllustration() {
  return (
    <div className={styles.introIllustration} aria-hidden="true">
      <span className={styles.calendar}>
        <span />
        <strong>14</strong>
      </span>
      <span className={styles.reminderDot}>✓</span>
    </div>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>(1);
  const [targetIntake, setTargetIntake] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedOnboarding = readStoredOnboarding(window.localStorage);

      if (storedOnboarding?.completed) {
        router.replace("/home");
        return;
      }
    } catch {
      setStorageUnavailable(true);
    }

    setIsReady(true);
  }, [router]);

  function moveToStep(nextStep: Step) {
    setStep(nextStep);
    setValidationMessage(null);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function continueWithoutSaving() {
    router.replace("/home");
  }

  function finish(selectedIntake: TargetIntake | null) {
    if (storageUnavailable) {
      continueWithoutSaving();
      return;
    }

    try {
      saveStoredOnboarding(window.localStorage, selectedIntake);
      router.replace("/home");
    } catch {
      setStorageUnavailable(true);
      setValidationMessage(
        "We couldn’t save this choice on your device. You can still continue without saving.",
      );
    }
  }

  function handleIntakeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationMessage(null);

    if (!targetIntake) {
      finish(null);
      return;
    }

    if (!isTargetIntake(targetIntake)) {
      setValidationMessage("Choose an intake from the list, or leave it blank.");
      return;
    }

    finish(targetIntake);
  }

  if (!isReady) {
    return (
      <main className={styles.loading} aria-busy="true" aria-label="Loading onboarding">
        <span aria-hidden="true" />
        <p className={styles.visuallyHidden}>Loading Athenvia</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Brand />
        <p className={styles.progress} aria-label={`Step ${step} of 2`}>
          <span data-current={step === 1 || undefined} />
          <span data-current={step === 2 || undefined} />
          <span className={styles.progressText}>Step {step} of 2</span>
        </p>
      </header>

      {/* key={step} makes React remount the section on a step change instead of
          patching the existing one, which is what lets the CSS entrance in
          .screen replay. It is the whole step transition: no animation library,
          no extra state, and the heading focus in moveToStep still runs after
          the new node is committed. */}
      {step === 1 ? (
        <section key="intro" className={styles.screen} aria-labelledby="onboarding-intro-title">
          <IntroIllustration />
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Welcome to Athenvia</p>
            <h1 id="onboarding-intro-title" ref={headingRef} tabIndex={-1}>
              Keep application dates within reach.
            </h1>
            <p>
              Follow the programs you care about. Athenvia keeps their opening dates and deadlines
              in one calm place.
            </p>
          </div>

          {validationMessage ? (
            <p className={styles.validationMessage} role="alert">
              {validationMessage}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button className={styles.primaryButton} type="button" onClick={() => moveToStep(2)}>
              Get started
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={storageUnavailable ? continueWithoutSaving : () => finish(null)}
            >
              {storageUnavailable ? "Continue without saving" : "Skip for now"}
            </button>
          </div>
        </section>
      ) : (
        <section key="intake" className={styles.screen} aria-labelledby="onboarding-intake-title">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Make dates more relevant</p>
            <h1 id="onboarding-intake-title" ref={headingRef} tabIndex={-1}>
              When do you plan to start?
            </h1>
            <p>This is optional. You can continue without choosing an intake.</p>
          </div>

          <form className={styles.form} noValidate onSubmit={handleIntakeSubmit}>
            <div className={styles.field}>
              <label htmlFor="target-intake">
                Target intake <span>(optional)</span>
              </label>
              <select
                id="target-intake"
                name="targetIntake"
                value={targetIntake}
                aria-describedby="target-intake-help"
                aria-invalid={Boolean(validationMessage)}
                onChange={(event) => {
                  setTargetIntake(event.target.value);
                  setValidationMessage(null);
                }}
              >
                <option value="">Not sure yet</option>
                {targetIntakeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p id="target-intake-help">Saved only on this device. No account needed.</p>
            </div>

            {validationMessage ? (
              <p className={styles.validationMessage} role="alert">
                {validationMessage}
              </p>
            ) : null}

            <div className={styles.actions}>
              <button className={styles.primaryButton} type="submit">
                Continue to Athenvia
              </button>
              {storageUnavailable ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={continueWithoutSaving}
                >
                  Continue without saving
                </button>
              ) : (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => finish(null)}
                >
                  Skip this step
                </button>
              )}
              <button className={styles.backButton} type="button" onClick={() => moveToStep(1)}>
                Back
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
