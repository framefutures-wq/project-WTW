export const REGIONS = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "전남광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
] as const;
export const AUDIENCES = {
  kids: "아이와",
  couple: "커플",
  parents: "부모님과",
  pets: "반려동물과",
} as const;
export const THEMES = {
  food: "먹거리",
  fireworks: "불꽃",
  flowers: "꽃",
  experience: "체험",
  performance: "공연",
} as const;
export type Period = "today" | "weekend" | "next-weekend" | "custom";
import type { EventOperatingHours } from "./event-operating-hours";

export type DateRange = { start: string; end: string };
export type Tag = keyof typeof AUDIENCES | keyof typeof THEMES;
export type TrustStatus = "confirmed" | "needs_review" | "changed";
export interface EventItem {
  id: string;
  title: string;
  description: string;
  region: string;
  venue: string;
  address: string;
  start_date: string;
  end_date: string;
  lat: number | null;
  lng: number | null;
  cost: "free" | "paid" | "unknown";
  price_text: string | null;
  pet_policy: "allowed" | "prohibited" | "unknown";
  status: "scheduled" | "cancelled" | "postponed" | "unknown";
  verification: "sample" | "verified" | "pending" | "stale";
  is_sample: number;
  checked_at: string | null;
  source_url: string | null;
  source_name: string | null;
  source_kind: string | null;
  trust_status: TrustStatus | null;
  trust_checked_at: string | null;
  trust_source_url: string | null;
  trust_source_types: string[];
  trust_changed_fields: string[];
  image_url?: string | null;
  image_source_type?: string | null;
  image_source_page_url?: string | null;
  image_status?: "ok" | "missing" | "blocked" | "invalid" | null;
  tags: Tag[];
  distance_km: number | null;
  operating_hours?: EventOperatingHours | null;
}
export interface EventResponse {
  events: EventItem[];
  total: number;
  page: number;
  limit: number;
  range: DateRange;
  available_date_range: DateRange | null;
  range_outside_available: boolean;
  mode: string;
  sort?: "recommended" | "date" | "distance";
  nearby_candidate_limited?: boolean;
}
export type EventDetailHighlight = { label: string; tag: string | null; featured: boolean };
export type EventProgramOccurrence = { start_date: string; end_date: string; start_time: string | null; end_time: string | null; human_time_text: string | null; venue: string | null };
export type EventDetailProgram = { name: string; date: string | null; start_time: string | null; end_time: string | null; schedule_text: string | null; venue: string | null; description: string | null; tags: string[]; featured: boolean; occurrences: EventProgramOccurrence[] };
export type EventDetailEnrichment = { summary: string; source_url: string; source_kind: string; source_priority: number; highlights: EventDetailHighlight[]; programs: EventDetailProgram[] };
export type EventDetailImage = { image_url: string; source_type: string | null; source_page_url: string | null; is_primary: boolean; sort_order: number };
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function koreaDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function dateRange(period: Period, now = new Date()) {
  if (period === "custom") throw new Error("custom period requires a date range");
  const today = koreaDate(now);
  if (period === "today") return { start: today, end: today };
  const d = new Date(today + "T00:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(
    d.getUTCDate() +
      (day === 0 ? -1 : 6 - day) +
      (period === "next-weekend" ? 7 : 0),
  );
  const start = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 1);
  return { start, end: d.toISOString().slice(0, 10) };
}
export function distanceKm(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((c - a) * rad) / 2) ** 2 +
    Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
