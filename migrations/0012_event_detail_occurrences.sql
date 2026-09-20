CREATE TABLE IF NOT EXISTS event_program_occurrences (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES event_programs(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_date TEXT NOT NULL CHECK(end_date >= start_date),
  start_time TEXT CHECK(start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT CHECK(end_time IS NULL OR end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  human_time_text TEXT,
  venue_name TEXT,
  source_id TEXT NOT NULL REFERENCES sources(id),
  evidence_excerpt TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(program_id, sort_order)
);
CREATE TABLE IF NOT EXISTS event_operating_hours (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK(end_date >= start_date),
  start_time TEXT CHECK(start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  end_time TEXT CHECK(end_time IS NULL OR end_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  human_time_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_id TEXT NOT NULL REFERENCES sources(id),
  evidence_excerpt TEXT NOT NULL,
  UNIQUE(event_id, start_date, end_date, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_program_occurrences_detail ON event_program_occurrences(program_id,start_date,start_time,sort_order);
CREATE INDEX IF NOT EXISTS idx_event_operating_hours_detail ON event_operating_hours(event_id,start_date,start_time);

INSERT INTO event_program_occurrences(id,program_id,start_date,end_date,start_time,end_time,human_time_text,venue_name,source_id,evidence_excerpt,sort_order)
SELECT 'goyang-fireworks-2026-09-19','goyang-2026-fireworks','2026-09-19','2026-09-19','20:30',NULL,NULL,NULL,'official-goyang-lake-arts-2026','고양호수예술축제 공식 프로그램: 9.19.(토) 20:30, 소요시간 20분',1 WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-fireworks')
ON CONFLICT(program_id,sort_order) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,end_time=excluded.end_time,human_time_text=excluded.human_time_text,venue_name=excluded.venue_name,evidence_excerpt=excluded.evidence_excerpt,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
INSERT INTO event_program_occurrences(id,program_id,start_date,end_date,start_time,end_time,human_time_text,venue_name,source_id,evidence_excerpt,sort_order)
SELECT 'goyang-fireworks-2026-09-20','goyang-2026-fireworks','2026-09-20','2026-09-20','20:30',NULL,NULL,NULL,'official-goyang-lake-arts-2026','고양호수예술축제 공식 프로그램: 9.20.(일) 20:30, 소요시간 20분',2 WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-fireworks')
ON CONFLICT(program_id,sort_order) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,end_time=excluded.end_time,human_time_text=excluded.human_time_text,venue_name=excluded.venue_name,evidence_excerpt=excluded.evidence_excerpt,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
INSERT INTO event_program_occurrences(id,program_id,start_date,end_date,start_time,end_time,human_time_text,venue_name,source_id,evidence_excerpt,sort_order)
SELECT 'goyang-circus-2026-09-18','goyang-2026-circus-village','2026-09-18','2026-09-18','15:00','19:00',NULL,'일산호수공원 내 가로수정원','official-goyang-lake-arts-2026','공식 누리집: 9월 18일 15:00~19:00, 일산호수공원 내 가로수정원',1 WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-circus-village')
ON CONFLICT(program_id,sort_order) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,end_time=excluded.end_time,venue_name=excluded.venue_name,evidence_excerpt=excluded.evidence_excerpt,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
INSERT INTO event_program_occurrences(id,program_id,start_date,end_date,start_time,end_time,human_time_text,venue_name,source_id,evidence_excerpt,sort_order)
SELECT 'goyang-circus-2026-09-19-20','goyang-2026-circus-village','2026-09-19','2026-09-20','14:00','19:00',NULL,'일산호수공원 내 가로수정원','official-goyang-lake-arts-2026','공식 누리집: 9월 19~20일 14:00~19:00, 일산호수공원 내 가로수정원',2 WHERE EXISTS (SELECT 1 FROM event_programs WHERE id='goyang-2026-circus-village')
ON CONFLICT(program_id,sort_order) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,end_time=excluded.end_time,venue_name=excluded.venue_name,evidence_excerpt=excluded.evidence_excerpt,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
