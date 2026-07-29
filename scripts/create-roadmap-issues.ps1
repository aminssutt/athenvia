param(
  [string]$Repository = "aminssutt/athenvia",
  [string]$Assignee = "aminssutt"
)

$ErrorActionPreference = "Stop"

function Add-RoadmapIssue {
  param(
    [string]$Code,
    [string]$Title,
    [string]$Goal,
    [string[]]$Criteria,
    [string]$Workstream,
    [string]$Phase,
    [string]$Priority,
    [string]$Dependencies,
    [string]$Paths,
    [string[]]$ExtraLabels = @(),
    [string]$Review = "No migration or contract review required.",
    [bool]$Completed = $false
  )

  $script:Issues.Add([pscustomobject]@{
      Code = $Code
      Title = $Title
      Goal = $Goal
      Criteria = $Criteria
      Workstream = $Workstream
      Phase = $Phase
      Priority = $Priority
      Dependencies = $Dependencies
      Paths = $Paths
      ExtraLabels = $ExtraLabels
      Review = $Review
      Completed = $Completed
    })
}

function Invoke-GitHubJson {
  param(
    [ValidateSet("POST", "PATCH")]
    [string]$Method,
    [string]$Endpoint,
    [hashtable]$Payload
  )

  $json = $Payload | ConvertTo-Json -Depth 10 -Compress
  $result = $json | gh api --method $Method $Endpoint --input -
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub API call failed: $Method $Endpoint"
  }
  return $result | ConvertFrom-Json
}

$Issues = [System.Collections.Generic.List[object]]::new()

# Phase 0
Add-RoadmapIssue "P0-01" "Formalize the MVP scope" "Freeze the MVP journeys, non-goals and simplicity rules." @("Product specification covers every MVP journey.", "Non-goals and public date wording are explicit.", "The fifteen MVP success conditions are traceable.") "product" "0-unblock" "P0" "None" "/docs/PRODUCT.md" -Completed $true
Add-RoadmapIssue "P0-02" "Create the Athenvia TypeScript monorepo" "Create the pnpm workspace and approved repository boundaries." @("All approved apps, packages and data folders exist.", "Workspace installation and root scripts work.", "The structure is documented in the README.") "devops" "0-unblock" "P0" "P0-01" "/package.json, /pnpm-workspace.yaml, /apps, /packages, /data, /docs, /scripts" -Completed $true
Add-RoadmapIssue "P0-03" "Configure TypeScript, ESLint and Prettier" "Provide strict shared configuration and repeatable quality commands." @("Strict TypeScript is enabled.", "Lint, format and typecheck commands pass.", "Reusable configuration lives in packages/config.") "devops" "0-unblock" "P0" "P0-02" "/packages/config, /eslint.config.mjs, /prettier.config.mjs" -Completed $true
Add-RoadmapIssue "P0-04" "Add local PostgreSQL and Redis services" "Provide reproducible local infrastructure for the web app and worker." @("Docker Compose starts PostgreSQL and Redis.", "Both services expose health checks.", "Persistent development volumes are configured.") "devops" "0-unblock" "P0" "P0-02" "/docker-compose.yml, /docs/DEVELOPMENT.md" @("security") "Security review required for exposed local defaults." $true
Add-RoadmapIssue "P0-05" "Create the environment variable template" "Document every required setting without committing real secrets." @(".env.example contains placeholders only.", "Database, Redis, auth and VAPID variables are documented.", "Local setup instructions reference the template.") "devops" "0-unblock" "P0" "P0-04" "/.env.example, /docs/DEVELOPMENT.md" @("security") "Security review required." $true
Add-RoadmapIssue "P0-06" "Define shared domain enums and contracts" "Freeze the cross-boundary search, watchlist and notification payloads." @("Public and internal statuses are represented.", "Zod validates search, watchlist and notification payloads.", "Contract tests cover valid mocks and unsafe deep links.") "api" "0-unblock" "P0" "P0-02" "/packages/contracts" @("contract-change") "Contract review required." $true
Add-RoadmapIssue "P0-07" "Create the initial Prisma schema and migration" "Implement the provenance-aware PostgreSQL model and its first migration." @("Core public and private entities are modeled.", "Uniqueness and ownership constraints are present.", "Migration applies successfully to PostgreSQL 16.") "database" "0-unblock" "P0" "P0-04, P0-06" "/packages/database" @("migration", "contract-change") "Migration and contract review required." $true
Add-RoadmapIssue "P0-08" "Add contract-valid mock data" "Unblock frontend work with one university, one program, search and watchlist mocks." @("Mock search response validates.", "Mock watchlist response validates.", "No unsupported exact date is included.") "api" "0-unblock" "P0" "P0-06" "/packages/contracts/src/mocks.ts" @("contract-change") "Contract review required." $true
Add-RoadmapIssue "P0-09" "Create Athenvia design tokens" "Establish the warm white and milk-chocolate visual foundation." @("Colors, spacing and radii are exported in CSS and TypeScript.", "Focus color remains readable.", "The web app consumes the shared tokens.") "design" "0-unblock" "P0" "P0-02" "/packages/ui" @("accessibility") "Accessibility review required." $true
Add-RoadmapIssue "P0-10" "Scaffold the Next.js application" "Create the App Router web shell with separate landing and installed-app surfaces." @("Next.js production build passes.", "Landing, home and privacy routes render.", "The frontend can run against mocks.") "frontend" "0-unblock" "P0" "P0-03, P0-08, P0-09" "/apps/web" -Completed $true
Add-RoadmapIssue "P0-11" "Add the basic PWA manifest and icons" "Make the web app installable with a standalone start URL and provisional mark." @("Manifest uses standalone display.", "Theme, background and start URL are correct.", "Regular and maskable icons are referenced.") "frontend" "0-unblock" "P0" "P0-10" "/apps/web/app/manifest.ts, /apps/web/public/icons" -Completed $true
Add-RoadmapIssue "P0-12" "Scaffold the BullMQ worker" "Create a separate validated worker process and initial notification queue." @("Worker connects through REDIS_URL.", "Notification payloads are contract validated.", "Retry defaults and graceful shutdown exist.") "worker" "0-unblock" "P1" "P0-03, P0-04, P0-06" "/apps/worker" -Completed $true
Add-RoadmapIssue "P0-13" "Install the test baseline" "Provide unit, contract and mobile WebKit end-to-end test foundations." @("Vitest contract tests pass.", "Playwright starts Athenvia on an isolated port.", "The landing installation journey passes in mobile WebKit.") "quality" "0-unblock" "P0" "P0-10" "/packages/contracts, /apps/web/tests, /apps/web/playwright.config.ts" -Completed $true
Add-RoadmapIssue "P0-14" "Configure the GitHub Actions CI baseline" "Run the required quality and mobile end-to-end checks on pushes and pull requests." @("CI installs with a frozen pnpm lockfile.", "Format, lint, Prisma, types, tests and build run.", "WebKit E2E runs in a separate job.") "devops" "0-unblock" "P0" "P0-03, P0-13" "/.github/workflows" -Completed $true
Add-RoadmapIssue "P0-15" "Document architecture, security and repository rules" "Make system boundaries and safe contribution rules explicit." @("Architecture and source priority are documented.", "Privacy and SSRF requirements are documented.", "Branch, migration and contract rules are documented.") "quality" "0-unblock" "P1" "P0-06, P0-07" "/docs, /CONTRIBUTING.md, /.github" @("security") "Security documentation review required." $true

# Phase 1
Add-RoadmapIssue "P1-01" "Implement the production landing page" "Polish the minimal public landing experience around one clear installation action." @("Promise, preview, install CTA and privacy link are present.", "The page stays short and mobile-first.", "Desktop behavior remains a lightweight preview.") "frontend" "1-product-shell" "P1" "P0-09, P0-10" "/apps/web/app/(landing)"
Add-RoadmapIssue "P1-02" "Design the iPhone installation tutorial" "Turn the three Safari steps into a clear accessible tutorial." @("All three required steps are shown.", "Illustrations remain understandable without color.", "Copy is tested at mobile width.") "design" "1-product-shell" "P1" "P1-01" "/apps/web/app/(landing), /apps/web/public" @("needs:design", "accessibility")
Add-RoadmapIssue "P1-03" "Implement the standalone-mode gate" "Route installed PWA launches into the app while keeping Safari on the landing page." @("display-mode and iOS standalone are detected.", "Installed launches avoid landing content.", "Desktop and unsupported cases have a documented fallback.") "frontend" "1-product-shell" "P0" "P1-01" "/apps/web"
Add-RoadmapIssue "P1-04" "Add the service worker and offline shell" "Cache the essential PWA shell and provide safe update behavior." @("Core shell assets work offline.", "Stale deployments can update safely.", "Offline errors use plain language.") "frontend" "1-product-shell" "P1" "P0-11" "/apps/web"
Add-RoadmapIssue "P1-05" "Implement first-launch onboarding" "Introduce Athenvia in at most two screens with an optional target intake." @("Onboarding has at most two screens.", "Target intake is optional.", "Push permission is not requested.") "frontend" "1-product-shell" "P1" "P1-03" "/apps/web/app/(app)/onboarding"
Add-RoadmapIssue "P1-06" "Create accessible mobile navigation" "Provide large, simple navigation targets for the installed app." @("Only essential destinations are visible.", "Touch targets and focus indicators meet requirements.", "Screen-reader labels are present.") "design" "1-product-shell" "P1" "P0-09" "/packages/ui, /apps/web/components" @("accessibility")
Add-RoadmapIssue "P1-07" "Implement the watchlist home screen" "Build Watching, Open now and Applied sections against mocks and real APIs." @("All three sections render.", "Cards show the next useful date and public status.", "Empty states lead to Add a program.") "frontend" "1-product-shell" "P1" "P0-08, P1-06" "/apps/web/app/(app)"
Add-RoadmapIssue "P1-08" "Implement university and program search" "Support university names, aliases and direct program queries." @("Search accepts the documented query styles.", "Loading, empty and error states exist.", "The search field is mobile and keyboard accessible.") "frontend" "1-product-shell" "P1" "P0-08" "/apps/web/app/(app)/search, /apps/web/components"
Add-RoadmapIssue "P1-09" "Add domain chips and result filtering" "Let students narrow results using the approved simple domains." @("Approved domains and Other are available.", "Selection state is accessible.", "Filtering updates results without losing the query.") "frontend" "1-product-shell" "P1" "P1-08" "/apps/web/app/(app)/search"
Add-RoadmapIssue "P1-10" "Create program cards and date-status indicators" "Show useful program information without internal confidence or technical terms." @("Confirmed, Expected and Not published states match approved copy.", "Status never relies on color alone.", "No internal confidence value is rendered.") "design" "1-product-shell" "P1" "P0-09, P0-06" "/packages/ui, /apps/web/components" @("accessibility")
Add-RoadmapIssue "P1-11" "Create the university logo component" "Render approved logos safely with a consistent monogram fallback." @("Aspect ratio is preserved.", "Missing and failed images use a monogram.", "The component does not imply partnership.") "design" "1-product-shell" "P1" "P0-09" "/packages/ui, /apps/web/components"
Add-RoadmapIssue "P1-12" "Implement the program detail screen" "Present only the information needed to decide whether to follow a program." @("Required program and intake fields render.", "Official source opens directly.", "Follow this program is the single primary action.") "frontend" "1-product-shell" "P1" "P1-10, P1-11" "/apps/web/app/(app)/programs"
Add-RoadmapIssue "P1-13" "Implement the Follow program interaction" "Add a program and intake to the watchlist and confirm the action." @("Follow uses the selected intake.", "Optimistic failure can roll back.", "Push onboarding begins only after success.") "frontend" "1-product-shell" "P1" "P1-12, P1-17" "/apps/web/app/(app), /apps/web/components"
Add-RoadmapIssue "P1-14" "Add lightweight magic-link authentication" "Provide secure account creation without a long registration form." @("Magic-link login works.", "Sessions use secure defaults.", "Local onboarding can precede account creation.") "api" "1-product-shell" "P1" "P0-07" "/apps/web, /packages/database" @("security", "migration") "Security and migration review required."
Add-RoadmapIssue "P1-15" "Add PostgreSQL search indexes for aliases" "Make university and program search tolerant of aliases and spelling variation." @("Trigram and text extensions are migrated.", "Alias and accent cases are tested.", "Ranking remains deterministic.") "database" "1-product-shell" "P1" "P0-07" "/packages/database" @("migration") "Migration review required."
Add-RoadmapIssue "P1-16" "Implement the search API" "Expose validated, rate-limited catalogue search." @("Input uses the shared contract.", "Programs, universities and domains are returned.", "Pagination and errors are documented.") "api" "1-product-shell" "P1" "P0-06, P1-15" "/apps/web/app/api, /packages/contracts" @("contract-change") "Contract review required."
Add-RoadmapIssue "P1-17" "Implement Follow and Unfollow APIs" "Persist private watchlists with default reminder preferences." @("Ownership is checked.", "Duplicate follows are prevented.", "Default preferences are created transactionally.") "api" "1-product-shell" "P1" "P1-14, P0-07" "/apps/web/app/api, /packages/database" @("security") "Security review required."
Add-RoadmapIssue "P1-18" "Add settings, privacy and deletion controls" "Give users control over their account and private data." @("Notification settings are reachable.", "Unsubscribe and sign-out work.", "Account deletion removes or anonymizes private data safely.") "frontend" "1-product-shell" "P1" "P1-14" "/apps/web/app/(app)/settings, /apps/web/app/api" @("security")
Add-RoadmapIssue "P1-19" "Standardize empty, loading and error states" "Create reusable states with simple copy and a clear next action." @("Reusable patterns cover loading, empty and retry.", "Messages avoid technical terms.", "Reduced motion is respected.") "design" "1-product-shell" "P2" "P1-06" "/packages/ui, /apps/web/components" @("accessibility")
Add-RoadmapIssue "P1-20" "Test the product shell and accessibility" "Cover the Phase 1 journeys and teenager-level simplicity." @("Landing, onboarding, search, detail and follow are tested.", "Keyboard, focus and contrast findings are documented.", "Critical failures block Phase 1 completion.") "quality" "1-product-shell" "P1" "P1-01 through P1-19" "/apps/web/tests, /docs/quality" @("accessibility")

# Phase 2
Add-RoadmapIssue "P2-01" "Implement the missing-university form" "Let a student submit a university not found in search." @("Typed name is prefilled.", "Country is required and website is optional.", "The pending state is explained clearly.") "frontend" "2-enrichment" "P1" "P1-08" "/apps/web/app/(app)/contribute"
Add-RoadmapIssue "P2-02" "Implement the university-submission API" "Validate and store a shared pending university safely." @("Input is validated and rate limited.", "Submission is linked to its owner.", "Submitted URLs pass SSRF-safe validation.") "api" "2-enrichment" "P1" "P2-01, P0-07" "/apps/web/app/api, /packages/database" @("security")
Add-RoadmapIssue "P2-03" "Implement the missing-program form" "Let a student propose a program within an existing university." @("University is prefilled.", "Name, degree and domain are required.", "Official URL remains optional.") "frontend" "2-enrichment" "P1" "P1-08" "/apps/web/app/(app)/contribute"
Add-RoadmapIssue "P2-04" "Implement the program-submission API" "Validate and store a shared pending program safely." @("Input and university ownership are validated.", "Rate limiting is applied.", "The record starts in Pending.") "api" "2-enrichment" "P1" "P2-03, P0-07" "/apps/web/app/api, /packages/database" @("security")
Add-RoadmapIssue "P2-05" "Implement normalization and duplicate detection" "Identify likely duplicate universities and programs without destructive merging." @("Names and aliases use one normalization strategy.", "Likely duplicates enter review.", "No automatic merge deletes provenance.") "database" "2-enrichment" "P1" "P2-02, P2-04" "/packages/database, /packages/contracts"
Add-RoadmapIssue "P2-06" "Configure discovery and verification queues" "Separate discovery, fetch, parse and review jobs with bounded retry behavior." @("All required queues exist.", "Retries and dead-letter behavior are explicit.", "Jobs contain stable identifiers only.") "worker" "2-enrichment" "P1" "P0-12" "/apps/worker"
Add-RoadmapIssue "P2-07" "Build the SSRF-safe official-source fetcher" "Retrieve approved university sources with rate, robots and network controls." @("Private and link-local targets are rejected.", "Only approved official domains are fetched.", "Timeouts, robots and per-domain rate limits apply.") "worker" "2-enrichment" "P0" "P2-06" "/apps/worker/src/fetch" @("security")
Add-RoadmapIssue "P2-08" "Add the Playwright retrieval fallback" "Retrieve client-rendered official pages only when normal HTTP is insufficient." @("Fallback is opt-in per source.", "The same network protections apply.", "Browser resources and time are bounded.") "worker" "2-enrichment" "P2" "P2-07" "/apps/worker/src/fetch" @("security")
Add-RoadmapIssue "P2-09" "Store source snapshots and content hashes" "Detect official-source changes while preserving immutable evidence." @("Snapshots are immutable.", "Hashes avoid duplicate snapshots.", "Sources remain linked to universities and programs.") "database" "2-enrichment" "P1" "P2-07" "/packages/database, /apps/worker" @("migration") "Migration review required."
Add-RoadmapIssue "P2-10" "Extract safe text from HTML and PDF" "Produce deterministic text inputs without executing stored content." @("HTML is sanitized.", "Official admissions PDFs are supported.", "Parsing failures are observable and retryable.") "worker" "2-enrichment" "P1" "P2-07" "/apps/worker/src/parsing" @("security")
Add-RoadmapIssue "P2-11" "Parse deterministic date candidates" "Recognize common official date formats with context and timezone." @("Supported date formats have fixtures.", "Ambiguous candidates are not auto-published.", "Timezone treatment is explicit.") "worker" "2-enrichment" "P1" "P2-10" "/apps/worker/src/parsing"
Add-RoadmapIssue "P2-12" "Match dates to intake years and rounds" "Attach candidates to the correct intake and application round." @("Old intakes are rejected.", "Multiple rounds are supported.", "Ambiguous intake matches enter review.") "worker" "2-enrichment" "P1" "P2-11" "/apps/worker/src/verification"
Add-RoadmapIssue "P2-13" "Generate conservative expected dates" "Create expected months or seasons only from prior official cycles." @("Historical evidence is stored.", "Weak evidence never produces an exact day.", "Expected status and wording remain distinct from confirmed.") "worker" "2-enrichment" "P1" "P2-12" "/apps/worker/src/verification"
Add-RoadmapIssue "P2-14" "Create revisions and conflict detection" "Preserve old values and block conflicting updates until review." @("Every changed canonical field creates a revision.", "Source and creator are retained.", "Conflicts cannot auto-publish.") "database" "2-enrichment" "P0" "P2-09, P2-12" "/packages/database, /apps/worker" @("migration", "needs:review") "Migration and human review required."
Add-RoadmapIssue "P2-15" "Build the admin review queue" "Let an authorized reviewer compare evidence and approve or reject changes." @("Source content and differences are visible.", "Approve and reject actions are audited.", "Access is restricted to administrators.") "frontend" "2-enrichment" "P1" "P2-14" "/apps/web/app/admin, /apps/web/app/api/admin" @("needs:review", "security")
Add-RoadmapIssue "P2-16" "Publish approved shared records" "Promote reviewed submissions without losing history or creating duplicates." @("Approved records become searchable.", "Duplicate checks run before publication.", "The original contributor can be notified.") "api" "2-enrichment" "P1" "P2-05, P2-15" "/apps/web/app/api/admin, /packages/database"

# Phase 3
Add-RoadmapIssue "P3-01" "Configure VAPID keys" "Load Web Push keys securely and document rotation." @("Private keys stay server-side.", "The public key is exposed separately.", "Generation and rotation are documented.") "notifications" "3-notifications" "P0" "P0-05" "/.env.example, /docs/operations, /apps" @("security")
Add-RoadmapIssue "P3-02" "Implement the push-subscription endpoint" "Store, replace and revoke authenticated Web Push subscriptions." @("Subscriptions are user-owned.", "Endpoints are deduplicated.", "Revocation is supported without exposing secrets.") "api" "3-notifications" "P1" "P3-01, P1-14" "/apps/web/app/api/push, /packages/database" @("security")
Add-RoadmapIssue "P3-03" "Add push-permission onboarding" "Request notification permission only after a successful Follow action." @("No prompt appears on first launch.", "Refusal is non-blocking.", "iOS installation requirements are explained.") "frontend" "3-notifications" "P1" "P1-13, P3-02" "/apps/web/components, /apps/web/app/(app)"
Add-RoadmapIssue "P3-04" "Implement default reminder preferences" "Apply and edit the approved opening and deadline offsets." @("Opening defaults are 30, 7 and 0 days.", "Deadline defaults are 30, 14, 7 and 2 days.", "Users can disable or change preferences.") "notifications" "3-notifications" "P1" "P1-17" "/packages/contracts, /apps/web, /packages/database"
Add-RoadmapIssue "P3-05" "Build the server-side reminder scheduler" "Create reminder jobs and recalculate them when dates or preferences change." @("Jobs use the user's intended timezone policy.", "Past reminders are skipped.", "Date changes reschedule pending deliveries.") "notifications" "3-notifications" "P0" "P2-14, P3-04" "/apps/worker/src/notifications"
Add-RoadmapIssue "P3-06" "Send application-opening reminders" "Deliver the three opening reminders with date-status-aware wording." @("30-day, 7-day and opening-day jobs are supported.", "Expected dates are called expected.", "The program and source are identifiable.") "notifications" "3-notifications" "P1" "P3-05" "/apps/worker/src/notifications"
Add-RoadmapIssue "P3-07" "Send application-deadline reminders" "Deliver the four deadline reminders without sending stale jobs." @("30, 14, 7 and 2-day jobs are supported.", "Past deadlines are ignored.", "Expected wording is preserved.") "notifications" "3-notifications" "P1" "P3-05" "/apps/worker/src/notifications"
Add-RoadmapIssue "P3-08" "Send material date-change notifications" "Notify followers when a verified date change affects their plan." @("Only material changes trigger a message.", "Old and new information are understandable.", "User preference is respected.") "notifications" "3-notifications" "P1" "P2-14, P3-05" "/apps/worker/src/notifications"
Add-RoadmapIssue "P3-09" "Add notification deep links and dedupe keys" "Open the correct program and prevent duplicate delivery." @("Deep links stay within Athenvia.", "Dedupe keys are unique per reminder event.", "Concurrent delivery cannot send twice.") "notifications" "3-notifications" "P0" "P3-06, P3-07, P3-08" "/apps/worker, /apps/web" @("security")
Add-RoadmapIssue "P3-10" "Add push retries and revoked-endpoint cleanup" "Retry transient errors and stop sending to invalid subscriptions." @("Retries use bounded backoff.", "Permanent Web Push failures revoke endpoints.", "Dead letters are observable.") "notifications" "3-notifications" "P1" "P3-09" "/apps/worker/src/notifications, /packages/database"
Add-RoadmapIssue "P3-11" "Implement user-visible notification history" "Show recent deliveries without leaking another user's activity." @("Sent and failed user-relevant entries are displayed.", "Queries enforce owner isolation.", "History links to the relevant program.") "frontend" "3-notifications" "P2" "P3-09" "/apps/web/app/(app)/notifications, /apps/web/app/api" @("security")
Add-RoadmapIssue "P3-12" "Test Web Push on an installed iPhone PWA" "Validate permission, receipt and deep linking in the supported iOS flow." @("Installation and permission are tested.", "A scheduled reminder is received once.", "Known iOS limitations are documented.") "quality" "3-notifications" "P0" "P3-03 through P3-11" "/apps/web/tests, /docs/quality"

# Phase 4
Add-RoadmapIssue "P4-01" "Define the source-backed seed-data format" "Validate source provenance and make seed imports idempotent." @("A schema validates seed files.", "Every date requires a source and status.", "Repeated imports do not duplicate records.") "data" "4-data-quality" "P0" "P0-06, P0-07" "/data/seed, /scripts" @("needs:source")

$SeedUniversities = @(
  @("P4-02", "National University of Singapore"),
  @("P4-03", "KAIST"),
  @("P4-04", "Nanyang Technological University"),
  @("P4-05", "Singapore Management University"),
  @("P4-06", "University of Hong Kong"),
  @("P4-07", "HKUST"),
  @("P4-08", "Tsinghua University"),
  @("P4-09", "Seoul National University"),
  @("P4-10", "HEC Paris and Ecole Polytechnique"),
  @("P4-11", "Imperial College London"),
  @("P4-12", "University of Oxford"),
  @("P4-13", "University of Cambridge"),
  @("P4-14", "ETH Zurich"),
  @("P4-15", "EPFL"),
  @("P4-16", "University College London"),
  @("P4-17", "UCLA"),
  @("P4-18", "UC Berkeley"),
  @("P4-19", "Columbia University"),
  @("P4-20", "MIT"),
  @("P4-21", "Cornell Tech")
)

foreach ($seedUniversity in $SeedUniversities) {
  $code = $seedUniversity[0]
  $university = $seedUniversity[1]
  Add-RoadmapIssue $code "Add source-backed seed records for $university" "Add the relevant MVP programs, aliases, intake and official provenance for $university." @("At least one relevant program is included.", "Every date has an official source and public status.", "No unsupported exact date is added.") "data" "4-data-quality" "P1" "P4-01" "/data/seed/$($code.ToLower()).json" @("needs:source") "Official source review required."
}

Add-RoadmapIssue "P4-22" "Import and validate the initial catalogue" "Load approximately 20 universities and 40-60 programs idempotently." @("The import can be re-run safely.", "Invalid records produce a report.", "The target catalogue size is reached with no unsupported dates.") "data" "4-data-quality" "P1" "P4-02 through P4-21" "/scripts, /data/seed"
Add-RoadmapIssue "P4-23" "Verify canonical official program URLs" "Ensure every seeded program points to an approved official source." @("Official domains are validated.", "Missing sources remain explicitly incomplete.", "Third-party aggregators are never canonical.") "data" "4-data-quality" "P1" "P4-02 through P4-21" "/data/seed" @("needs:source")
Add-RoadmapIssue "P4-24" "Add approved university logos and monograms" "Provide provenance-aware visual identifiers without implying partnership." @("Original source metadata is stored.", "Unapproved image-search assets are excluded.", "Every university has a monogram fallback.") "design" "4-data-quality" "P2" "P1-11, P4-02 through P4-21" "/apps/web/public/universities, /data/seed" @("needs:review")
Add-RoadmapIssue "P4-25" "Test conflicting official sources" "Verify that contradictory dates enter review instead of publication." @("A conflicting fixture is detected.", "Automatic publication is blocked.", "The decision and evidence remain auditable.") "quality" "4-data-quality" "P1" "P2-14" "/apps/worker/tests"
Add-RoadmapIssue "P4-26" "Test old intakes and multiple rounds" "Keep historical dates out of current intakes while supporting application rounds." @("Old intake dates are rejected.", "Rounds remain ordered and distinct.", "Correct intake association is asserted.") "quality" "4-data-quality" "P1" "P2-12" "/apps/worker/tests"
Add-RoadmapIssue "P4-27" "Test verified date changes end to end" "Ensure a changed date creates history and updates reminders safely." @("A revision preserves the previous value.", "Pending reminders are recalculated.", "Affected users are not notified twice.") "quality" "4-data-quality" "P1" "P2-14, P3-08" "/apps/worker/tests"
Add-RoadmapIssue "P4-28" "Generate the data-quality report" "Report source, status and logo coverage without exposing confidence scores publicly." @("Coverage gaps are listed.", "Launch-blocking records are identifiable.", "The report contains no private user data.") "data" "4-data-quality" "P1" "P4-22 through P4-27" "/scripts, /docs/data"

# Phase 5
Add-RoadmapIssue "P5-01" "Test the landing-to-install journey" "Validate Safari guidance and standalone routing." @("Safari shows the installation experience.", "Standalone launch opens the application.", "Desktop fallback is verified.") "quality" "5-launch" "P0" "P1-01 through P1-04" "/apps/web/tests"
Add-RoadmapIssue "P5-02" "Test first launch, search and Follow" "Validate the core student journey in under one minute." @("Onboarding, search, detail and Follow complete.", "Date status and official source are understandable.", "The journey meets the one-minute target.") "quality" "5-launch" "P0" "Phase 1" "/apps/web/tests"
Add-RoadmapIssue "P5-03" "Test permission and scheduled reminder delivery" "Validate the complete opt-in Web Push journey." @("Permission follows an explicit user action.", "A scheduled reminder arrives once.", "The notification opens the correct program.") "quality" "5-launch" "P0" "Phase 3" "/apps/web/tests, /apps/worker/tests"
Add-RoadmapIssue "P5-04" "Test shared university contribution" "Validate submission, discovery, review and publication." @("A student can submit an unknown university.", "Worker and review states are visible internally.", "Approval makes the record reusable.") "quality" "5-launch" "P0" "Phase 2" "/apps/web/tests, /apps/worker/tests"
Add-RoadmapIssue "P5-05" "Document the deployment architecture" "Define portable hosting for web, worker, PostgreSQL, Redis and storage." @("Every service and network boundary is documented.", "No core feature requires one vendor.", "Secrets and environment promotion are covered.") "devops" "5-launch" "P1" "Phase 0" "/docs/DEPLOYMENT.md"
Add-RoadmapIssue "P5-06" "Define production migration and rollback" "Create a safe release procedure for database changes." @("Forward migration and rollback steps exist.", "Backups precede destructive changes.", "Post-migration verification is explicit.") "database" "5-launch" "P0" "P5-05" "/docs/operations, /scripts" @("migration") "Migration review required."
Add-RoadmapIssue "P5-07" "Configure backups and test restoration" "Protect catalogue, user and notification data with tested recovery." @("Frequency and retention are defined.", "A restoration drill succeeds.", "Secrets are excluded from backup logs.") "devops" "5-launch" "P0" "P5-05" "/docs/operations, approved infrastructure" @("security")
Add-RoadmapIssue "P5-08" "Add structured logging, error tracking and uptime checks" "Make web and worker failures observable without logging private data." @("Logs correlate requests and jobs.", "Sensitive fields are redacted.", "Critical alerts and uptime checks are documented.") "devops" "5-launch" "P1" "P5-05" "/apps, /packages/config, /docs/operations" @("security")
Add-RoadmapIssue "P5-09" "Complete the launch security review" "Review auth, SSRF, CSRF, rate limits and private-data isolation." @("The security checklist is completed.", "P0 and P1 findings are fixed.", "Residual risks are documented.") "quality" "5-launch" "P0" "Phases 1 through 3" "/docs/security, relevant tests" @("security", "needs:review")
Add-RoadmapIssue "P5-10" "Complete the WCAG 2.2 AA review" "Validate keyboard, focus, screen reader, contrast and reduced motion behavior." @("Core journeys are audited.", "Blocking accessibility defects are fixed.", "Remaining limitations are documented.") "quality" "5-launch" "P1" "Phase 1" "/apps/web/tests, /docs/quality" @("accessibility", "needs:review")
Add-RoadmapIssue "P5-11" "Review PWA performance budgets" "Measure and optimize mobile loading, caching and assets." @("A mobile performance budget is documented.", "Core routes meet the approved budget.", "Images and cache behavior are reviewed.") "quality" "5-launch" "P1" "P1-04, P4-24" "/apps/web, /docs/quality"
Add-RoadmapIssue "P5-12" "Finalize the home-screen icon set" "Deliver production-quality iPhone and monochrome Athenvia marks." @("Small-size legibility is reviewed.", "Required icon sizes and maskable variants exist.", "The mark works without gradients.") "design" "5-launch" "P1" "P4-24" "/apps/web/public" @("needs:design")
Add-RoadmapIssue "P5-13" "Enable dependency security scanning" "Automate detection and triage of vulnerable dependencies." @("Automated scanning runs on the repository.", "Critical alerts have a response policy.", "Lockfile updates remain reviewed.") "devops" "5-launch" "P1" "P0-14" "/.github, /docs/security" @("security")
Add-RoadmapIssue "P5-14" "Complete the launch checklist" "Verify every MVP success condition and operational prerequisite." @("All MVP conditions are checked.", "No P0 or P1 launch blocker remains.", "Rollback, owner and support steps are recorded.") "product" "5-launch" "P0" "All MVP issues" "/docs/LAUNCH_CHECKLIST.md" @("needs:review")
Add-RoadmapIssue "P5-15" "Run the stabilization buffer" "Resolve iOS, push, parsing, migration, data and polish defects before launch." @("Buffer defects are triaged by severity.", "Every fix includes proportional validation.", "Deferred items are documented explicitly.") "quality" "5-launch" "P1" "P5-01 through P5-14" "Paths declared by each stabilization issue"

$existingJson = gh issue list --repo $Repository --state all --limit 200 --json number,title,state
if ($LASTEXITCODE -ne 0) {
  throw "Unable to list existing issues."
}
$existingIssues = @($existingJson | ConvertFrom-Json)
$created = 0
$skipped = 0
$closed = 0

foreach ($issue in $Issues) {
  $fullTitle = "[$($issue.Code)] $($issue.Title)"
  $existing = $existingIssues | Where-Object { $_.title -eq $fullTitle } | Select-Object -First 1

  if ($existing) {
    $issueNumber = $existing.number
    $skipped += 1
  }
  else {
    $criteriaMarkdown = ($issue.Criteria | ForEach-Object { "- [ ] $_" }) -join "`n"
    $body = @(
      "## Goal",
      "",
      $issue.Goal,
      "",
      "## Acceptance criteria",
      "",
      $criteriaMarkdown,
      "",
      "## Planning",
      "",
      "- Assignee: @${Assignee}",
      "- Priority: $($issue.Priority)",
      "- Dependencies: $($issue.Dependencies)",
      "- Allowed paths: $($issue.Paths)",
      "",
      "## Review gate",
      "",
      $issue.Review
    ) -join "`n"

    if ($issue.Completed) {
      $body += "`n`n## Bootstrap delivery`n`nImplemented in the initial Phase 0 bootstrap on main."
    }

    $labels = @(
      "workstream:$($issue.Workstream)",
      "phase:$($issue.Phase)",
      "priority:$($issue.Priority)"
    ) + $issue.ExtraLabels

    $createdIssue = Invoke-GitHubJson "POST" "repos/$Repository/issues" @{
      title = $fullTitle
      body = $body
      assignees = @($Assignee)
      labels = $labels
    }
    $issueNumber = $createdIssue.number
    $created += 1
  }

  if ($issue.Completed) {
    Invoke-GitHubJson "PATCH" "repos/$Repository/issues/$issueNumber" @{
      state = "closed"
      state_reason = "completed"
    } | Out-Null
    $closed += 1
  }
}

[pscustomobject]@{
  repository = $Repository
  planned = $Issues.Count
  created = $created
  skipped = $skipped
  phaseZeroClosed = $closed
} | ConvertTo-Json
