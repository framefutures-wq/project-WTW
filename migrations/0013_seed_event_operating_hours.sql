INSERT INTO sources(id,kind,priority,name,url,fetched_at,raw_payload)
VALUES (
  'official-hwaseong-night-2026',
  'municipality',
  2,
  '수원시 팔달구 공식 안내',
  'https://paldal.suwon.go.kr/bbsplus/view.asp?bd_gubn=15&code=tbl_bbs_sub200510&menuid=sub200510&no=MTk5NjEg&page=1',
  '2026-09-20T00:00:00.000Z',
  NULL
)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  url=excluded.url,
  fetched_at=excluded.fetched_at;

-- The official notice says Friday–Sunday and public holidays, 18:00–21:30.
-- Expand that explicit recurrence into date rows because event_operating_hours
-- intentionally has no weekday rule and selection must be date-accurate.
WITH RECURSIVE dates(day) AS (
  SELECT '2026-05-01'
  UNION ALL
  SELECT date(day, '+1 day') FROM dates WHERE day < '2026-11-01'
), operating_days AS (
  SELECT day FROM dates
  WHERE strftime('%w', day) IN ('0', '5', '6')
     OR day IN (
       '2026-05-05', '2026-05-25', '2026-06-03', '2026-06-06',
       '2026-08-15', '2026-08-17', '2026-10-03', '2026-10-05',
       '2026-10-09'
     )
)
INSERT INTO event_operating_hours(
  id,event_id,start_date,end_date,start_time,end_time,human_time_text,
  sort_order,source_id,evidence_excerpt
)
SELECT
  'hwaseong-night-2026-' || day,
  'tourapi-2657619',
  day,
  day,
  '18:00',
  '21:30',
  NULL,
  0,
  'official-hwaseong-night-2026',
  '수원시 팔달구 공식 안내: 2026.5.1~11.1 매주 금~일요일·공휴일 18:00~21:30'
FROM operating_days
WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-2657619')
ON CONFLICT(event_id,start_date,end_date,sort_order) DO UPDATE SET
  start_time=excluded.start_time,
  end_time=excluded.end_time,
  human_time_text=excluded.human_time_text,
  source_id=excluded.source_id,
  evidence_excerpt=excluded.evidence_excerpt;
