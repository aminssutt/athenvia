import { publicDateCopy } from "@athenvia/contracts";

import type { PublicDateStatus } from "@athenvia/contracts";

import { ConfirmedIcon, ExpectedIcon, NotPublishedIcon } from "./component-icons";
import styles from "./product-components.module.css";

const STATUS_ICONS = {
  CONFIRMED: ConfirmedIcon,
  EXPECTED: ExpectedIcon,
  NOT_PUBLISHED: NotPublishedIcon,
} satisfies Record<PublicDateStatus, typeof ConfirmedIcon>;

type DateStatusProps = {
  status: PublicDateStatus;
  showDescription?: boolean;
};

export function DateStatus({ showDescription = false, status }: DateStatusProps) {
  const copy = publicDateCopy[status];
  const Icon = STATUS_ICONS[status];

  return (
    <div className={styles.dateStatus} data-status={status}>
      <Icon className={styles.dateStatusIcon} />
      <div>
        <p className={styles.dateStatusTitle}>{copy.title}</p>
        {showDescription ? (
          <p className={styles.dateStatusDescription}>{copy.description}</p>
        ) : null}
      </div>
    </div>
  );
}
