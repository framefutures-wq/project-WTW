# Cost information v1

Cost is confirmed only from explicit official event admission, viewing, or
participation language. Official event and public-agency sources outrank TourAPI
fee fields, which outrank already stored official price evidence. Missing,
partial, mixed, service-only, product-only, and stale prior-year price text
remains `unknown`.

`cost_rules_v1` is deterministic: explicit `입장/관람/참가` free wording becomes
`free`; explicit admission/participation price or paid wording becomes `paid`.
Parking, shuttle, food, gifts, optional programs, and bare prices do not change
the event cost. The original TourAPI fee field is retained as `price_text` and
as `event_evidence.price` only when the status is confirmed.

The 2026-09-20 one-time bounded snapshot found 263 current events: free 0,
paid 0, unknown 263; TourAPI fee fields and stored price evidence both had zero
coverage. No production status backfill was performed and no external lookups
were made. Future new or changed TourAPI records use the same classifier during
ingestion. `idx_events_cost_listing` supports the free/paid list path.
