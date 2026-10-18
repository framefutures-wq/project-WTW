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

-- Diagnose municipal scan retries and cursor movement without exposing IDs,
-- URLs, candidate payloads or freeform errors. Unknown categories are collapsed.
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS observed_at,
  'scan_retry' AS kind,'RETRY' AS stage,retry_stage,
  CASE safe_error_category
    WHEN 'unsafe_url' THEN 'unsafe_url'
    WHEN 'candidate_batch_too_large' THEN 'candidate_batch_too_large'
    WHEN 'list_health_check_failed' THEN 'list_health_check_failed'
    WHEN 'list_parse_requires_fallback' THEN 'list_parse_requires_fallback'
    WHEN 'http_429' THEN 'http_429'
    WHEN 'http_5xx' THEN 'http_5xx'
    WHEN 'network_or_timeout' THEN 'network_or_timeout'
    WHEN 'list_page_failed' THEN 'list_page_failed'
    WHEN 'candidate_batch_invalid' THEN 'candidate_batch_invalid'
    WHEN 'candidate_cursor_invalid' THEN 'candidate_cursor_invalid'
    WHEN 'candidate_one_failed' THEN 'candidate_one_failed'
    ELSE 'other'
  END AS reason,
  CASE WHEN safe_error_category IN ('http_5xx','candidate_one_failed')
    THEN source_key ELSE NULL END AS source_key,
  COUNT(*) AS retained,
  SUM(CASE WHEN julianday(expires_at)>julianday('now')
    AND julianday(available_at)<=julianday('now') THEN 1 ELSE 0 END) AS due_active,
  SUM(CASE WHEN julianday(expires_at)>julianday('now')
    AND julianday(available_at)>julianday('now') THEN 1 ELSE 0 END) AS future_active,
  SUM(CASE WHEN julianday(expires_at)<=julianday('now') THEN 1 ELSE 0 END) AS expired_unfinished,
  MIN(attempt_count) AS min_attempt_count,MAX(attempt_count) AS max_attempt_count,
  NULL AS min_candidate_cursor,NULL AS max_candidate_cursor,
  NULL AS min_candidate_count,NULL AS max_candidate_count
FROM municipal_scan_jobs WHERE stage='RETRY'
GROUP BY retry_stage,reason,
  CASE WHEN safe_error_category IN ('http_5xx','candidate_one_failed')
    THEN source_key ELSE NULL END
UNION ALL
SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS observed_at,
  'candidate_progress' AS kind,'CANDIDATE_PENDING' AS stage,NULL AS retry_stage,'none' AS reason,
  NULL AS source_key,
  COUNT(*) AS retained,
  SUM(CASE WHEN julianday(expires_at)>julianday('now')
    AND julianday(available_at)<=julianday('now') THEN 1 ELSE 0 END) AS due_active,
  SUM(CASE WHEN julianday(expires_at)>julianday('now')
    AND julianday(available_at)>julianday('now') THEN 1 ELSE 0 END) AS future_active,
  SUM(CASE WHEN julianday(expires_at)<=julianday('now') THEN 1 ELSE 0 END) AS expired_unfinished,
  MIN(attempt_count) AS min_attempt_count,MAX(attempt_count) AS max_attempt_count,
  MIN(candidate_cursor) AS min_candidate_cursor,MAX(candidate_cursor) AS max_candidate_cursor,
  MIN(candidate_count) AS min_candidate_count,MAX(candidate_count) AS max_candidate_count
FROM municipal_scan_jobs
WHERE stage='CANDIDATE_PENDING'
  OR (stage='RETRY' AND retry_stage='CANDIDATE_PENDING')
ORDER BY kind,stage,retry_stage,reason;
