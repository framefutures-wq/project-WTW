# Collection progress checkpoint

Status: `PAUSED_USER_ACTION` for live D1 evidence. Main's successful 180-second
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
- No new workflow, recurring job, Worker, API endpoint or production deployment
  is added. Use the existing Wrangler remote D1 query method after authorization.
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
