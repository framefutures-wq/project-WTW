import { assessCost } from "../../shared/cost-status";
import type { MunicipalRichDetail } from "../../shared/municipal-rich-detail";

type PrioritySnapshot = {
  summary_priority: number | null;
  price_priority: number | null;
  hours_priority: number | null;
  programs_priority: number | null;
};

export type MunicipalRichDetailPersistInput = {
  eventId: string;
  startDate: string;
  endDate: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  checkedAt: string;
  detail: MunicipalRichDetail;
  sourceKind?: "municipality" | "organizer";
};

const canReplace = (priority: number | null, incomingPriority: number) =>
  priority === null || priority >= incomingPriority;

export function assessMunicipalPrice(
  value: string,
  referenceYear: number,
) {
  const text = value.replace(/\s+/g, " ").trim();
  if (/^무료$/u.test(text))
    return { status: "free" as const, reason: "explicit_price_field_free" };
  if (/^유료$/u.test(text))
    return { status: "paid" as const, reason: "explicit_price_field_paid" };
  return assessCost(text, referenceYear);
}

const excerpt = (field: string, value: string) =>
  (field + "=" + value).slice(0, 1000);

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function prioritySnapshot(
  db: D1Database,
  eventId: string,
): Promise<PrioritySnapshot> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT MIN(s.priority)
         FROM event_enrichments en
         JOIN sources s ON s.id=en.source_id
         WHERE en.event_id=?) AS summary_priority,
        (SELECT MIN(s.priority)
         FROM event_evidence ev
         JOIN sources s ON s.id=ev.source_id
         WHERE ev.event_id=? AND ev.field='price') AS price_priority,
        (SELECT MIN(s.priority)
         FROM event_operating_hours oh
         JOIN sources s ON s.id=oh.source_id
         WHERE oh.event_id=?) AS hours_priority,
        (SELECT MIN(s.priority)
         FROM event_programs p
         JOIN sources s ON s.id=p.source_id
         WHERE p.event_id=?) AS programs_priority`,
    )
    .bind(eventId, eventId, eventId, eventId)
    .first<PrioritySnapshot>();
  return (
    row ?? {
      summary_priority: null,
      price_priority: null,
      hours_priority: null,
      programs_priority: null,
    }
  );
}

async function persistImages(
  db: D1Database,
  input: MunicipalRichDetailPersistInput,
) {
  if (!input.detail.images.length) return 0;
  let changed = 0;
  const currentPrimary = await db
    .prepare(
      "SELECT image_status,source_type,source_page_url FROM event_images WHERE event_id=?",
    )
    .bind(input.eventId)
    .first<{
      image_status: string;
      source_type: string | null;
      source_page_url: string | null;
    }>();

  const sourceKind = input.sourceKind ?? "municipality";
  const sourcePriority = sourceKind === "organizer" ? 1 : 2;
  const imagePriority = (sourceType: string | null) =>
    sourceType === "organizer"
      ? 1
      : sourceType === "municipality"
        ? 2
        : sourceType === "tourapi"
          ? 3
          : 4;
  const primary = input.detail.images[0];
  if (
    !currentPrimary ||
    currentPrimary.image_status !== "ok" ||
    currentPrimary.source_page_url === input.sourceUrl ||
    imagePriority(currentPrimary.source_type) > sourcePriority
  ) {
    await db
      .prepare(
        `INSERT INTO event_images(
          event_id,image_url,source_type,source_page_url,is_primary,image_status,
          width,height,mime_type,last_checked_at,evidence_note
        ) VALUES(?,?, ?, ?,1,'ok',NULL,NULL,NULL,?,?)
        ON CONFLICT(event_id) DO UPDATE SET
          image_url=excluded.image_url,
          source_type=excluded.source_type,
          source_page_url=excluded.source_page_url,
          image_status='ok',
          last_checked_at=excluded.last_checked_at,
          evidence_note=excluded.evidence_note
        WHERE event_images.image_status!='ok'
           OR event_images.source_page_url=excluded.source_page_url
           OR (CASE event_images.source_type
                 WHEN 'organizer' THEN 1
                 WHEN 'municipality' THEN 2
                 WHEN 'tourapi' THEN 3
                 ELSE 4
               END) > ?`,
      )
      .bind(
        input.eventId,
        primary.url,
        sourceKind,
        input.sourceUrl,
        input.checkedAt,
        excerpt("official_image", primary.alt ?? primary.url),
        sourcePriority,
      )
      .run();
    changed += 1;
  }

  if (input.detail.images.length <= 1) return changed;

  await db
    .prepare(
      "DELETE FROM event_additional_images WHERE event_id=? AND source_type='tourapi'",
    )
    .bind(input.eventId)
    .run();

  const occupied = await db
    .prepare(
      `SELECT sort_order FROM event_additional_images
       WHERE event_id=? AND image_status='ok' AND source_type!='tourapi'`,
    )
    .bind(input.eventId)
    .all<{ sort_order: number }>();
  const used = new Set(occupied.results.map((row) => Number(row.sort_order)));
  const free = [2, 3, 4, 5].filter((slot) => !used.has(slot));

  for (
    let index = 1;
    index < input.detail.images.length && free.length;
    index += 1
  ) {
    const image = input.detail.images[index];
    const slot = free.shift();
    if (!slot) break;
    await db
      .prepare(
        `INSERT OR IGNORE INTO event_additional_images(
          event_id,image_url,source_type,source_page_url,sort_order,image_status,
          width,height,mime_type,last_checked_at,evidence_note
        ) VALUES(?,?, ?, ?,?,'ok',NULL,NULL,NULL,?,?)`,
      )
      .bind(
        input.eventId,
        image.url,
        sourceKind,
        input.sourceUrl,
        slot,
        input.checkedAt,
        excerpt("official_image", image.alt ?? image.url),
      )
      .run();
    changed += 1;
  }
  return changed;
}

export async function persistMunicipalRichDetail(
  db: D1Database,
  input: MunicipalRichDetailPersistInput,
) {
  const priorities = await prioritySnapshot(db, input.eventId);
  const sourceKind = input.sourceKind ?? "municipality";
  const sourcePriority = sourceKind === "organizer" ? 1 : 2;
  const statements: D1PreparedStatement[] = [];
  let changed = 0;

  statements.push(
    db
      .prepare(
        `INSERT INTO sources(
          id,kind,priority,name,url,fetched_at,raw_payload
        ) VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          url=excluded.url,
          fetched_at=excluded.fetched_at,
          raw_payload=excluded.raw_payload`,
      )
      .bind(
        input.sourceId,
        sourceKind,
        sourcePriority,
        input.sourceName,
        input.sourceUrl,
        input.checkedAt,
        JSON.stringify({
          municipal_rich_detail: {
            contact_phone: input.detail.contact_phone,
            price_text: input.detail.price_text,
          },
        }),
      ),
  );

  if (input.detail.summary && canReplace(priorities.summary_priority, sourcePriority)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO event_enrichments(
            event_id,summary,source_id,evidence_excerpt,updated_at
          ) VALUES(?,?,?,?,?)
          ON CONFLICT(event_id) DO UPDATE SET
            summary=excluded.summary,
            source_id=excluded.source_id,
            evidence_excerpt=excluded.evidence_excerpt,
            updated_at=excluded.updated_at
          WHERE (
            SELECT priority FROM sources
            WHERE id=event_enrichments.source_id
          )>=?`,
        )
        .bind(
          input.eventId,
          input.detail.summary,
          input.sourceId,
          excerpt("official_summary", input.detail.summary),
          input.checkedAt,
          sourcePriority,
        ),
    );
    changed += 1;
  }

  if (input.detail.price_text && canReplace(priorities.price_priority, sourcePriority)) {
    const assessed = assessMunicipalPrice(
      input.detail.price_text,
      Number(input.startDate.slice(0, 4)),
    );
    if (assessed.status !== "unknown") {
      statements.push(
        db
          .prepare(
            "UPDATE events SET cost=?,price_text=?,updated_at=? WHERE id=?",
          )
          .bind(
            assessed.status,
            input.detail.price_text,
            input.checkedAt,
            input.eventId,
          ),
        db
          .prepare(
            `INSERT INTO event_evidence(
              event_id,source_id,field,excerpt,checked_at
            ) VALUES(?,?,?,?,?)
            ON CONFLICT(event_id,source_id,field) DO UPDATE SET
              excerpt=excluded.excerpt,
              checked_at=excluded.checked_at`,
          )
          .bind(
            input.eventId,
            input.sourceId,
            "price",
            excerpt("official_price", input.detail.price_text),
            input.checkedAt,
          ),
      );
      changed += 1;
    }
  }

  if (
    input.detail.operating_hours.length &&
    canReplace(priorities.hours_priority, sourcePriority)
  ) {
    statements.push(
      db
        .prepare(
          `DELETE FROM event_operating_hours
           WHERE event_id=? AND source_id IN (
             SELECT id FROM sources WHERE priority>=?
           )`,
        )
        .bind(input.eventId, sourcePriority),
    );
    for (
      let index = 0;
      index < input.detail.operating_hours.length;
      index += 1
    ) {
      const hours = input.detail.operating_hours[index];
      statements.push(
        db
          .prepare(
            `INSERT INTO event_operating_hours(
              id,event_id,start_date,end_date,start_time,end_time,
              human_time_text,sort_order,source_id,evidence_excerpt
            ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            input.eventId + "-municipal-hours-" + index,
            input.eventId,
            input.startDate,
            input.endDate,
            hours.start_time,
            hours.end_time,
            hours.human_time_text,
            index,
            input.sourceId,
            excerpt("official_time", hours.human_time_text),
          ),
      );
    }
    changed += input.detail.operating_hours.length;
  }

  if (input.detail.programs.length && canReplace(priorities.programs_priority, sourcePriority)) {
    statements.push(
      db
        .prepare(
          `DELETE FROM event_programs
           WHERE event_id=? AND source_id IN (
             SELECT id FROM sources WHERE priority>=?
           )`,
        )
        .bind(input.eventId, sourcePriority),
    );
    for (let index = 0; index < input.detail.programs.length; index += 1) {
      const program = input.detail.programs[index];
      statements.push(
        db
          .prepare(
            `INSERT INTO event_programs(
              id,event_id,program_name,program_date,start_time,end_time,
              schedule_text,venue_name,description,featured,sort_order,
              source_id,evidence_excerpt,updated_at
            ) VALUES(?,?,?,NULL,NULL,NULL,?,NULL,?,0,?,?,?,?)`,
          )
          .bind(
            input.eventId +
              "-municipal-program-" +
              stableHash(program.name + "|" + index),
            input.eventId,
            program.name,
            program.schedule_text,
            program.description,
            index,
            input.sourceId,
            excerpt("official_program", program.name),
            input.checkedAt,
          ),
      );
    }
    changed += input.detail.programs.length;
  }

  if (statements.length) await db.batch(statements);
  changed += await persistImages(db, input);

  return {
    changed,
    summary: Boolean(input.detail.summary),
    hours: input.detail.operating_hours.length,
    price: Boolean(input.detail.price_text),
    contact: Boolean(input.detail.contact_phone),
    images: input.detail.images.length,
    programs: input.detail.programs.length,
  };
}
