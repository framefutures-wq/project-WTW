// Fixed scope for the user-approved retirement of the legacy collection schedule.
export const PLATFORM_D1_PROBE =
  "SELECT 1 AS ok, EXISTS(SELECT 1 FROM events) AS has_events, EXISTS(SELECT 1 FROM sources) AS has_sources";

export function assertPlatformConfig(settings) {
  const db = settings?.d1_databases;
  if (
    settings?.name !== "weekend-mwohae" ||
    settings?.vars?.APP_MODE !== "production" ||
    settings?.assets?.directory !== "./dist" ||
    settings?.assets?.binding !== "ASSETS" ||
    !Array.isArray(settings?.triggers?.crons) ||
    settings.triggers.crons.length !== 0 ||
    !Array.isArray(db) || db.length !== 1 ||
    db[0]?.binding !== "DB" ||
    db[0]?.database_name !== "weekend-mwohae-production" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(db[0]?.database_id ?? "")
  ) {
    throw new Error("Platform production config mismatch or legacy Cron enabled.");
  }
}

export function assertPlatformProbe(status, stdout) {
  if (status !== 0) throw new Error("Platform D1 read-only probe failed.");
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error("Invalid D1 probe JSON."); }
  const row = data?.[0]?.results?.[0];
  if (!Array.isArray(data) || data.length !== 1 ||
      data[0]?.success !== true || data[0]?.results?.length !== 1 ||
      row?.ok !== 1 || ![0, 1].includes(row.has_events) || ![0, 1].includes(row.has_sources) ||
      (data[0]?.meta?.changes ?? 0) !== 0 || data[0]?.meta?.changed_db === true) {
    throw new Error("Unexpected D1 read-only probe result.");
  }
}
