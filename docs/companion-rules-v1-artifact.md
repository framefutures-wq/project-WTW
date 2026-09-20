# companion_rules_v1 regeneration record

The Phase 4-2 initial backfill was reconstructed from one bounded production
snapshot on 2026-09-20. The snapshot selected 263 non-sample event identifiers
and titles, plus 1,081 deterministic `fact_rules_v1` tag rows. It excluded raw
payloads, official-source bodies, image data, and secrets.

The local snapshot and event-level output are intentionally ignored by Git:
they are current-data artifacts rather than durable fixtures. Recreate them only
when a production write is explicitly authorized:

```sh
WRANGLER_LOG_PATH=/tmp/wrangler-logs node scripts/companion-suitability-snapshot.mjs
npm run companion:dry-run -- --snapshot .wrangler/deployment/companion-input-snapshot.json
node scripts/companion-suitability-operations.mjs plan
```

The regenerated dry-run matched the Phase 4-1 aggregate: child fit 24, couple
fit 42, parents fit 13, pet allowed 1, conditional 0. Its 1,052 rows cover all
263 events and four companion types with no duplicate or orphan rows.

For the initial reconstruction, SHA-256 was
`e37c4404c8d06599f5403b7b7c4662209fec8271d158d8ec9680b4cd768685fc` for the
input snapshot and
`45b9b6a26b2850c7e46df8b5b748944717f1a25e93f9a39d1bf0f3567bb81db6` for the
event-level report.
