import { decideMunicipalDuplicate } from "../shared/municipal-duplicate.ts";

export const quoteSql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const COLUMNS = "id,title,region,start_date,end_date,venue,address";
export function lookupMunicipalDuplicate(event, execute) {
  const exact = execute(`SELECT ${COLUMNS} FROM events WHERE title=${quoteSql(event.title)} LIMIT 2`);
  const nearby = execute(`SELECT ${COLUMNS} FROM events WHERE is_sample=0 AND verification='verified' AND status IN ('scheduled','unknown') AND region=${quoteSql(event.region)} AND start_date<=${quoteSql(event.end_date)} AND end_date>=${quoteSql(event.start_date)} LIMIT 25`);
  const decision = decideMunicipalDuplicate(event, exact.results, nearby.results);
  const selfOnly = exact.results.every((row) => row.id === event.id);
  return { decision: selfOnly && decision === "NEW" ? "NEW" : decision, exact, nearby };
}
