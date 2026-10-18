CREATE TABLE IF NOT EXISTS event_enrichments (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  evidence_excerpt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS event_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tag TEXT CHECK(tag IN ('food','fireworks','flower_garden','experience','performance','parade','children_program','night_light')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  sort_order INTEGER NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  evidence_excerpt TEXT NOT NULL,
  UNIQUE(event_id, sort_order)
);
CREATE TABLE IF NOT EXISTS event_programs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  program_name TEXT NOT NULL,
  program_date TEXT CHECK(program_date IS NULL OR program_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time TEXT CHECK(start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT CHECK(end_time IS NULL OR end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  schedule_text TEXT,
  venue_name TEXT,
  description TEXT,
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
  sort_order INTEGER NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  evidence_excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(event_id, sort_order)
);
CREATE TABLE IF NOT EXISTS event_program_tags (
  program_id TEXT NOT NULL REFERENCES event_programs(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK(tag IN ('food','fireworks','flower_garden','experience','performance','parade','children_program','night_light')),
  PRIMARY KEY(program_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_event_programs_detail ON event_programs(event_id, featured, program_date, start_time, sort_order);
CREATE INDEX IF NOT EXISTS idx_event_highlights_detail ON event_highlights(event_id, featured, sort_order);

INSERT OR IGNORE INTO sources(id,kind,priority,name,url,fetched_at,raw_payload)
VALUES ('official-goyang-lake-arts-2026','municipality',2,'고양특례시','https://www.goyang.go.kr/news/user/bbs/BD_selectBbs.do?q_bbsCode=1090&q_bbscttSn=20260914143031770&q_estnColumn1=Y','2026-09-20T00:00:00.000Z',NULL);
INSERT OR REPLACE INTO event_enrichments(event_id,summary,source_id,evidence_excerpt,updated_at)
SELECT 'tourapi-1100492','일산호수공원 일원에서 서커스·마임 등 거리예술 공연과 체험 프로그램을 만날 수 있는 거리예술축제입니다.','official-goyang-lake-arts-2026','고양시 공식 보도자료: 9월 18~20일, 서커스·마임 등 100여 회 공연과 체험 프로그램','2026-09-20T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR REPLACE INTO event_highlights(event_id,label,tag,featured,sort_order,source_id,evidence_excerpt)
SELECT 'tourapi-1100492','불꽃 드론 쇼와 불꽃놀이','fireworks',1,1,'official-goyang-lake-arts-2026','고양시 공식 보도자료: 축제 마지막 날 불꽃 드론 조명 쇼와 불꽃놀이' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR REPLACE INTO event_highlights(event_id,label,tag,featured,sort_order,source_id,evidence_excerpt)
SELECT 'tourapi-1100492','거리예술 공연','performance',0,2,'official-goyang-lake-arts-2026','고양시 공식 보도자료: 서커스, 마임 등 100여 회 공연' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR REPLACE INTO event_highlights(event_id,label,tag,featured,sort_order,source_id,evidence_excerpt)
SELECT 'tourapi-1100492','서커스 체험','experience',0,3,'official-goyang-lake-arts-2026','고양시 공식 보도자료: 서커스 체조·접시돌리기·아크로 챌린지' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR REPLACE INTO event_programs(id,event_id,program_name,program_date,start_time,end_time,schedule_text,venue_name,description,featured,sort_order,source_id,evidence_excerpt,updated_at)
SELECT 'goyang-2026-hey-listen','tourapi-1100492','Hey, Listen','2026-09-19','19:30',NULL,NULL,'한울광장','공중 뮤직 퍼포먼스',1,1,'official-goyang-lake-arts-2026','고양시 공식 보도자료: 9월 19일 오후 7시 30분, 한울광장', '2026-09-20T00:00:00.000Z' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR REPLACE INTO event_programs(id,event_id,program_name,program_date,start_time,end_time,schedule_text,venue_name,description,featured,sort_order,source_id,evidence_excerpt,updated_at)
SELECT 'goyang-2026-fireworks','tourapi-1100492','불꽃 드론 쇼와 불꽃놀이','2026-09-20',NULL,NULL,'저녁', '일산호수공원','1,000여 대 드론 조명 쇼와 불꽃놀이',1,2,'official-goyang-lake-arts-2026','고양시 공식 보도자료: 축제 마지막 날인 9월 20일 저녁, 호수공원', '2026-09-20T00:00:00.000Z' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR REPLACE INTO event_programs(id,event_id,program_name,program_date,start_time,end_time,schedule_text,venue_name,description,featured,sort_order,source_id,evidence_excerpt,updated_at)
SELECT 'goyang-2026-circus-village','tourapi-1100492','서커스 빌리지',NULL,NULL,NULL,'9월 18일 15:00~19:00 / 9월 19~20일 14:00~19:00','일산호수공원 내 가로수정원','저글링·접시 돌리기·에어리얼·아크로 챌린지 체험',0,3,'official-goyang-lake-arts-2026','고양호수예술축제 공식 누리집: 서커스 빌리지 일정 및 장소', '2026-09-20T00:00:00.000Z' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
INSERT OR IGNORE INTO event_program_tags(program_id,tag)
SELECT 'goyang-2026-hey-listen','performance' WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-hey-listen')
UNION ALL SELECT 'goyang-2026-fireworks','fireworks' WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-fireworks')
UNION ALL SELECT 'goyang-2026-fireworks','night_light' WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-fireworks')
UNION ALL SELECT 'goyang-2026-circus-village','experience' WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-circus-village');
INSERT OR IGNORE INTO event_tags(event_id,tag,classifier_type,rule_version,rule_id,evidence_source_ref,evidence_field,evidence_excerpt)
SELECT 'tourapi-1100492','fireworks','deterministic_rule','fact_rules_v1','official_enrichment_program','official-goyang-lake-arts-2026','program','고양시 공식 보도자료: 9월 20일 불꽃 드론 조명 쇼와 불꽃놀이' WHERE EXISTS (SELECT 1 FROM events WHERE id='tourapi-1100492');
