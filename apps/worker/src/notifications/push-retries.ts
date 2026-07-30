export const MAX_WEB_PUSH_ATTEMPTS = 3;
export const WEB_PUSH_RETRY_DELAYS_MILLISECONDS = [2_000, 4_000] as const;

export type PushFailureKind = "INDETERMINATE" | "INVALID_SUBSCRIPTION" | "PERMANENT" | "TRANSIENT";

export type PushDeliveryAttemptOutcome =
  { attempts: number; kind: "SENT" } | { attempts: number; kind: PushFailureKind };

export type PushRetrySleeper = (delayMilliseconds: number) => Promise<void>;

function statusCodeFrom(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return null;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
    ? statusCode
    : null;
}

/**
 * Classifies only the safe HTTP status exposed by web-push. Error bodies,
 * headers, endpoints and messages must never be returned or logged.
 *
 * Failures without a response are indeterminate rather than transient: the
 * push service may have accepted the request before the connection failed, so
 * retrying could deliver the same notification twice.
 */
export function classifyWebPushFailure(error: unknown): PushFailureKind {
  const statusCode = statusCodeFrom(error);
  if (statusCode === null) {
    return "INDETERMINATE";
  }
  if (statusCode === 404 || statusCode === 410) {
    return "INVALID_SUBSCRIPTION";
  }
  if (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode <= 599)
  ) {
    return "TRANSIENT";
  }
  return "PERMANENT";
}

const defaultSleeper: PushRetrySleeper = (delayMilliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMilliseconds);
  });

export async function deliverWebPushWithRetry(
  send: () => Promise<void>,
  sleeper: PushRetrySleeper = defaultSleeper,
): Promise<PushDeliveryAttemptOutcome> {
  for (let attempt = 1; attempt <= MAX_WEB_PUSH_ATTEMPTS; attempt += 1) {
    try {
      await send();
      return { attempts: attempt, kind: "SENT" };
    } catch (error) {
      const kind = classifyWebPushFailure(error);
      if (kind !== "TRANSIENT" || attempt === MAX_WEB_PUSH_ATTEMPTS) {
        return { attempts: attempt, kind };
      }
      await sleeper(WEB_PUSH_RETRY_DELAYS_MILLISECONDS[attempt - 1] ?? 0);
    }
  }

  throw new Error("Unreachable Web Push retry state.");
}
