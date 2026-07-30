"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MagicLinkForm() {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);

  async function requestMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending) {
      return;
    }

    setIsSending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");

    try {
      await signIn("email", {
        callbackUrl: "/home",
        email,
        redirect: false,
      });
    } catch {
      // Keep the result indistinguishable from a successful request.
    }

    router.push("/sign-in/check-email");
  }

  return (
    <form className="auth-form" onSubmit={requestMagicLink}>
      <label htmlFor="email">Email address</label>
      <input
        autoCapitalize="none"
        autoComplete="email"
        disabled={isSending}
        id="email"
        inputMode="email"
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />
      <button className="primary-button" disabled={isSending} type="submit">
        {isSending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
