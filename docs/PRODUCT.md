# Product specification

## Promise

**Find a program. Follow it. Athenvia reminds you at the right time.**

Athenvia should feel like a calm reminder application, not an admissions CRM or an AI
product. A student should be able to follow a relevant program in under one minute.

## MVP journeys

1. Visit the landing page in mobile Safari.
2. Understand the product and install it from the share menu.
3. Open the installed PWA and complete at most two onboarding screens.
4. Search by university, program, location or domain.
5. Understand whether a date is confirmed, expected or not published.
6. Follow a program and enable reminders through an explicit action.
7. Open the official university source.
8. Submit a missing university or program for shared verification.

## Public date language

- **Confirmed by the university** — verified against the correct official intake source.
- **Expected date** — based on prior official cycles; never presented as official.
- **Not published yet** — no sufficiently reliable date is available.

Internal confidence values and extraction terminology are never shown to students.

## Non-goals

No social feed, admissions prediction, essay generation, ranking engine, chatbot,
payments, automatic applications, sensitive document storage, native application or
unrestricted crawling in the first MVP.

## Definition of simple

- One primary action per screen.
- Plain language and large touch targets.
- No dense table or dashboard.
- Progressive disclosure for secondary details.
- Empty and error states always suggest a next action.
- Push permission is never requested on first launch.
