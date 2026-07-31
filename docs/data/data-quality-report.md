# Athenvia data-quality report

- Generated: 2026-07-31T13:48:33.660Z (UTC)
- Scope: catalogue tables only (universities, aliases, programs, summaries, sources, intakes, application windows, domains)
- Regenerate: `node scripts/data-quality-report.mjs > docs/data/data-quality-report.md` (requires `DATABASE_URL` or `POSTGRES_*` variables in `.env`)

> Privacy note: this report contains no user data of any kind (no users, sessions, accounts,
> watchlists, notification or push records are read) and exposes no internal confidence scores.

## Catalogue overview

| Entity              | Count |
| ------------------- | ----- |
| Universities        | 21    |
| University aliases  | 33    |
| Programs            | 51    |
| Program summaries   | 51    |
| Sources             | 95    |
| Intakes             | 57    |
| Application windows | 89    |
| Domains             | 13    |

Entity status (catalogue visibility):

| Entity     | Status | Count |
| ---------- | ------ | ----- |
| University | ACTIVE | 21    |
| Program    | ACTIVE | 51    |

## Coverage gaps

### Program summaries

- Programs with a summary: 51/51 (100%)
- Programs without a summary (hidden in the app by design): 0/51 (0%)

None.

### Sources

- Total sources: 95 (official: 95/95 (100%))
- Programs with at least one source: 51/51 (100%)
- Programs with at least one official source: 51/51 (100%)
- Universities with a directly attached (university-level) source: 21/21 (100%)

Sources by type:

| Source type     | Sources | Programs covered |
| --------------- | ------- | ---------------- |
| PROGRAM_PAGE    | 58      | 50/51 (98%)      |
| ADMISSIONS_PAGE | 32      | 30/51 (59%)      |
| UNIVERSITY_PAGE | 5       | 5/51 (10%)       |

Programs without any source:

None.

### Application windows

| Public status | Windows     |
| ------------- | ----------- |
| CONFIRMED     | 4/89 (4%)   |
| EXPECTED      | 55/89 (62%) |
| NOT_PUBLISHED | 30/89 (34%) |

- Programs with at least one CONFIRMED window: 4/51 (8%)
- Programs with no application window at all: 0/51 (0%)
- Programs whose windows are all NOT_PUBLISHED: 18/51 (35%)

Programs with no application window:

None.

Programs whose windows are all NOT_PUBLISHED:

- HEC Paris — Master of Science Data Science & AI for Business X-HEC
- Imperial College London — MSc Artificial Intelligence
- Imperial College London — MSc Computing
- Imperial College London — MSc Computing (Artificial Intelligence and Machine Learning)
- Nanyang Technological University — Master of Science in Artificial Intelligence (MSAI)
- National University of Singapore — MSc (Venture Creation)
- Singapore Management University — Master of Science in Business AI (MBAI)
- The Hong Kong University of Science and Technology — Master of Science in Artificial Intelligence
- The University of Hong Kong — MSc in Computer Science
- Tsinghua University — Tsinghua-UC Berkeley Joint Master Program in Data Science
- University of California, Berkeley — Master of Engineering in Electrical Engineering and Computer Sciences (MEng)
- University of Cambridge — MPhil in Advanced Computer Science
- University of Cambridge — MPhil in Data Intensive Science
- University of Cambridge — MPhil in Machine Learning and Machine Intelligence
- University of Oxford — MSc in Advanced Computer Science
- University of Oxford — MSc in Social Data Science
- University of Oxford — MSc in Statistical Science
- École Polytechnique — MSc&T Visual and Creative Artificial Intelligence (ViCAI)

### University logos

- Universities with a logo (`logo_asset_id` set): 0/21 (0%)
- Universities without a logo (ticket #87 pending): 21/21 (100%)

- Columbia University (US)
- Cornell Tech (US)
- ETH Zurich (CH)
- HEC Paris (FR)
- Imperial College London (GB)
- Korea Advanced Institute of Science and Technology (KR)
- Massachusetts Institute of Technology (US)
- Nanyang Technological University (SG)
- National University of Singapore (SG)
- Seoul National University (KR)
- Singapore Management University (SG)
- The Hong Kong University of Science and Technology (HK)
- The University of Hong Kong (HK)
- Tsinghua University (CN)
- University College London (GB)
- University of California, Berkeley (US)
- University of California, Los Angeles (US)
- University of Cambridge (GB)
- University of Oxford (GB)
- École Polytechnique (FR)
- École Polytechnique Fédérale de Lausanne (CH)

### University aliases

- Universities with at least one alias: 21/21 (100%)

Universities without any alias (weaker search/duplicate detection):

None.

### Intakes

| Intake status | Intakes     |
| ------------- | ----------- |
| PLANNED       | 44/57 (77%) |
| OPEN          | 6/57 (11%)  |
| CLOSED        | 7/57 (12%)  |
| COMPLETED     | 0/57 (0%)   |
| UNKNOWN       | 0/57 (0%)   |

Programs without any intake:

None.

### Domains

- Programs with at least one domain: 51/51 (100%)

None.

### Source freshness (`last_checked_at`)

| Age bucket            | Sources      |
| --------------------- | ------------ |
| Checked < 7 days ago  | 95/95 (100%) |
| Checked 7–30 days ago | 0/95 (0%)    |
| Checked > 30 days ago | 0/95 (0%)    |
| Never checked (null)  | 0/95 (0%)    |

## Launch-blocking records

**Universities without a logo (21/21)** — blocking only if the launch UI requires logos; ticket #87 (logo ingestion) has not been done yet, so 0 logos is expected. See the list under "University logos" above.

**Programs whose windows are all NOT_PUBLISHED (18/51)** — dates exist but none is publishable; flagship programs in this state will show no actionable deadline at launch. See the list under "Application windows" above.

## Notes

- No user data is included in this report: only catalogue tables are read, and no personally
  identifiable information exists in those tables.
- Internal confidence scores (`application_windows.confidence_score`,
  `data_revisions.confidence_score`) are intentionally NOT selected nor exposed, per the
  product decision to keep confidence scoring internal.
