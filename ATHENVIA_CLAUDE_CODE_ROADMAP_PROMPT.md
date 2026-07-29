# Claude Code prompt: Athenvia roadmap + GitHub board setup

Copy everything below into Claude Code or Codex.

---

You are setting up a complete, parallel-safe product roadmap and a GitHub Project board for **Athenvia**, a minimalist university application tracking PWA.

Athenvia helps students discover Master, MBA and PhD programs, follow application opening dates and deadlines, and receive reminders before they need to act. The product must feel simple enough for a teenager to understand immediately, while the backend handles complex data verification, shared enrichment and notifications invisibly.

The roadmap must be implementation-ready, divided into small GitHub issues, and designed so several contributors can work in parallel without blocking each other or editing the same files.

## CRITICAL control rule — read first

Do **not** create, push, edit or delete anything on GitHub until I have reviewed and explicitly approved the full plan.

### Step 1 — review only

Produce one complete review document containing:

1. the proposed `ROADMAP.md` content;
2. the complete list of proposed GitHub issues;
3. each issue title;
4. its body;
5. two to five acceptance criteria;
6. its workstream label;
7. its phase label;
8. its priority;
9. its assignee or `TBD` if no username is available;
10. its dependencies;
11. the files or folders it is allowed to modify.

Then **STOP** and wait for my explicit approval.

### Step 2 — execution only after approval

Only after I reply exactly with approval should you:

- create or update repository artifacts;
- create labels;
- create GitHub issues;
- assign issues;
- create the GitHub Project board;
- add issues to the board;
- configure board fields and views.

Never run a state-changing `gh` command before approval. Read-only commands such as `gh auth status`, `gh repo view`, `gh issue list` and `gh project list` are allowed.

## Existing repository context

Before proposing anything:

1. inspect the current repository;
2. read any file matching `README*`, `ROADMAP*`, `PLAN*`, `ARCHITECTURE*`, `SPEC*`, `PRD*` or `docs/**/*`;
3. inspect the existing directory structure and package manager;
4. inspect existing database, deployment and CI configuration;
5. use existing project documentation as the source of truth when it conflicts with this prompt;
6. state in one short paragraph what existing structure you reused.

Do not overwrite a working architecture merely to match this prompt. Explain any proposed deviation before implementing it.

# Project context: Athenvia

## Product promise

> **Find a program. Follow it. Athenvia reminds you at the right time.**

Athenvia is not meant to feel like an AI product, a complex admissions dashboard or a professional CRM. It should feel like a calm, elegant reminder app for students.

The user-facing product must hide all technical complexity.

## Target users

- students aged approximately 16 to 25;
- students preparing applications for Master, MBA or PhD programs;
- international students comparing universities across countries;
- users who do not want to manually revisit university websites every week.

## Initial use case

A student finishes their current diploma in July 2027 and wants to follow programs beginning between August and October 2027.

They should be able to:

1. search for a university;
2. select a domain such as entrepreneurship, applied AI or robotics;
3. see matching programs;
4. understand when applications open and close;
5. see whether a date is confirmed, expected or not yet published;
6. add the program to their personal list;
7. receive a reminder before the application opens;
8. receive reminders before the deadline;
9. open the official university page directly;
10. contribute a missing university or program so future users benefit from it.

# Brand and visual direction

## Name

**Athenvia**

The name combines:

- **Athena**, associated with wisdom and strategic guidance;
- **via**, meaning a path or route.

Brand meaning:

> **A clear path toward the next stage of your education.**

Working tagline:

> **Your path to what’s next.**

## Visual style

The interface must be:

- minimalist;
- warm;
- clean;
- mobile-first;
- calm rather than corporate;
- simple enough for a teenager;
- spacious, with very little visual noise;
- free of visible AI terminology;
- free of dense graphs, scores and unnecessary statistics.

## Color direction

Use a warm white and milk-chocolate palette.

Suggested tokens:

```css
--background: #fbf8f4;
--surface: #ffffff;
--surface-soft: #f5eee8;
--chocolate: #8b624a;
--chocolate-dark: #5f4032;
--chocolate-light: #c8a892;
--text-primary: #2a211d;
--text-secondary: #74645b;
--border-soft: #e9ded6;
--success-soft: #e7f1e8;
--warning-soft: #f5ebd8;
--danger-soft: #f5e2df;
```

Do not use these exact values blindly if the repository already contains a coherent design system. Preserve the intention: **warm white, milk chocolate, soft neutrals and high readability**.

## Logo direction

Athenvia should use a simple symbol that can work as:

- a browser favicon;
- an iPhone home-screen icon;
- a small university tracker logo;
- a monochrome mark.

Preferred concepts:

- a path forming a subtle `A`;
- a four-point guiding star;
- a minimal doorway or passage;
- a path moving toward a star.

Avoid:

- detailed Greek mythology illustrations;
- an owl mascot in the MVP;
- graduation-cap clichés;
- complex crests;
- literal AI sparkles;
- gradients that reduce clarity.

# Product surface rules

## Public website

The normal browser website contains only a very simple landing experience.

It must include:

1. Athenvia logo and name;
2. one short explanation;
3. one small visual preview of the app;
4. a primary call to action to install the app;
5. an iPhone installation tutorial;
6. a short privacy link;
7. optionally a minimal FAQ.

Suggested landing copy:

> **Never miss an application date.**
>
> Follow the programs that matter to you and get reminded before applications open or close.

The landing page must not become a marketing site with multiple long sections.

## Installed PWA

The full application is intended to be used from the iPhone home screen.

When the app is opened in normal mobile Safari and is not installed:

- show the landing page;
- detect that the app is not running in standalone mode;
- display a clear three-step installation tutorial;
- do not expose the full application flow by default.

Suggested tutorial:

1. Tap the Safari share button.
2. Choose **Add to Home Screen**.
3. Open Athenvia from the new icon.

When the PWA is opened in standalone mode:

- show onboarding on first launch;
- then show the full application.

Desktop behavior may show a lightweight preview and installation explanation, but the primary experience remains mobile-first.

# Core UX principles

1. One clear action per screen.
2. Use plain language.
3. Never show internal confidence numbers to users.
4. Never expose scraping, extraction, workers or AI terminology.
5. Never present an estimated date as official.
6. Avoid long forms.
7. Use large touch targets.
8. Prefer cards and progressive disclosure over dense tables.
9. A user should be able to follow a program in under one minute.
10. Every date must link back to an official source when available.

# User-facing information statuses

The backend may contain detailed provenance and confidence metadata, but the UI only exposes three simple states.

## Confirmed

Display:

> **Confirmed by the university**

Use when the correct intake date was found on an official university source.

## Expected

Display:

> **Expected date**
>
> The university has not published the official date yet.

Use when the system has a reasonable estimate based on prior official cycles.

## Not published

Display:

> **Not published yet**
>
> We’ll let you know when the university updates it.

Do not display an exact estimated day when evidence is weak. A month or season is safer.

# Core user flows

## Flow A — onboarding

1. User opens the installed PWA.
2. Athenvia introduces the product in one or two screens maximum.
3. User chooses an optional target intake period.
4. User can continue without creating a complex profile.
5. Push permission is requested only after the user follows their first program.

Do not request notification permission immediately on first launch.

## Flow B — discover a university

1. User taps **Add a program**.
2. User sees a large search field: `Which university are you interested in?`
3. Search supports official names and aliases.
4. User selects a university.
5. User selects a simple domain chip:
   - Entrepreneurship
   - Artificial intelligence
   - Robotics
   - Computer science
   - Management
   - Other
6. Athenvia displays matching programs.

Search should also support direct program queries such as:

- `KAIST entrepreneurship`
- `robotics Singapore`
- `NUS venture creation`
- `AI master London`

## Flow C — program details

A program page should show only the most useful information:

- university logo;
- university name;
- program name;
- degree type;
- location;
- duration;
- intake;
- application opening;
- next deadline;
- information status;
- official source link;
- one main button: **Follow this program**.

Do not display a large statistics dashboard.

## Flow D — follow a program

When the user taps **Follow this program**:

1. add the program and intake to their watchlist;
2. enable default reminder rules;
3. ask for push notification permission through a user action;
4. confirm with a short success state;
5. allow the user to change reminders later.

Default reminders:

### Application opening

- 30 days before;
- 7 days before;
- on opening day.

### Deadline

- 30 days before;
- 14 days before;
- 7 days before;
- 2 days before.

If a date is only expected, notification copy must say that it is expected.

## Flow E — personal list

The main screen contains three simple sections:

### Watching

Programs whose applications are not open yet.

### Open now

Programs currently accepting applications.

### Applied

Programs the user has marked as submitted.

Each card should contain:

- logo;
- program name;
- university;
- next useful date;
- simple status;
- one tap to open details.

## Flow F — add a missing university

When no university matches:

1. show `We don’t have this university yet.`;
2. offer **Add university**;
3. prefill the typed name;
4. ask for country;
5. ask for an optional official website;
6. create a shared pending university record;
7. tell the user the system will look for programs;
8. notify them when useful data becomes available.

The newly submitted university becomes reusable by all users after validation.

## Flow G — add a missing program

If the university exists but the program does not:

1. offer **Add program**;
2. prefill the university;
3. ask for program name;
4. ask for degree type;
5. ask for domain;
6. ask for an optional official program URL;
7. create a pending shared record;
8. trigger the discovery and verification workflow.

# Shared enrichment model

Athenvia starts with a curated sample dataset and grows as users add universities and programs.

## Public shared data

Shared between all users:

- universities;
- aliases;
- university logos;
- programs;
- domains;
- intakes;
- application windows;
- official sources;
- confirmed dates;
- expected dates;
- verification history.

## Private user data

Private to each user:

- followed programs;
- application status;
- personal reminder preferences;
- private notes;
- push subscriptions;
- notification history.

A user must never see another user’s private watchlist or notes.

# Initial sample dataset

Seed a focused, high-quality sample rather than thousands of incomplete records.

Start with approximately 20 universities and 40 to 60 programs.

## Asia

- National University of Singapore
- KAIST
- Nanyang Technological University
- Singapore Management University
- University of Hong Kong
- HKUST
- Tsinghua University
- Seoul National University

## Europe

- HEC Paris
- École Polytechnique
- Imperial College London
- University of Oxford
- University of Cambridge
- ETH Zürich
- EPFL
- University College London

## North America

- UCLA
- University of California, Berkeley
- Columbia University
- MIT
- Cornell Tech

Initial domains:

- Entrepreneurship
- Applied AI
- Physical AI
- Robotics
- Computer Science
- Data Science
- Management
- MBA
- PhD

Every seeded date must contain a source and verification state. Do not seed unsupported exact dates merely to fill the interface.

# Technology stack

Use the existing repository stack when already established. Otherwise use the following default architecture.

## Monorepo

Use a TypeScript monorepo.

Preferred structure:

```text
/apps
  /web
  /worker
/packages
  /database
  /contracts
  /ui
  /config
/data
  /seed
/docs
/scripts
```

Recommended tooling:

- pnpm workspaces;
- Turborepo if useful, but do not add it without a clear need;
- strict TypeScript;
- ESLint;
- Prettier;
- Vitest;
- Playwright for end-to-end testing.

## Web application

- Next.js with App Router;
- TypeScript;
- Tailwind CSS;
- shadcn/ui where it helps, without making the app look generic;
- server actions or route handlers for simple application APIs;
- Serwist or a well-maintained service-worker setup for PWA behavior;
- responsive mobile-first layouts;
- `display: standalone` web app manifest;
- home-screen icons and splash assets.

## Database

- PostgreSQL 16 or newer;
- Prisma ORM;
- SQL migrations committed to the repository;
- generated Prisma client isolated in `/packages/database`;
- database constraints for uniqueness and referential integrity;
- PostgreSQL full-text and trigram search where useful;
- no Supabase dependency.

## Background jobs

- Redis;
- BullMQ;
- a separate worker app;
- scheduled source checks;
- discovery jobs;
- parsing jobs;
- change-detection jobs;
- notification delivery jobs;
- retry and dead-letter behavior.

## Notifications

- Web Push using VAPID keys;
- push subscriptions stored securely;
- notification scheduling performed server-side;
- iOS PWA compatibility;
- notifications deep-link to the relevant program or intake;
- duplicate-delivery protection;
- user-visible notification history.

## Source retrieval and parsing

Use:

- normal HTTP fetching first;
- Cheerio for HTML parsing;
- Playwright only for pages requiring client-side rendering;
- PDF parsing for official admissions PDFs;
- structured deterministic date parsing;
- no autonomous web crawling outside approved official domains;
- per-domain rate limiting;
- robots.txt and reasonable request frequency;
- source content hashing to detect changes.

AI-assisted extraction may be added later behind a feature flag, but the MVP must not depend on it. No extracted date may be published solely because an LLM suggested it.

## Authentication

Keep authentication lightweight.

Preferred options:

- email magic link;
- passkey later;
- anonymous local onboarding may be supported before account creation;
- require account creation before syncing push subscriptions across devices.

Do not create a long registration form.

## Deployment

The roadmap should propose a deployment architecture but must not provision it before approval.

Possible setup:

- Next.js web app on Vercel or a container platform;
- PostgreSQL on a managed PostgreSQL provider;
- Redis on a managed Redis provider;
- worker on Railway, Render, Fly.io or an equivalent always-on service;
- object storage for page snapshots and logo files if required.

Do not couple core code to a single hosting provider.

# PostgreSQL domain model

Use a schema that supports provenance, revisions and shared contributions.

## Core tables

### users

```text
id
email
name
created_at
updated_at
```

### universities

```text
id
name
normalized_name
country_code
city
official_domain
official_website
logo_asset_id
status
created_by_user_id
created_at
updated_at
```

### university_aliases

```text
id
university_id
alias
normalized_alias
```

### programs

```text
id
university_id
name
normalized_name
degree_type
duration_months
campus
language
official_url
status
created_by_user_id
created_at
updated_at
```

### domains

```text
id
slug
name
```

### program_domains

```text
program_id
domain_id
```

### intakes

```text
id
program_id
year
month
start_date
status
created_at
updated_at
```

### application_windows

```text
id
intake_id
round_name
opens_at
closes_at
public_status
confidence_score
last_verified_at
created_at
updated_at
```

`confidence_score` remains internal. The user-facing mapping is:

- `CONFIRMED`;
- `EXPECTED`;
- `NOT_PUBLISHED`.

### sources

```text
id
university_id
program_id
url
source_type
is_official
last_checked_at
http_status
content_hash
created_at
updated_at
```

### source_snapshots

```text
id
source_id
storage_key
content_hash
captured_at
```

### data_revisions

```text
id
entity_type
entity_id
field_name
old_value
new_value
source_id
change_status
confidence_score
created_by_user_id
created_by_worker
created_at
reviewed_at
```

### user_watchlists

```text
id
user_id
program_id
intake_id
tracking_status
priority
created_at
updated_at
```

### notification_preferences

```text
id
watchlist_id
before_open_days
before_deadline_days
notify_on_open
notify_on_date_change
push_enabled
created_at
updated_at
```

### push_subscriptions

```text
id
user_id
endpoint
p256dh
auth
user_agent
created_at
revoked_at
```

### notification_deliveries

```text
id
user_id
watchlist_id
notification_type
scheduled_for
sent_at
status
dedupe_key
error_message
```

### university_submissions

```text
id
submitted_by_user_id
name
country_code
official_website
status
created_at
reviewed_at
```

### program_submissions

```text
id
submitted_by_user_id
university_id
name
degree_type
official_url
status
created_at
reviewed_at
```

The exact schema may be improved during planning, but the following capabilities are mandatory:

- shared additions;
- deduplication;
- source provenance;
- history instead of destructive overwrites;
- private watchlists;
- scheduled reminders;
- multiple rounds per intake.

# Reliability rules

## Never invent missing dates

If the official date is absent:

- store no exact confirmed date;
- optionally store an expected month or range;
- mark it as expected;
- explain internally which prior cycles support the estimate.

## Never overwrite without revision history

When a date changes:

1. create a revision;
2. preserve the previous value;
3. attach the source;
4. update the current canonical value only after validation;
5. notify affected users when the change matters.

## Validation levels

Internal states may include:

```text
OFFICIAL
VERIFIED
EXPECTED
COMMUNITY_SUBMITTED
CONFLICTING
OUTDATED
UNKNOWN
```

Only the simplified public states are shown in the user interface.

## Source priority

Use this priority order:

1. official program page for the correct intake;
2. official admissions page;
3. official application portal;
4. official university PDF;
5. official academic calendar;
6. user-submitted official link;
7. historical official pages for estimates.

Third-party ranking and aggregator sites must never be the canonical source of an application date.

# University logos

Logos improve recognition but must be handled carefully.

## Retrieval order

1. official university brand asset page;
2. official website favicon or app icon;
3. official SVG or PNG found in university page metadata;
4. manually approved asset;
5. generated text monogram fallback.

## Logo rules

- store the original source URL;
- preserve attribution metadata internally;
- prefer SVG when legally and technically appropriate;
- generate optimized PNG/WebP derivatives for the app;
- use a neutral monogram fallback when no approved logo exists;
- do not scrape logos from random image-search websites;
- do not distort university marks;
- do not imply formal university partnership.

A university submission must not be blocked because its logo is missing.

# Security and privacy

Mandatory requirements:

- private user watchlists;
- encrypted transport;
- secure session handling;
- rate limiting on submissions, search and push endpoints;
- CSRF protection where relevant;
- input validation with shared schemas;
- URL allow-listing and SSRF protection for crawlers;
- no arbitrary URL fetching from internal networks;
- sanitize stored HTML and extracted text;
- unsubscribe and account deletion flows;
- minimum personal data collection;
- clear privacy notice;
- no sale of user data;
- no public exposure of email addresses or push endpoints.

# Accessibility

Target WCAG 2.2 AA where realistic.

Include:

- readable contrast;
- large touch targets;
- keyboard navigation;
- screen-reader labels;
- reduced-motion support;
- no reliance on color alone;
- accessible notification settings;
- proper focus handling in modal and search flows.

# Parallel-safe repository ownership

Organize the roadmap into phases and workstreams. Enforce folder ownership so contributors do not edit the same files in parallel.

Suggested boundaries:

```text
/apps/web/app/(landing)        -> landing and installation experience
/apps/web/app/(app)            -> installed PWA application screens
/apps/web/components           -> shared frontend components
/apps/web/public               -> manifest, icons and static assets
/apps/worker                   -> discovery, verification and notifications
/packages/database             -> Prisma schema, migrations and database client
/packages/contracts            -> shared Zod schemas and API contracts
/packages/ui                   -> design tokens and reusable UI primitives
/packages/config               -> lint, TypeScript and shared config
/data/seed                     -> initial universities and programs
/docs                          -> roadmap, architecture, product and operations docs
/scripts                       -> one-off import and maintenance scripts
```

The roadmap must assign one owner per boundary whenever multiple collaborators exist.

If GitHub usernames are not available:

- use role-based owners in the review document;
- set assignees to `TBD`;
- do not invent usernames;
- ask for usernames only after presenting the full proposed plan.

## Branch rules

- one feature branch per issue or tightly related issue group;
- pull requests into `main`;
- no direct push to `main`;
- database migrations require explicit review;
- contracts are frozen at the end of Phase 0;
- shared component changes require a heads-up;
- seed data changes should be small and source-backed.

# Required roadmap phases

## Phase 0 — Unblock and freeze contracts

Must finish first and remain short.

Include:

- repository inspection;
- final directory scaffold;
- local development instructions;
- environment variable template;
- PostgreSQL connection and initial migration;
- shared domain enums;
- frozen API contracts;
- design tokens;
- basic PWA manifest;
- one mock university and one mock program;
- mock search response;
- mock watchlist response;
- notification payload contract;
- branch and ownership rules;
- CI baseline;
- GitHub board setup proposal.

Frontend work must be able to start against mocks before background workers are ready.

## Phase 1 — Product shell in parallel

### Landing and installation

- minimalist landing page;
- iPhone installation tutorial;
- standalone-mode detection;
- installed-app routing;
- privacy link;
- PWA icons and splash behavior.

### Application frontend

- onboarding;
- home screen;
- university search;
- domain selection;
- program results;
- program detail;
- follow action;
- watchlist sections;
- empty states;
- loading and error states.

### Database and API

- universities;
- aliases;
- programs;
- domains;
- intakes;
- application windows;
- sources;
- watchlists;
- basic search endpoint;
- follow/unfollow endpoint;
- user authentication.

### Design system

- typography;
- spacing;
- color tokens;
- button, card, chip and search patterns;
- date-status component;
- university-logo component;
- mobile navigation;
- installation tutorial illustrations.

## Phase 2 — Shared enrichment

Include:

- add-missing-university flow;
- add-missing-program flow;
- duplicate detection;
- normalized aliases;
- submission queue;
- discovery worker;
- official-domain validation;
- HTML retrieval;
- source storage;
- source change detection;
- deterministic date extraction;
- expected-date rules;
- admin review queue;
- publication of approved shared records.

## Phase 3 — Notifications

Include:

- push subscription onboarding;
- VAPID configuration;
- notification preference defaults;
- opening reminders;
- deadline reminders;
- date-change notifications;
- expected-date wording;
- deep links;
- deduplication;
- retries;
- revoked-subscription cleanup;
- notification history;
- iPhone standalone PWA tests.

## Phase 4 — Seed data and reliability

Include:

- import initial universities;
- import initial programs;
- collect official sources;
- collect or approve logos;
- verify every seeded status;
- test conflicting sources;
- test old intake handling;
- test multiple application rounds;
- test date changes;
- data quality report;
- admin tools for corrections.

## Phase 5 — Integration and launch readiness

Include:

- first full end-to-end flow;
- landing-to-install journey;
- first PWA launch;
- search and follow flow;
- push permission flow;
- scheduled reminder delivery;
- shared university contribution;
- admin validation;
- production migration strategy;
- backups;
- observability;
- security review;
- accessibility review;
- performance review;
- App Store-style home-screen icon review;
- launch checklist.

## Buffer

Reserve explicit time for:

- iOS PWA bugs;
- push-notification delivery issues;
- university site parsing changes;
- migration fixes;
- data cleanup;
- design polish.

# Seed tasks per workstream

Expand every item into small GitHub issues with explicit acceptance criteria.

## Product and UX

- finalize MVP scope;
- map onboarding;
- map search flow;
- map follow flow;
- map missing-university flow;
- define public date-status wording;
- define notification copy;
- define empty and error states;
- define acceptance tests for teenager-level simplicity.

## Design

- Athenvia logo direction;
- warm white and milk-chocolate tokens;
- landing page design;
- installation tutorial;
- home screen;
- search screen;
- domain chips;
- program cards;
- program details;
- status indicators;
- watchlist states;
- logo fallbacks;
- PWA icon assets.

## Frontend

- Next.js scaffold;
- PWA manifest;
- service worker;
- standalone detection;
- landing route;
- install tutorial;
- onboarding;
- search autocomplete;
- filters;
- program cards;
- program detail;
- follow flow;
- watchlist;
- push permission UI;
- settings;
- responsive and accessibility testing.

## Database and API

- Prisma schema;
- first migration;
- seed scripts;
- search indexes;
- aliases;
- programs and domains;
- intakes;
- application windows;
- watchlists;
- sources;
- revisions;
- submissions;
- API validation;
- privacy boundaries.

## Worker and verification

- Redis and BullMQ setup;
- source check queue;
- fetcher;
- Playwright fallback;
- robots and rate-limit policy;
- content hashing;
- HTML text extraction;
- PDF extraction;
- date candidate parser;
- intake-year matching;
- expected-date generation;
- conflict detection;
- revision creation;
- admin review queue.

## Notifications

- VAPID setup;
- subscription endpoint;
- reminder scheduler;
- opening reminders;
- deadline reminders;
- date-change reminders;
- copy variants for expected dates;
- deep linking;
- dedupe keys;
- retry behavior;
- delivery logging;
- iOS PWA testing.

## Data and logos

- define seed-data format;
- seed NUS;
- seed KAIST;
- seed NTU;
- seed SMU;
- seed HKU;
- seed HKUST;
- seed Tsinghua;
- seed Seoul National University;
- seed HEC and École Polytechnique;
- seed Imperial;
- seed Oxford;
- seed Cambridge;
- seed ETH;
- seed EPFL;
- seed UCL;
- seed UCLA;
- seed UC Berkeley;
- seed Columbia;
- seed MIT;
- seed Cornell Tech;
- collect official URLs;
- collect approved logo assets;
- add monogram fallbacks;
- verify dates and statuses.

## DevOps and quality

- environment template;
- local Docker Compose for PostgreSQL and Redis;
- CI checks;
- test database strategy;
- preview deployments;
- migration policy;
- production backups;
- error tracking;
- structured logging;
- uptime checks;
- dependency security scanning;
- performance budget.

# Issue quality rules

Every proposed issue must include:

1. a clear, action-oriented title;
2. a body describing the goal and implementation boundary;
3. two to five acceptance criteria;
4. an assignee or `TBD`;
5. one workstream label;
6. one phase label;
7. one priority value;
8. explicit dependencies;
9. allowed file paths;
10. a note when database migration or contract review is required.

Keep each issue small enough to complete in one focused session whenever possible.

Avoid issues such as:

- `Build frontend`;
- `Set up backend`;
- `Add notifications`;
- `Scrape universities`.

Prefer scoped issues such as:

- `Implement standalone-mode gate for installed PWA`;
- `Add PostgreSQL trigram search for university aliases`;
- `Create verified application-window status component`;
- `Schedule 30-day application-opening reminders`;
- `Add KAIST K-School seed record with official source provenance`.

# GitHub labels

Propose labels for workstreams:

```text
workstream:product
workstream:design
workstream:frontend
workstream:database
workstream:api
workstream:worker
workstream:notifications
workstream:data
workstream:devops
workstream:quality
```

Propose labels for phases:

```text
phase:0-unblock
phase:1-product-shell
phase:2-enrichment
phase:3-notifications
phase:4-data-quality
phase:5-launch
```

Propose priority values:

```text
P0 — blocks all progress
P1 — required for MVP
P2 — useful for MVP quality
P3 — later enhancement
```

Also propose labels where needed:

```text
needs:design
needs:source
needs:review
migration
contract-change
security
accessibility
```

# GitHub Project board

After approval, create a GitHub Project v2 with:

## Fields

- Status;
- Priority;
- Phase;
- Workstream;
- Owner;
- Target milestone;
- Dependency note.

## Status options

```text
Backlog
Ready
In progress
In review
Blocked
Done
```

## Required views

1. **By status** — board grouped by Status;
2. **By phase** — board grouped by Phase;
3. **By owner** — table grouped by assignee;
4. **Launch blockers** — filtered to P0 and P1 incomplete issues;
5. **Data verification** — filtered to source, seed and reliability issues;
6. **Mobile/PWA** — filtered to landing, install, standalone and push issues.

# Required deliverables

## Review stage

Produce one review document containing:

1. proposed `/docs/ROADMAP.md`;
2. architecture summary;
3. directory ownership;
4. dependency order;
5. parallel-work rules;
6. complete issue list;
7. proposed labels;
8. proposed board fields and views;
9. unresolved assumptions;
10. any usernames still required.

Then stop.

## Approved execution stage

After approval, create:

1. `/docs/ROADMAP.md`;
2. any approved architecture or contract documents;
3. GitHub labels;
4. GitHub issues;
5. GitHub Project v2;
6. board fields;
7. board views;
8. issue assignments;
9. issue dependencies in issue bodies;
10. a short completion report with links.

# gh CLI safety

Before any GitHub operation:

1. run `gh auth status`;
2. report the authenticated account;
3. run `gh repo view`;
4. confirm the target repository;
5. confirm whether it is private or public;
6. do not change visibility without explicit approval;
7. do not assume contributor usernames.

Before approval, never run:

- `gh issue create`;
- `gh label create`;
- `gh project create`;
- `gh project item-add`;
- `gh repo edit`;
- `git push`;
- any command that changes remote state.

# Definition of MVP success

The MVP is complete when a new student can:

1. visit the Athenvia landing page in Safari;
2. understand the product immediately;
3. add Athenvia to their iPhone home screen;
4. open the installed PWA;
5. search for a university or program;
6. filter by domain;
7. view a program’s next application date;
8. understand whether the date is confirmed or expected;
9. follow the program;
10. grant push permission through a user action;
11. receive a correctly worded scheduled reminder;
12. open the official source;
13. submit a missing university;
14. allow that university to enter the shared verification workflow;
15. keep all private user data isolated.

# Explicit non-goals for the first MVP

Do not include these unless I approve them separately:

- social feed;
- public student profiles;
- admissions chance prediction;
- essay generation;
- university ranking engine;
- complex analytics dashboard;
- chat assistant;
- visible AI branding;
- native iOS application;
- Android-specific native application;
- payment system;
- automated application submission;
- storage of sensitive application documents;
- thousands of unverified programs;
- unrestricted crawling of the public web.

# Final planning instruction

Create the full review document now.

Make the roadmap concrete enough that implementation can begin immediately after approval, but do not create or modify any remote GitHub state yet.

When assumptions are needed, choose the simplest MVP-compatible option and list the assumption clearly instead of blocking the plan with unnecessary questions.
