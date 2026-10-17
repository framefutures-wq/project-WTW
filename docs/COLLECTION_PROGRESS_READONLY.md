# Collection progress checkpoint

Status: owner authorized a separate D1 Read credential on 2026-10-17;
`PAUSED_USER_ACTION` now applies only to credential creation/registration. Main's successful 180-second
tail sample proves lane completion only. The existing Worker Metadata Read-Only
credential does not grant D1 row access. No production query has been run here.

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
  This file contains three read-only statements. Do not pass arbitrary SQL.
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
scope. The remaining step is secure credential registration by the owner because
the available Cloudflare session is inaccessible here.

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
one API request containing the three reviewed SELECT statements; normal D1 read
usage applies, with no subscription or budget expansion.

The runner suppresses upstream errors and unapproved fields, caps response size
at 256 KiB, allows only known enums/numbers/timestamps, and requires all three
result metadata entries to report zero writes/changes and `changed_db=false`.
Absent metadata is a failed verification. No raw response or artifact is saved.
