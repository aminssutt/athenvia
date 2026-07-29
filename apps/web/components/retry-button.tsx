"use client";

import { RetryIcon } from "./component-icons";
import styles from "./product-components.module.css";

type RetryButtonProps = {
  label: string;
  onRetry: () => void;
};

export function RetryButton({ label, onRetry }: RetryButtonProps) {
  return (
    <button className={styles.retryButton} type="button" onClick={onRetry}>
      <RetryIcon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
