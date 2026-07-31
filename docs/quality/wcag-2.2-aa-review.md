# WCAG 2.2 AA review

Issue: [P5-10] Complete the WCAG 2.2 AA review (#101)
Review date: 2026-07-31
Reviewed build: `agent/issue-99-observability` working tree, `apps/web` (Next.js App Router PWA)

## Scope

Core journeys, audited end to end:

1. Landing (`/`) → install explanation → privacy
2. Onboarding (`/onboarding`, two screens)
3. Search (`/search`, query + domain filters + result states)
4. Program detail (`/programs/[programId]`) including Follow + push-permission panel
5. Watchlist home (`/home`, watching / open now / applied + empty states)
6. Settings (`/settings`, notification preferences, unsubscribe, delete account)
7. Notifications history (`/notifications`)
8. Sign-in (`/sign-in`, magic link + Google) and `/sign-in/check-email`
9. Supporting screens: `/offline`, route-level `error.tsx` / `loading.tsx` states

Out of scope: `/admin` (internal back-office, not a student journey — should get its own
pass before any external operator uses it), email templates, push notification payloads.

## Methodology

- **Static audit** of every page and shared component under `apps/web/app/**`,
  `apps/web/components/**` and `packages/ui/src/**`: landmarks, heading hierarchy, form
  labels, `alt`/`aria-*` usage, focus management, keyboard operability, touch-target
  sizes (WCAG 2.2 SC 2.5.8, 24×24 px minimum), and `prefers-reduced-motion` coverage in
  all CSS modules.
- **Contrast computation** (WCAG relative-luminance formula) for every text/background
  and component/background pair defined in `packages/ui/src/tokens.css` and the CSS
  modules. Ratios quoted below are exact.
- **Dynamic audit** with Playwright against the dev server (`playwright.config.ts`
  webServer, `mobile-safari` / iPhone 13 project): keyboard traversal, focus-visible
  rendering, focus management on step changes, accessible names via the ARIA tree,
  target-size measurement, reduced-motion emulation. axe-core is not in the dependency
  tree, so all checks were performed manually through Playwright's role/ARIA APIs
  (no dependency was added, per the ticket constraints).
- **Durable regression tests** added in `apps/web/tests/e2e/accessibility.spec.ts`
  (17 tests, all passing).

Environment caveat: Playwright's WebKit iPhone emulation reproduces Safari's keyboard
model — Tab traverses form controls and buttons but never links. Link reachability was
therefore verified structurally (real `<a href>` elements, no negative or positive
`tabindex`) rather than by sequential tabbing. See “Remaining limitations”.

## Summary

The application is in very good accessibility shape: semantic landmarks on every screen,
labelled forms, correct `aria-current` navigation, visually-hidden-but-focusable radio
chips, focus moved to headings on onboarding step changes, live regions for async search
results, and per-animation `prefers-reduced-motion` overrides.

**Defect count: 0 blocking · 5 major · 7 minor.**

The five major defects are all small, well-localised fixes (two colour values, one CSS
rule, two focus-management patches). None blocks a release; all should be fixed before
declaring AA conformance.

## WCAG 2.2 AA criteria matrix

Journeys: L = Landing, O = Onboarding, S = Search, P = Program detail (incl. Follow),
H = Home/watchlist, ST = Settings, N = Notifications, A = Sign-in.

| SC            | Name                                   | Status | Notes                                                                                                                                                                                                                      |
| ------------- | -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.1         | Non-text content                       | ✅     | Icons `aria-hidden` + `focusable=false`; university logos `role="img"` with name, `alt=""` on the raw `<img>`; brand mark `alt=""` with adjacent text.                                                                     |
| 1.3.1         | Info and relationships                 | ⚠️     | Strong overall (`dl` for dates, `fieldset/legend`, labelled sections). Minor: landing phone mock exposes fake cards as real `h2` content (L); `aria-label` on generic elements (L, H, O); divider text hidden from SR (A). |
| 1.3.2         | Meaningful sequence                    | ✅     | DOM order matches visual order everywhere; nav is DOM-last so content reads first.                                                                                                                                         |
| 1.3.3         | Sensory characteristics                | ✅     | Instructions never rely on shape/position alone.                                                                                                                                                                           |
| 1.3.4         | Orientation                            | ✅     | No orientation lock.                                                                                                                                                                                                       |
| 1.3.5         | Identify input purpose                 | ✅     | `autocomplete="email"`, `organization`, `country-name`, `url` present.                                                                                                                                                     |
| 1.4.1         | Use of color                           | ✅     | Date status uses icon + text, not colour alone; nav current state uses underline + colour.                                                                                                                                 |
| 1.4.3         | Contrast (minimum)                     | ❌     | All body text passes (≥ 5.0:1) **except placeholders**: search placeholder `#97877e` on white = **3.45:1**; contribute placeholders `--text-secondary` at 0.8 opacity ≈ 3.7:1. See defect M1.                              |
| 1.4.4         | Resize text                            | ✅     | rem/em based layout, no fixed pixel text containers; shell reflows.                                                                                                                                                        |
| 1.4.5         | Images of text                         | ✅     | None used.                                                                                                                                                                                                                 |
| 1.4.10        | Reflow                                 | ✅     | Single-column mobile-first layout; filter row scrolls horizontally by design with `overscroll-behavior`.                                                                                                                   |
| 1.4.11        | Non-text contrast                      | ❌     | Focus ring 8.75:1 ✅, switch on-track 9.27:1 ✅, but form-input borders `#e9ded6` = **1.32:1** and switch off-track = **1.32:1**. See defects M2, M3.                                                                      |
| 1.4.12        | Text spacing                           | ✅     | No fixed-height text containers; line-height ≥ 1.35 throughout.                                                                                                                                                            |
| 1.4.13        | Content on hover or focus              | ✅     | No hover-triggered overlays.                                                                                                                                                                                               |
| 2.1.1         | Keyboard                               | ✅     | All controls are native `button`/`a`/`input`/`select`; chips are real radios (arrow-key verified); no `div onClick`.                                                                                                       |
| 2.1.2         | No keyboard trap                       | ✅     | Verified dynamically on sign-in; no focus traps exist (no modal dialogs in the product).                                                                                                                                   |
| 2.1.4         | Character key shortcuts                | ✅     | None registered.                                                                                                                                                                                                           |
| 2.2.1 / 2.2.2 | Timing / pause-stop-hide               | ✅     | No time limits; loading skeletons stop under reduced motion.                                                                                                                                                               |
| 2.3.1         | Three flashes                          | ✅     | No flashing content.                                                                                                                                                                                                       |
| 2.4.1         | Bypass blocks                          | ⚠️     | No skip link, but the repeated block (bottom nav) is DOM-last and headers are 1–2 tab stops, so content precedes repetition. Acceptable today; add a skip link as screens grow (defect m7).                                |
| 2.4.2         | Page titled                            | ✅     | Per-page `metadata.title` with template `%s · Athenvia`.                                                                                                                                                                   |
| 2.4.3         | Focus order                            | ❌     | Generally correct (onboarding heading focus is exemplary), but focus is dropped in the settings delete-account flow and after Follow. See defects M4, M5.                                                                  |
| 2.4.4         | Link purpose (in context)              | ✅     | Links self-describing; external source links announce “(opens in a new tab)”.                                                                                                                                              |
| 2.4.5         | Multiple ways                          | ✅     | Nav + search + direct links.                                                                                                                                                                                               |
| 2.4.6         | Headings and labels                    | ⚠️     | Labels are clear; `EmptyState` hard-codes `h2` which yields sibling `h2`s under section headings on Home (defect m2).                                                                                                      |
| 2.4.7         | Focus visible                          | ✅     | Global `:focus-visible` 3px solid ring (8.75:1); chip focus forwarded from hidden radio to visible span. Verified dynamically.                                                                                             |
| 2.4.11        | Focus not obscured (minimum)           | ✅     | Sticky bottom nav is the only overlay; focused elements scroll into view above it; the update notice is fixed but small and dismissible.                                                                                   |
| 2.5.1 / 2.5.2 | Pointer gestures / cancellation        | ✅     | No path-based gestures; all activations on up-event (native controls).                                                                                                                                                     |
| 2.5.3         | Label in name                          | ✅     | Accessible names contain the visible text (nav `aria-label` extends, not replaces, the label).                                                                                                                             |
| 2.5.4         | Motion actuation                       | ✅     | None.                                                                                                                                                                                                                      |
| 2.5.7         | Dragging movements                     | ✅     | None.                                                                                                                                                                                                                      |
| 2.5.8         | Target size (minimum)                  | ✅     | `--touch-target-min: 2.75rem` (44px) applied to buttons/links; nav links 52px tall (measured dynamically); switch 48×28px ≥ 24px.                                                                                          |
| 3.1.1 / 3.1.2 | Language                               | ✅     | `<html lang="en">`; all content English.                                                                                                                                                                                   |
| 3.2.1 / 3.2.2 | On focus / on input                    | ✅     | No context change on focus; domain-filter change refreshes results in place with a polite live region.                                                                                                                     |
| 3.2.3 / 3.2.4 | Consistent navigation / identification | ✅     | Identical nav and component vocabulary across screens.                                                                                                                                                                     |
| 3.2.6         | Consistent help                        | ✅     | No help mechanism yet (vacuously satisfied).                                                                                                                                                                               |
| 3.3.1         | Error identification                   | ✅     | Errors in text, `role="alert"`, `aria-invalid`, focus moved to first invalid field (contribute forms) or back to the input (search).                                                                                       |
| 3.3.2         | Labels or instructions                 | ✅     | Every field has a visible `<label>`; optional fields marked “(optional)”; help text linked with `aria-describedby`.                                                                                                        |
| 3.3.3 / 3.3.4 | Error suggestion / prevention          | ✅     | Suggestions provided; account deletion requires typed confirmation.                                                                                                                                                        |
| 3.3.7         | Redundant entry                        | ✅     | Contribute form pre-fills the university name from search context.                                                                                                                                                         |
| 3.3.8         | Accessible authentication (minimum)    | ✅     | Magic link + OAuth; no password, no cognitive test.                                                                                                                                                                        |
| 4.1.2         | Name, role, value                      | ⚠️     | Switches (`role="switch"` + `aria-checked`), live regions and statuses are correct. Minor: `aria-label` on generic `p`/`div`/`span` elements is unreliable (defect m3); switch labels duplicate state (defect m6).         |
| 4.1.3         | Status messages                        | ✅     | `role="status"`/`role="alert"`/polite live regions for search results, follow confirmation, settings notices.                                                                                                              |

## Defects

### Blocking

None.

### Major

**M1 — Placeholder text fails contrast (SC 1.4.3)**

- `apps/web/components/program-search.module.css:65` — placeholder `#97877e` on white
  = 3.45:1 (needs 4.5:1).
- `apps/web/app/(app)/contribute/university/missing-university.module.css:121-124` (and
  the mirrored rule in `missing-program.module.css`) — `--text-secondary` at
  `opacity: 0.8` ≈ 3.7:1 on white.
- `apps/web/components/magic-link-form.tsx:44` — placeholder `you@example.com` uses the
  browser default placeholder grey on `--background` (unstyled, typically < 4.5:1).
- Recommendation: use `--text-secondary` (`#74645b`, 5.65:1 on white) at full opacity
  for all placeholders, or introduce a `--text-placeholder` token validated at ≥ 4.5:1.

**M2 — Form input boundaries fail non-text contrast (SC 1.4.11)**

- `apps/web/app/globals.css:288` (`.auth-form input`),
  `apps/web/app/(app)/contribute/university/missing-university.module.css:113`,
  `apps/web/app/(app)/contribute/program/missing-program.module.css` (same rule), and
  `apps/web/components/program-search.module.css:23` — `border: 1px solid #e9ded6`
  on white/`#fbf8f4` = **1.32:1**; the border is the only boundary indicator
  (backgrounds are white-on-cream ≈ 1.05:1).
- Recommendation: darken the input border to a ≥ 3:1 value (e.g. a new
  `--border-strong` ≈ `#a08e83`) for form controls only, keeping `--border-soft` for
  decorative card borders (which are exempt).

**M3 — Switch off-state track fails non-text contrast (SC 1.4.11)**

- `apps/web/app/(app)/settings/settings.module.css:256` — off-state track
  `--border-soft` (`#e9ded6`) on the white card = **1.32:1**. The on-state
  (`#5f4032`, 9.27:1) is fine, so the off/on visual difference is carried almost
  entirely by a low-contrast element; the knob shadow is the only other cue.
- Recommendation: darker off-track (≥ 3:1, e.g. `#8f7f76`) or a 1px ≥ 3:1 inset border
  on the track.

**M4 — Focus is dropped in the delete-account flow (SC 2.4.3)**

- `apps/web/app/(app)/settings/settings-client.tsx:472-515` — activating “Delete my
  account” unmounts the focused button and renders the confirmation panel: keyboard
  focus falls back to `<body>`. “Cancel” unmounts the panel with the same result.
- Recommendation: on open, move focus to `#delete-confirmation`; on cancel, restore it
  to the “Delete my account” button (same `requestAnimationFrame` pattern already used
  in `onboarding-flow.tsx` and `push-permission-onboarding.tsx`).

**M5 — Focus is dropped after “Follow this program” (SC 2.4.3)**

- `apps/web/app/(app)/programs/[programId]/follow-program.tsx:103-113` — on activation
  the focused button becomes `disabled`, which drops keyboard focus to `<body>`. The
  confirmation is announced via the live region, but a keyboard user loses their place
  right before the push-permission panel appears.
- Recommendation: when `phase` becomes `"followed"`, focus `followStatusRef` (it already
  has `tabIndex={-1}` and is passed to the push panel as the return-focus target); or
  use `aria-disabled` instead of `disabled` during the optimistic phase.

### Minor

**m1 — Landing phone mock pollutes the reading order (SC 1.3.1)**
`apps/web/app/(landing)/page.tsx:69-123` — the decorative iPhone preview exposes two
fake program cards as genuine content, including `h2` headings (“MSc Venture Creation”,
“MSc Data Science”) that appear in the page outline before the real “Keep Athenvia one
tap away.” heading. Recommendation: `aria-hidden="true"` on the phone interior and a
visually-hidden one-sentence description of the preview.

**m2 — `EmptyState` hard-codes `h2` (SC 1.3.1 / 2.4.6)**
`apps/web/components/interface-state.tsx:63` — on Home each watchlist `section` already
has an `h2`, so its empty state renders a sibling `h2` that reads as a new top-level
section. Recommendation: add a `headingLevel` prop (default `h2`) and pass `h3` from
`WatchlistSection`.

**m3 — `aria-label` on generic elements (SC 4.1.2 / ARIA misuse)**
`aria-label` is not supported on elements with a generic role and is inconsistently
honoured: `apps/web/app/(landing)/page.tsx:69` (`div aria-label="Athenvia app preview"`),
`apps/web/app/(app)/home/page.tsx:61` (`span aria-label` for the program count),
`apps/web/app/(app)/onboarding/onboarding-flow.tsx:114` (`p aria-label="Step 1 of 2"`,
which additionally would override the useful visually-hidden text if honoured).
Recommendation: replace with visually-hidden text (already present in onboarding — just
remove the `aria-label`) or an appropriate role.

**m4 — “or continue with email” hidden from screen readers (SC 1.3.1)**
`apps/web/app/(auth)/sign-in/page.tsx:31-33` — the divider carries `aria-hidden="true"`
but contains meaningful text distinguishing the two sign-in paths. Recommendation: keep
the decorative lines hidden, expose the text.

**m5 — Global reduced-motion override misses `animation-duration`**
`apps/web/app/globals.css:457-464` resets `transition-duration` and `scroll-behavior`
only. Today every `@keyframes` user ships its own `prefers-reduced-motion` override
(skeleton stops, onboarding spinner stops, settings spinner slows to 2s), so there is no
user-facing failure — but the global safety net silently fails for the next animation
someone adds. Recommendation: add `animation-duration: 0.01ms !important;
animation-iteration-count: 1 !important;` to the global block (keeping deliberate
essential-spinner exceptions local).

**m6 — Switch labels duplicate state (SC 4.1.2, verbosity)**
`apps/web/app/(app)/settings/settings-client.tsx:317,336,381` — `aria-label="Date
changes: on"` plus `aria-checked` makes VoiceOver announce the state twice (“Date
changes: on, switch, on”), and the label text changes with state. Recommendation: label
with the preference name only (ideally `aria-labelledby` pointing at the row heading)
and let `role="switch"` + `aria-checked` convey state.

**m7 — No skip link (SC 2.4.1, preventive)**
The bottom nav being DOM-last makes bypass blocks pass today, but any future top nav or
richer headers will need `<a class="skip-link" href="#main">`. Recommendation: add one
pre-emptively in `apps/web/app/layout.tsx` with an `id="main"` target on each `main`.

## Positive findings worth preserving

- Focus is moved to the new heading on onboarding step changes (`tabIndex={-1}` +
  `requestAnimationFrame`) — the regression test now locks this in.
- Domain filter chips are real radio inputs, visually hidden with the clip pattern (not
  `display:none`), with focus forwarded to the visible chip — fully arrow-key operable.
- Search exposes a dedicated polite live region for loading / result-count / no-result
  announcements, kept separate from the visual panels.
- The push-permission panel is a non-modal `aside` with `aria-live="polite"` and returns
  focus on close — no fake modal, no focus trap to get wrong.
- Every interactive control meets the 44px internal touch-target convention, well above
  the 24px WCAG 2.2 minimum.
- External official-source links announce “(opens in a new tab)” via visually hidden
  text.

## Automated regression coverage

`apps/web/tests/e2e/accessibility.spec.ts` (runs in the existing `mobile-safari`
Playwright project; 17 tests):

- Landing: single `main`, single `h1`, in-page install anchor integrity, links opted
  into the tab order, no positive `tabindex`, reduced-motion transition collapse.
- Onboarding: keyboard-only completion, focus moved to headings on forward/backward
  step changes, labelled + described select.
- Search: labelled searchbox, fieldset/legend filter group, arrow-key radio operation,
  chip focus forwarding, visible focus indicator on keyboard Tab, clear-button
  accessible name + focus return, too-short-query error focus return.
- App navigation: labelled `nav` landmark, `aria-current="page"`, ≥ 24px target size
  measured per link.
- Sign-in: labelled email field, autocomplete purpose, no keyboard trap.
- Home / Notifications / Settings anonymous states: landmark structure and labelled
  sign-in actions (empty states are real screens and are asserted as such).

## Remaining limitations

- **No real screen-reader pass yet.** VoiceOver on iOS (the primary platform for this
  PWA, including standalone mode) and TalkBack on Android must be tested on device —
  in particular the search live region, the follow → push-permission announcement
  sequence, and the settings switches. This cannot be automated here.
- **Link tabbing under WebKit emulation.** Playwright's WebKit reproduces Safari's
  default of skipping links on Tab, so cross-page sequential tab order through links is
  asserted structurally, not behaviourally. A desktop Chromium project (or a manual
  Firefox/Chrome pass) would exercise it directly; on iOS itself, users navigate by
  VoiceOver swipe or Full Keyboard Access.
- **Data-rich states.** The dev database had no seeded catalogue during this review, so
  program detail, populated watchlists and notification history were audited statically
  (code-level) and their empty states dynamically. Re-run the dynamic pass with seed
  data once available (the Follow flow, `DateStatus` in results, history cards).
- **axe-core.** Not in the dependency tree; adding `@axe-core/playwright` in a future PR
  would cheaply widen rule coverage (this review's manual checks cover the high-value
  rules but not axe's long tail).
- `/admin` review queue is unaudited (out of student scope).

## Suggested fix batches (separate PRs)

1. **Colour tokens** (M1 + M2 + M3): add `--text-placeholder` and `--border-strong`
   tokens, apply to inputs and the switch track. Pure CSS, no behaviour change.
2. **Focus management** (M4 + M5): two small patches in `settings-client.tsx` and
   `follow-program.tsx` following the existing `requestAnimationFrame` focus pattern.
3. **Semantics polish** (m1–m4, m6): `aria-hidden` on the landing mock, `EmptyState`
   heading level prop, remove misplaced `aria-label`s, expose the divider text, simplify
   switch labels.
4. **Hardening** (m5, m7): global `animation-duration` reduced-motion rule, skip link.
