import type { Instrumentation } from "next";

export function register(): void {
  // Next.js requires this lifecycle export even though Athenvia currently uses
  // its native request-error hook rather than an external SDK.
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { logCapturedRequestError } = await import("./lib/observability");
  logCapturedRequestError(error, request, context);
};
