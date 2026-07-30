"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function GoogleSignInButton() {
  const [isRedirecting, setIsRedirecting] = useState(false);

  async function continueWithGoogle() {
    if (isRedirecting) {
      return;
    }

    setIsRedirecting(true);
    try {
      await signIn("google", { callbackUrl: "/home" });
    } catch {
      setIsRedirecting(false);
    }
  }

  return (
    <button
      className="google-auth-button"
      disabled={isRedirecting}
      onClick={continueWithGoogle}
      type="button"
    >
      {isRedirecting ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}
