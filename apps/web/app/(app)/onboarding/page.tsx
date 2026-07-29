import type { Metadata } from "next";

import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Set up Athenvia in two quick steps.",
};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
