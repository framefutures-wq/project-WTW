-- Audit-only data. Existing event values and publication evidence are untouched.
CREATE TABLE official_source_audits (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  origin_source_id TEXT NOT NULL REFERENCES sources(id),
  checked_at TEXT NOT NULL,
  baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)),
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  url_inventory_json TEXT NOT NULL CHECK(json_valid(url_inventory_json)),
  candidate_status TEXT NOT NULL CHECK(candidate_status IN ('candidates_found','no_candidate_url','detail_incomplete')),
  UNIQUE(run_id,event_id)
);
CREATE TABLE official_source_links (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES official_source_audits(id),
  url TEXT NOT NULL CHECK(url LIKE 'https://%' OR url LIKE 'http://%'),
  final_url TEXT,
  source_types TEXT NOT NULL CHECK(json_valid(source_types) AND json_type(source_types)='array'),
  title TEXT,
  checked_at TEXT NOT NULL,
  http_status INTEGER,
  access_status TEXT NOT NULL CHECK(access_status IN ('ok','http_error','network_error','unsupported_content','blocked_url','too_large')),
  official INTEGER CHECK(official IN (0,1)),
  reason TEXT NOT NULL,
  excerpt TEXT,
  content_hash TEXT,
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  UNIQUE(audit_id,url),
  CHECK(official IS NOT 1 OR (access_status='ok' AND excerpt IS NOT NULL AND content_hash IS NOT NULL))
);
CREATE TABLE official_source_comparisons (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES official_source_audits(id),
  link_id TEXT REFERENCES official_source_links(id),
  field TEXT NOT NULL CHECK(field IN ('title','start_date','end_date','venue','address','price','cancelled','postponed','operation_change')),
  result TEXT NOT NULL CHECK(result IN ('match','mismatch','unconfirmed','not_comparable')),
  tourapi_value TEXT,
  official_value TEXT,
  evidence_url TEXT,
  excerpt TEXT,
  checked_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  CHECK(result NOT IN ('match','mismatch') OR (link_id IS NOT NULL AND tourapi_value IS NOT NULL AND official_value IS NOT NULL AND evidence_url IS NOT NULL AND excerpt IS NOT NULL))
);
CREATE INDEX idx_official_audit_event ON official_source_audits(event_id,checked_at);
CREATE INDEX idx_official_links_audit ON official_source_links(audit_id,official);
CREATE INDEX idx_official_comparison_audit ON official_source_comparisons(audit_id,field,result);
