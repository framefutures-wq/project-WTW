## Follow-up source-level diagnosis

The fourth fixed SELECT groups `http_5xx` and `candidate_one_failed` retry counts by the
existing municipal source key. The runner accepts only keys in the current registry.
This identifies affected source groups without returning URLs, event payloads, IDs or raw
errors. Other retry categories remain grouped by category alone. The query remains read-only.

# Collection progress checkpoint

Status: `VERIFIED` for credential connection and fixed aggregate reads on
2026-10-17. Runs `39009589344` and `39009668880` succeeded on `967ce6e`.
The registered D1 Read credential is separate from Worker observation credentials.
Do not repeat authorization/registration or infer public visibility from this gate.

`scripts/collection-progress.sql` is a fixed, SELECT/WITH-only snapshot against
the existing schema through migration 0029. It reports three recent municipal
cycles, retained stage counts for all four queues, due/future/expired unfinished
work, and persisted municipal registration markers joined to event existence.
It returns aggregates and fixed state values, without event payloads, raw HTML,
URLs, candidate JSON, credentials or freeform diagnostic messages.

## Review before execution

- Keep the existing observation token unchanged. A separate short-lived **D1
  Read** credential requires owner authorization and secure GitHub Secret
  registration. Do not use an existing deployment token or request D1 Write.
- Cloudflare documents D1 Read as an accepted permission for the query API.
  Query transport uses POST; the SQL determines whether the operation writes.
  This file contains four read-only statements. Do not pass arbitrary SQL.
- The existing owner-only manual Worker audit workflow gains an optional
  `observe_collection` input, default false, using `CLOUDFLARE_D1_READ_TOKEN`
  only in its final guarded step. No recurring job, Worker, public endpoint or
  production deployment is added. The runner calls only the fixed D1 query API
  with this file; there is no arbitrary SQL input or automatic retry.
  Do not execute these queries using the metadata-only credential to probe access.
- Empty queue groups mean no retained rows for that queue. Missing tables are an
  error; do not apply migrations or infer production's schema from repository files.
- Once authorized, record two separately timed snapshots. Preserve timestamps;
  compare cursor, stage counts, expiry and publication persistence together.
  DONE includes terminal failures, and an expired/removed job can reduce backlog
  without successful publication. New work can increase backlog despite progress.
- Event existence and PUBLIC quality state alone do not establish public UI
  visibility or currently attendable events. Use the existing public API/detail
  checks for that separate gate. The existing client-side Cloudflare 1010/403
  observation is not proof of site downtime and must not be bypassed.

Local verification uses a disposable SQLite database with all repository
migrations and synthetic due, future, expired, DONE and publication cases.
It establishes query compatibility and aggregate meanings, not production facts.

Official permission reference (checked 2026-10-17):
https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/

## Credential handoff and execution

Owner authorization is recorded; do not request it again for the same D1 Read
scope. The owner completed secure credential registration. Do not repeat that
step; the available Cloudflare dashboard session remains inaccessible here.

Create a separate short-lived token named `galteum-d1-read` with only Account /
D1 / Read for the account containing `weekend-mwohae-production`, seven-day
expiry. D1 Read is an account permission; do not claim that the credential is
restricted to one database. The runner itself fixes the single production DB ID.
Keep Worker/deployment credentials unchanged and never grant D1 Edit/Write.
Store the value in repository Actions Secret `CLOUDFLARE_D1_READ_TOKEN`.
Never send the value in chat or put it in a screenshot, issue or commit.

After registration and reviewed-main merge, dispatch the existing workflow on
main with its exact reviewed SHA, `observe_collection=true`, `observe_live=false`.
The existing metadata step remains required. Run the second snapshot separately
at a recorded later time, without reruns or automatic retry. One run performs
one API request containing the four reviewed SELECT statements; normal D1 read
usage applies, with no subscription or budget expansion.

The runner suppresses upstream errors and unapproved fields, caps response size
at 256 KiB, allows only known enums/numbers/timestamps, and requires all three
result metadata entries to report zero writes/changes and `changed_db=false`.
Absent metadata is a failed verification. No raw response or artifact is saved.

## Actual evidence — 2026-10-18

PR #103 added the fourth fixed SELECT for municipal retry reasons and candidate cursor ranges;
main commit `860df8b` passed the existing CI, and manual read-only snapshot run `39140432719`
succeeded with four result sets, zero writes/changes, and no saved raw response.

At `2026-10-18T15:25:53.665Z`, four candidate checkpoints were retained, all future-active
(0 due, 0 expired), with attempts 10–14 and cursor range 0–8 of 25 candidates. Four candidate
retries were `candidate_one_failed`, also all future-active. Municipal list retries included
21 `LIST_PENDING/http_5xx` rows (attempts 9–15), all future-active, with no due or expired
unfinished rows. Categories are aggregate only; this does not expose which provider URLs failed
or establish a permanent outage. A separate 180-second live sample recorded three natural Cron
events, all `ok`, CPU 16–29 ms, zero exceptions and zero CPU-limit events. It is a short sample,
not proof of sustained recovery. No production deploy, DB write or forced ingestion occurred.

## Actual evidence — 2026-10-17

Snapshots were 15:21:21.769 and 15:22:40.610 KST (79 seconds apart), each
reporting rows_read `[10,824,80]`, zero writes/changes and unchanged queue counts.
Municipal scan: 188 DONE, 75 RETRY (5 due, 70 future), one due candidate.
Municipal detail: 68 DONE. Official: 8 DONE and one due FETCH_PENDING.
TourAPI detail: 71 DONE. No unfinished expired row was reported.
Today's cycle remained ACTIVE at 36/36, while the two preceding cycles were DONE.
Candidate latest_update advanced one minute; cursor movement was not queried.

Six municipal registration checkpoints joined existing verified/PUBLIC, non-sample
events, last updated 2026-10-15T20:45:03.151Z. This is a retained subset, not total
publicly visible events or new publications today. No backlog reduction, per-job
completion or public UI visibility was established by this short comparison.
Next inspect retry reasons and per-job cursor/stage movement before proposing fixes.

- https://github.com/framefutures-wq/project-WTW/actions/runs/39009589344
- https://github.com/framefutures-wq/project-WTW/actions/runs/39009668880
