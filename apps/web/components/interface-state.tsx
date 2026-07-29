"use client";

import { interfaceStateCopy } from "@athenvia/ui";
import type { ReactNode } from "react";

import { EmptyIcon, ErrorIcon } from "./component-icons";
import styles from "./product-components.module.css";
import { RetryButton } from "./retry-button";

type SharedStateProps = {
  description?: string;
  title?: string;
};

type LoadingStateProps = SharedStateProps & {
  compact?: boolean;
};

type EmptyStateProps = SharedStateProps & {
  action: ReactNode;
};

type ErrorStateProps = SharedStateProps & {
  onRetry: () => void;
  retryLabel?: string;
};

export function LoadingState({
  compact = false,
  description = interfaceStateCopy.loading.description,
  title = interfaceStateCopy.loading.title,
}: LoadingStateProps) {
  return (
    <div
      className={styles.interfaceState}
      data-compact={compact || undefined}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className={styles.loadingPreview} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <p className={styles.interfaceStateTitle}>{title}</p>
        <p className={styles.interfaceStateDescription}>{description}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  action,
  description = interfaceStateCopy.empty.description,
  title = interfaceStateCopy.empty.title,
}: EmptyStateProps) {
  return (
    <section className={styles.interfaceState}>
      <EmptyIcon className={styles.interfaceStateIcon} aria-hidden="true" />
      <div>
        <h2 className={styles.interfaceStateTitle}>{title}</h2>
        <p className={styles.interfaceStateDescription}>{description}</p>
      </div>
      <div className={styles.interfaceStateAction}>{action}</div>
    </section>
  );
}

export function ErrorState({
  description = interfaceStateCopy.error.description,
  onRetry,
  retryLabel = interfaceStateCopy.error.retryLabel,
  title = interfaceStateCopy.error.title,
}: ErrorStateProps) {
  return (
    <section className={styles.interfaceState} role="alert">
      <ErrorIcon className={styles.interfaceStateIcon} aria-hidden="true" />
      <div>
        <h2 className={styles.interfaceStateTitle}>{title}</h2>
        <p className={styles.interfaceStateDescription}>{description}</p>
      </div>
      <div className={styles.interfaceStateAction}>
        <RetryButton label={retryLabel} onRetry={onRetry} />
      </div>
    </section>
  );
}
