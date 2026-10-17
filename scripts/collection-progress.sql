-- Manual snapshot only; no trigger, migration or ingestion.
-- Execute twice at separately recorded times to compare progress. New jobs,
-- retries and retention can change counts; a lower backlog alone is not success.
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS observed_at,
  operating_date,status,source_cursor,source_count,updated_at,completed_at
FROM municipal_scan_cycles ORDER BY created_at DESC LIMIT 3;

-- DONE can include terminal failure. Count expired work and publication markers
-- separately; available_at is also used for leases, so future != retry alone.
WITH jobs AS (
  SELECT 'municipal_scan' AS queue,stage,available_at,expires_at,updated_at
  FROM municipal_scan_jobs
  UNION ALL
  SELECT 'municipal_detail',stage,available_at,expires_at,updated_at
  FROM municipal_detail_jobs
  UNION ALL
  SELECT 'official_detail',stage,available_at,expires_at,updated_at
  FROM official_detail_jobs
  UNION ALL
  SELECT 'tourapi_detail',stage,available_at,expires_at,updated_at
  FROM tourapi_detail_jobs
)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS observed_at,queue,stage,
  COUNT(*) AS retained,
  SUM(CASE WHEN stage!='DONE' AND julianday(expires_at)>julianday('now')
    AND julianday(available_at)<=julianday('now') THEN 1 ELSE 0 END) AS due_active,
  SUM(CASE WHEN stage!='DONE' AND julianday(expires_at)>julianday('now')
    AND julianday(available_at)>julianday('now') THEN 1 ELSE 0 END) AS future_active,
  SUM(CASE WHEN stage!='DONE' AND julianday(expires_at)<=julianday('now')
    THEN 1 ELSE 0 END) AS expired_unfinished,
  MAX(updated_at) AS latest_update
FROM jobs GROUP BY queue,stage ORDER BY queue,stage;

-- Persisted municipal registration marker, grouped by whether an event exists.
-- This is NOT the public UI visibility predicate (which also checks evidence,
-- freshness, source trust, tags and date filters in worker/index.ts).
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS observed_at,
  CASE WHEN e.id IS NULL THEN 'MISSING_EVENT' ELSE 'EVENT_EXISTS' END AS persistence,
  e.publish_quality_state,e.verification,e.is_sample,
  COUNT(*) AS checkpoints,MAX(j.updated_at) AS latest_checkpoint_update,
  MAX(e.updated_at) AS latest_event_update
FROM municipal_detail_jobs j LEFT JOIN events e ON e.id=j.event_id
WHERE j.stage='DONE' AND j.safe_error_category='candidate_registration_public'
GROUP BY persistence,e.publish_quality_state,e.verification,e.is_sample;
