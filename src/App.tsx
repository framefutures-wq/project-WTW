import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Info,
  MapPin,
  Navigation,
  Phone,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  koreaDate,
  dateRange,
  AUDIENCES,
  THEMES,
  type Period,
  type EventItem,
  type EventResponse,
  type EventDetailEnrichment,
  type DateRange,
  type Tag,
  validDate,
} from "../shared/domain";
import { USER_CONTENT_FILTERS } from "../shared/content-filters";
import { recommendationReasonLabel } from "../shared/recommendation-ranking";
import { REGION_OPTIONS, regionLabel } from "../shared/region-options";
import { formatEventDateLabel } from "../shared/event-date-display";
import { cardImageFit, type ImageFit } from "../shared/image-fit";
import { selectProgramOccurrenceGroup } from "../shared/program-occurrence-selection";
import { formatProgramTime } from "../shared/event-program-time";
import {
  formatOperatingHours,
  selectOperatingHours,
  type EventOperatingHours,
} from "../shared/event-operating-hours";
import {
  MAX_VISIBLE_ITEMS,
  PAGE_SIZE,
  PAGES_PER_BATCH,
  hasNextBatch,
  totalPages,
  uniqueEvents,
} from "../shared/list-exploration";
import {
  cardStatusLabel,
  formatTrustDate,
  hasOfficialSource,
  trustChangeLabel,
} from "./trust";
import {
  initAnalytics,
  trackEventDetailView,
  trackFilterApply,
  trackLoadMore,
  trackNearbyUse,
  trackOfficialLinkClick,
  trackPageView,
  trackPushSubscribe,
  trackPushUnsubscribe,
  trackSearchSubmit,
} from "./analytics";
import type { AnalyticsRuntimeConfig } from "../shared/analytics-config";

type Evidence = {
  field: string;
  excerpt: string;
  checked_at: string;
  name: string;
  url: string | null;
  kind: string;
};
type ContactPhone = { display: string; href: string };
type Detail = {
  event: EventItem;
  evidence: Evidence[];
  contact_phone: ContactPhone | null;
  operating_hours: EventOperatingHours[];
  enrichment: EventDetailEnrichment | null;
};
type PageResponse = Omit<EventResponse, "total"> & { total?: number };
type NearbyLocation = { lat: number; lng: number };
type PushConfig = { enabled: boolean; vapidPublicKey: string | null };
type PushState =
  "loading" | "unsupported" | "ready" | "subscribed" | "denied" | "error";
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
async function readApi<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "정보를 불러오지 못했습니다.";
    throw new ApiError(message, response.status);
  }
  return body as T;
}
const vapidBytes = (key: string) => {
  const padded =
    key.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};
const PERIODS: { value: Period; label: string; small: string }[] = [
  { value: "today", label: "오늘", small: "지금 떠나볼까?" },
  { value: "weekend", label: "이번 주말", small: "기다려온 쉬는 날" },
  { value: "next-weekend", label: "다음 주말", small: "미리 계획해요" },
];
const QUICK_CATEGORIES = [
  { value: "", label: "전체", symbol: "⌁", hint: "모든 행사" },
  { value: "food", label: "먹거리", symbol: "◉", hint: "시장 · 푸드" },
  { value: "fireworks", label: "불꽃", symbol: "✦", hint: "야간 · 불꽃" },
  { value: "flowers", label: "꽃", symbol: "✿", hint: "정원 · 꽃축제" },
  { value: "experience", label: "체험", symbol: "△", hint: "직접 해보기" },
  { value: "performance", label: "공연", symbol: "♫", hint: "공연 · 무대" },
] as const;
const dateLabel = (date: string) => {
  const localDate = date.includes("T") ? koreaDate(new Date(date)) : date;
  return `${Number(localDate.slice(5, 7))}.${Number(localDate.slice(8, 10))}`;
};
const detailDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return year && month && day
    ? `${year}년 ${Number(month)}월 ${Number(day)}일`
    : date;
};
const detailDateRange = (start: string, end: string) =>
  start === end
    ? detailDate(start)
    : `${detailDate(start)} ~ ${detailDate(end)}`;
const detailProgramSchedule = (
  program: EventDetailEnrichment["programs"][number],
) => {
  if (program.schedule_text) return program.schedule_text;
  const occurrences = selectProgramOccurrenceGroup(
    program.occurrences,
    koreaDate(),
  );
  if (occurrences.length) {
    const occurrence = occurrences[0];
    const date =
      occurrence.start_date === occurrence.end_date
        ? `${Number(occurrence.start_date.slice(5, 7))}월 ${Number(occurrence.start_date.slice(8, 10))}일`
        : `${Number(occurrence.start_date.slice(5, 7))}월 ${Number(occurrence.start_date.slice(8, 10))}일 ~ ${Number(occurrence.end_date.slice(5, 7))}월 ${Number(occurrence.end_date.slice(8, 10))}일`;
    const sharedVenue =
      new Set(occurrences.map((item) => item.venue).filter(Boolean)).size === 1;
    const times = occurrences.map((item) => {
      const time = item.start_time
        ? item.end_time
          ? `${formatProgramTime(item.start_time)} ~ ${formatProgramTime(item.end_time)}`
          : formatProgramTime(item.start_time)
        : item.human_time_text;
      return !sharedVenue && item.venue
        ? [time, item.venue].filter(Boolean).join(" · ")
        : time;
    });
    return [date, times.filter(Boolean).join(" / ")]
      .filter(Boolean)
      .join(" · ");
  }
  const date = program.date
    ? `${Number(program.date.slice(5, 7))}월 ${Number(program.date.slice(8, 10))}일`
    : null;
  const time = program.start_time
    ? formatProgramTime(program.start_time)
    : null;
  return [date, time, program.schedule_text].filter(Boolean).join(" · ");
};
const detailProgramVenue = (
  program: EventDetailEnrichment["programs"][number],
) => {
  if (program.schedule_text) return program.venue;
  const occurrences = selectProgramOccurrenceGroup(
    program.occurrences,
    koreaDate(),
  );
  const venues = [
    ...new Set(occurrences.map((item) => item.venue).filter(Boolean)),
  ];
  return venues.length === 1 ? venues[0] : program.venue;
};
const displayDistance = (distance: number | null) => {
  if (distance === null) return "거리 미확인";
  if (distance < 1) return "1km 미만";
  return `약 ${distance < 10 ? distance.toFixed(1) : Math.round(distance)}km`;
};
const tagLabel = (tag: Tag) => ({ ...AUDIENCES, ...THEMES })[tag];
const safeUrl = (url: string | null | undefined) => {
  try {
    return url && new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};
const officialDetailSource = (detail: Detail) =>
  detail.enrichment &&
  ["organizer", "municipality"].includes(detail.enrichment.source_kind) &&
  detail.enrichment.source_priority <= 2
    ? safeUrl(detail.enrichment.source_url)
    : undefined;
function TrustInfo({
  event,
  card = false,
}: {
  event: EventItem;
  card?: boolean;
}) {
  if (event.is_sample === 1) return null;
  if (card) {
    const label = cardStatusLabel(event);
    return label ? (
      <span className="trust-card trust-changed">
        <Info size={13} /> {label}
      </span>
    ) : null;
  }
  if (!event.trust_status) return null;
  const changed = event.trust_status === "changed";
  if (event.trust_status === "confirmed") return null;
  return (
    <section
      className={`trust-info trust-${event.trust_status}`}
      aria-label="행사 신뢰정보"
    >
      <div className="trust-info-heading">
        <span className="trust-info-icon">
          {changed ? <Info size={18} /> : <ShieldCheck size={18} />}
        </span>
        <div>
          <h3>
            {changed
              ? trustChangeLabel(event.trust_changed_fields)
              : "일부 정보는 공식 확인 중이에요."}
          </h3>
          {changed && <p>공식 안내에서 행사 정보 변경을 확인했어요.</p>}
        </div>
      </div>
    </section>
  );
}
function StatusNotice({ event }: { event: EventItem }) {
  if (event.status === "cancelled")
    return (
      <div className="detail-warning">이 행사는 취소된 것으로 확인됐어요.</div>
    );
  if (event.status === "postponed")
    return (
      <div className="detail-warning">이 행사는 연기된 것으로 확인됐어요.</div>
    );
  if (event.status === "unknown")
    return (
      <div className="detail-status-note">
        개최 여부는 출발 전 공식 안내를 확인해 주세요.
      </div>
    );
  return null;
}
function usefulDescription(value: string) {
  const text = value.trim();
  return text && !/^한국관광공사 TourAPI에 등록된 행사입니다/.test(text)
    ? text
    : null;
}
function locationLines(event: EventItem) {
  const venue = event.venue.trim();
  const address = event.address.trim();
  return {
    primary: venue && venue !== address ? venue : address || venue,
    secondary: venue && address && venue !== address ? address : null,
  };
}
export function EventImageLayers({
  image,
  title,
  backdrop,
  loading,
  onImageLoad,
  onImageError,
}: {
  image: string;
  title: string;
  backdrop: boolean;
  loading: "eager" | "lazy";
  onImageLoad?: (width: number, height: number) => void;
  onImageError?: () => void;
}) {
  return (
    <>
      {backdrop && (
        <img
          className="scene-image scene-image-backdrop"
          src={image}
          alt=""
          aria-hidden="true"
          loading={loading}
        />
      )}
      <img
        className="scene-image scene-image-foreground"
        src={image}
        alt={`${title} 대표 이미지`}
        loading={loading}
        onLoad={(event) =>
          onImageLoad?.(
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight,
          )
        }
        onError={onImageError}
      />
    </>
  );
}
function Scene({
  event,
  detail = false,
  onExpand,
}: {
  event: EventItem;
  detail?: boolean;
  onExpand?: (image: string, title: string) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [fit, setFit] = useState<ImageFit>("cover");
  const theme = event.tags.find((t) => t in THEMES) ?? "experience";
  const icons = {
    flowers: "✿",
    food: "◒",
    fireworks: "✺",
    experience: "△",
    performance: "♫",
  };
  const image = safeUrl(event.image_url);
  const className = `scene scene-${theme}${detail ? " scene-detail" : ""}${image && !imageFailed ? " scene-with-image" : ""}${fit === "contain" && !detail ? " scene-contain" : ""}`;
  const content = (
    <>
      {image && !imageFailed && (
        <EventImageLayers
          image={image}
          title={event.title}
          backdrop={detail || fit === "contain"}
          loading={detail ? "eager" : "lazy"}
          onImageLoad={(width, height) => setFit(cardImageFit(width, height))}
          onImageError={() => setImageFailed(true)}
        />
      )}
      {(!image || imageFailed) && (
        <div className="scene-fallback" aria-hidden="true">
          <div className="scene-sun" />
          <div className="hill hill-one" />
          <div className="hill hill-two" />
          <span className="scene-symbol">
            {icons[theme as keyof typeof icons]}
          </span>
          <span className="scene-stem" />
          <span className="scene-dot dot-one" />
          <span className="scene-dot dot-two" />
          <span className="scene-caption">
            {THEMES[theme as keyof typeof THEMES]}를 만나는 하루
          </span>
          <span className="sample-stamp">
            {event.is_sample ? "가상 행사" : "주제 일러스트"}
          </span>
        </div>
      )}
    </>
  );
  if (detail && image && !imageFailed && onExpand)
    return (
      <button
        type="button"
        className={className}
        onClick={() => onExpand(image, event.title)}
        aria-label={`${event.title} 대표 이미지 크게 보기`}
      >
        {content}
        <span className="scene-expand-hint" aria-hidden="true">
          ⌕
        </span>
      </button>
    );
  return <div className={className}>{content}</div>;
}
function eventIdFromPath(pathname: string) {
  const match = /^\/events\/([^/]{1,240})$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export default function App() {
  const initialParams = useRef(
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search),
  ).current;
  const initialPeriod = initialParams.get("period");
  const initialDate = initialParams.get("date");
  const initialStart = initialParams.get("startDate");
  const initialEnd = initialParams.get("endDate");
  const initialCustomRange =
    initialPeriod === "custom" &&
    ((initialDate && validDate(initialDate)) ||
      (initialStart &&
        initialEnd &&
        validDate(initialStart) &&
        validDate(initialEnd)))
      ? { start: initialDate ?? initialStart!, end: initialDate ?? initialEnd! }
      : null;
  const initialRegion = REGION_OPTIONS.some(
    ({ queryValue }) => queryValue === initialParams.get("region"),
  )
    ? initialParams.get("region")!
    : "";
  const initialAudience = Object.prototype.hasOwnProperty.call(
    AUDIENCES,
    initialParams.get("audience") ?? "",
  )
    ? initialParams.get("audience")!
    : "";
  const initialTheme = Object.prototype.hasOwnProperty.call(
    THEMES,
    initialParams.get("theme") ?? "",
  )
    ? initialParams.get("theme")!
    : "";
  const initialPathEvent = useRef(
    typeof window === "undefined" ? null : eventIdFromPath(window.location.pathname),
  ).current;
  const initialQueryEvent = /^[a-zA-Z0-9_-]{1,80}$/.test(
    initialParams.get("event") ?? "",
  )
    ? initialParams.get("event")!
    : null;
  const initialEvent = initialPathEvent ?? initialQueryEvent;
  const [period, setPeriod] = useState<Period>(
    initialPeriod === "today" ||
      initialPeriod === "next-weekend" ||
      (initialPeriod === "custom" && initialCustomRange)
      ? (initialPeriod as Period)
      : "weekend",
  );
  const [customRange, setCustomRange] = useState<DateRange | null>(
    initialCustomRange,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"day" | "range">("day");
  const [pickerStart, setPickerStart] = useState("");
  const [pickerEnd, setPickerEnd] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [availableDateRange, setAvailableDateRange] =
    useState<DateRange | null>(null);
  const [region, setRegion] = useState(initialRegion),
    [audience, setAudience] = useState(initialAudience),
    [theme, setTheme] = useState(initialTheme);
  const [search, setSearch] = useState(initialParams.get("q") ?? ""),
    [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [sort, setSort] = useState(
      initialParams.get("sort") === "date" ? "date" : "recommended",
    ),
    [location, setLocation] = useState<NearbyLocation | null>(null);
  const [geoBusy, setGeoBusy] = useState(false),
    [geoError, setGeoError] = useState("");
  const [data, setData] = useState<EventResponse | null>(null),
    [events, setEvents] = useState<EventItem[]>([]),
    [batchStart, setBatchStart] = useState(1),
    [loadedPages, setLoadedPages] = useState(1),
    [extraLoading, setExtraLoading] = useState(false),
    [extraError, setExtraError] = useState(""),
    [failedPage, setFailedPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialEvent),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(""),
    [lightbox, setLightbox] = useState<{ image: string; title: string } | null>(
      null,
    );
  const [detailRetry, setDetailRetry] = useState(0);
  const [mode, setMode] = useState(""),
    [about, setAbout] = useState(false),
    [compactHeader, setCompactHeader] = useState(false);
  const [analyticsConfig, setAnalyticsConfig] =
    useState<AnalyticsRuntimeConfig | null>(null);
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null),
    [pushState, setPushState] = useState<PushState>("loading"),
    [pushError, setPushError] = useState(""),
    [pushTypes, setPushTypes] = useState({
      new_event: true,
      schedule_changed: true,
      cancelled_or_postponed: true,
    });
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null),
    resultsRef = useRef<HTMLElement | null>(null),
    heroRef = useRef<HTMLElement | null>(null),
    regionFilterRef = useRef<HTMLSelectElement | null>(null),
    contentFilterRef = useRef<HTMLDivElement | null>(null),
    advancedFiltersRef = useRef<HTMLDetailsElement | null>(null),
    batchProgress = useRef(
      new Map<number, { loadedPages: number; scrollY: number }>(),
    ),
    lastTrackedSearch = useRef(initialParams.get("q") ?? ""),
    detailHistory = useRef(false),
    lightboxClose = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    initAnalytics().then((next) => {
      setAnalyticsConfig(next);
      trackPageView("initial");
    });
  }, []);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCompactHeader(entry.intersectionRatio < 0.2),
      { threshold: [0, 0.2], rootMargin: "-68px 0px 0px 0px" },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    fetch("/api/meta")
      .then(readApi<{ available_date_range: DateRange | null }>)
      .then((body) => setAvailableDateRange(body.available_date_range))
      .catch(() => setAvailableDateRange(null));
  }, []);
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      !window.isSecureContext
    ) {
      setPushState("unsupported");
      return;
    }
    Promise.all([
      fetch("/api/push/config").then(readApi<PushConfig>),
      navigator.serviceWorker.register("/sw.js"),
    ])
      .then(async ([config, registration]) => {
        setPushConfig(config);
        if (!config.enabled) {
          setPushState("unsupported");
          return;
        }
        if (Notification.permission === "denied") {
          setPushState("denied");
          return;
        }
        setPushState(
          (await registration.pushManager.getSubscription())
            ? "subscribed"
            : "ready",
        );
      })
      .catch(() => setPushState("unsupported"));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selected) return;
    const params = new URLSearchParams();
    params.set("period", customRange ? "custom" : period);
    if (customRange) {
      if (customRange.start === customRange.end)
        params.set("date", customRange.start);
      else {
        params.set("startDate", customRange.start);
        params.set("endDate", customRange.end);
      }
    }
    for (const [key, value] of Object.entries({
      region,
      audience,
      theme,
    }))
      if (value) params.set(key, value);
    if (sort !== "recommended" && !location) params.set("sort", sort);
    const next = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      next ? `/?${next}` : "/",
    );
  }, [period, customRange, region, audience, theme, query, sort, selected]);
  const requestParams = (requestedPage: number, includeTotal = true) => {
    const params = new URLSearchParams({
      period: customRange ? "custom" : period,
      sort,
      page: String(requestedPage),
      limit: String(PAGE_SIZE),
    });
    if (customRange) {
      if (customRange.start === customRange.end)
        params.set("date", customRange.start);
      else {
        params.set("startDate", customRange.start);
        params.set("endDate", customRange.end);
      }
    }
    for (const [key, value] of Object.entries({
      region,
      audience,
      theme,
      q: query,
    }))
      if (value) params.set(key, value);
    if (!includeTotal) params.set("includeTotal", "0");
    return params;
  };
  const fetchPage = async (
    requestedPage: number,
    signal?: AbortSignal,
    includeTotal = true,
  ) => {
    const params = requestParams(requestedPage, includeTotal);
    const nearbyBody = Object.fromEntries(params);
    delete nearbyBody.sort;
    delete nearbyBody.includeTotal;
    const response = location
      ? await fetch("/api/events/nearby", {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...nearbyBody,
            lat: location.lat,
            lng: location.lng,
          }),
        })
      : await fetch("/api/events?" + params, { signal });
    return readApi<PageResponse>(response);
  };
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setExtraError("");
    setData(null);
    setEvents([]);
    setBatchStart(1);
    setLoadedPages(1);
    batchProgress.current.clear();
    fetchPage(1, controller.signal)
      .then((body) => {
        setData(body as EventResponse);
        setEvents(uniqueEvents(body.events));
        setMode(body.mode);
        if (query && lastTrackedSearch.current !== query) {
          lastTrackedSearch.current = query;
          trackSearchSubmit(query, body.total ?? 0);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("잠시 연결이 어려워요. 잠시 후 다시 시도해 주세요.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [
    period,
    customRange,
    region,
    audience,
    theme,
    query,
    sort,
    location,
    retry,
  ]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setDetailError("");
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    fetch("/api/events/" + selected, { signal: controller.signal })
      .then(readApi<Detail>)
      .then((body) => {
        setDetail(body);
        trackEventDetailView(
          body.event.id,
          body.event.region,
          body.event.source_kind,
          customRange ? "custom" : period,
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setDetailError(
            e instanceof ApiError && e.status === 404
              ? "행사를 찾을 수 없어요. 목록에서 다른 행사를 확인해 주세요."
              : "잠시 정보를 불러오지 못했어요. 다시 시도해 주세요.",
          );
        }
      });
    return () => controller.abort();
  }, [selected, detailRetry, customRange, period]);
  useEffect(() => {
    if (!selected || detailHistory.current) return;
    const detailUrl = new URL(window.location.href);
    const canonicalPath = `/events/${encodeURIComponent(selected)}`;
    if (detailUrl.pathname === canonicalPath) {
      detailHistory.current = false;
      return;
    }
    // Shared legacy query URLs remain usable, but are normalized without adding
    // a history entry so the canonical page has a single public address.
    if (detailUrl.pathname === "/" && detailUrl.searchParams.get("event") === selected) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), eventDetail: selected },
        "",
        canonicalPath,
      );
      detailHistory.current = false;
      return;
    }
    window.history.pushState(
      {
        ...(window.history.state ?? {}),
        eventDetail: selected,
        listUrl: detailUrl.pathname + detailUrl.search,
      },
      "",
      canonicalPath,
    );
    detailHistory.current = true;
    const onPopState = () => {
      if (detailHistory.current) {
        detailHistory.current = false;
        setSelected(null);
        trackPageView("list");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [selected]);
  useEffect(() => {
    if (selected || about) {
      opener.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      opener.current?.focus();
    }
  }, [selected, about]);
  useEffect(() => {
    if (!lightbox) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    lightboxClose.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightbox]);
  function reset() {
    setPeriod("weekend");
    setCustomRange(null);
    setPickerOpen(false);
    setPickerError("");
    setRegion("");
    setAudience("");
    setTheme("");
    setSearch("");
    setQuery("");
    setLocation(null);
    setGeoError("");
    setSort("date");
  }
  function openPicker() {
    const fallback = availableDateRange?.start ?? koreaDate();
    const current = customRange ?? { start: fallback, end: fallback };
    setPickerMode(current.start === current.end ? "day" : "range");
    setPickerStart(current.start);
    setPickerEnd(current.end);
    setPickerError("");
    setPickerOpen(true);
  }
  function applyPicker() {
    const start = pickerStart,
      end = pickerMode === "day" ? pickerStart : pickerEnd;
    if (!validDate(start) || !validDate(end)) {
      setPickerError("날짜를 확인해 주세요.");
      return;
    }
    if (end < start) {
      setPickerError("종료일은 시작일보다 빠를 수 없어요.");
      return;
    }
    if (
      availableDateRange &&
      (end < availableDateRange.start || start > availableDateRange.end)
    ) {
      setPickerError("현재 등록된 행사 일정 범위를 벗어난 날짜입니다.");
      return;
    }
    setCustomRange({ start, end });
    setPeriod("custom");
    trackFilterApply("period", "custom");
    setPickerOpen(false);
  }
  function choosePreset(value: Period) {
    setCustomRange(null);
    setPickerOpen(false);
    setPickerError("");
    setPeriod(value);
    trackFilterApply("period", value);
  }
  function locate() {
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError("이 브라우저에서는 위치를 사용할 수 없습니다.");
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({
          lat: Number(p.coords.latitude.toFixed(3)),
          lng: Number(p.coords.longitude.toFixed(3)),
        });
        setRegion("");
        setSort("distance");
        trackNearbyUse("granted");
        setGeoBusy(false);
      },
      (error) => {
        trackNearbyUse(
          error.code === error.PERMISSION_DENIED ? "denied" : "error",
        );
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "위치 권한이 꺼져 있어요. 지역을 선택해서 찾아볼 수 있어요."
            : error.code === error.TIMEOUT
              ? "위치를 확인하지 못했어요. 다시 시도해 주세요."
              : "위치를 확인하지 못했어요. 다시 시도해 주세요.",
        );
        setGeoBusy(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }
  const change = (
    fn: (v: string) => void,
    value: string,
    filterType?: "region" | "audience" | "theme" | "sort",
  ) => {
    fn(value);
    if (filterType) trackFilterApply(filterType, value || "all");
  };
  const rememberBatch = () => {
    batchProgress.current.set(batchStart, {
      loadedPages,
      scrollY: window.scrollY,
    });
  };
  const mergeEvents = (current: EventItem[], incoming: EventItem[]) =>
    uniqueEvents([...current, ...incoming]).slice(0, MAX_VISIBLE_ITEMS);
  async function loadMore() {
    if (
      !data ||
      extraLoading ||
      loadedPages >= PAGES_PER_BATCH ||
      events.length >= MAX_VISIBLE_ITEMS ||
      batchStart + loadedPages > totalPages(data.total)
    )
      return;
    const requestedPage = batchStart + loadedPages;
    setExtraLoading(true);
    setExtraError("");
    setFailedPage(null);
    try {
      const body = await fetchPage(requestedPage, undefined, false);
      setData((current) =>
        current ? { ...body, total: current.total } : (body as EventResponse),
      );
      setEvents((current) => mergeEvents(current, body.events));
      setLoadedPages((current) => current + 1);
      trackLoadMore(requestedPage);
    } catch {
      setFailedPage(requestedPage);
      setExtraError("추가 행사를 불러오지 못했어요.");
    } finally {
      setExtraLoading(false);
    }
  }
  async function loadNextBatch() {
    if (!data || extraLoading || !hasNextBatch(batchStart, data.total)) return;
    const nextStart = batchStart + PAGES_PER_BATCH;
    rememberBatch();
    setExtraLoading(true);
    setExtraError("");
    setFailedPage(null);
    try {
      const body = await fetchPage(nextStart, undefined, false);
      setData((current) =>
        current ? { ...body, total: current.total } : (body as EventResponse),
      );
      setEvents(uniqueEvents(body.events));
      setBatchStart(nextStart);
      setLoadedPages(1);
      trackLoadMore(nextStart);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    } catch {
      setExtraError("다음 행사 묶음을 불러오지 못했어요.");
    } finally {
      setExtraLoading(false);
    }
  }
  async function loadPreviousBatch() {
    if (!data || extraLoading || batchStart <= 1) return;
    const previousStart = Math.max(1, batchStart - PAGES_PER_BATCH);
    const saved = batchProgress.current.get(previousStart);
    const targetPages = Math.min(saved?.loadedPages ?? 1, PAGES_PER_BATCH);
    rememberBatch();
    setExtraLoading(true);
    setExtraError("");
    setFailedPage(null);
    try {
      const pages = await Promise.all(
        Array.from({ length: targetPages }, (_, index) =>
          fetchPage(previousStart + index, undefined, false),
        ),
      );
      setData((current) =>
        current
          ? { ...pages[pages.length - 1], total: current.total }
          : (pages[pages.length - 1] as EventResponse),
      );
      setEvents(
        uniqueEvents(pages.flatMap((body) => body.events)).slice(
          0,
          MAX_VISIBLE_ITEMS,
        ),
      );
      setBatchStart(previousStart);
      setLoadedPages(targetPages);
      requestAnimationFrame(() => {
        if (saved)
          window.scrollTo({
            top: saved.scrollY,
            behavior: "instant" as ScrollBehavior,
          });
        else
          resultsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      });
    } catch {
      setExtraError("이전 행사 묶음을 불러오지 못했어요.");
    } finally {
      setExtraLoading(false);
    }
  }
  async function retryExtra() {
    if (failedPage === null || extraLoading) return;
    setExtraLoading(true);
    setExtraError("");
    try {
      const body = await fetchPage(failedPage, undefined, false);
      setData((current) =>
        current ? { ...body, total: current.total } : (body as EventResponse),
      );
      setEvents((current) => mergeEvents(current, body.events));
      setLoadedPages((current) =>
        Math.max(current, failedPage - batchStart + 1),
      );
      setFailedPage(null);
    } catch {
      setExtraError("추가 행사를 불러오지 못했어요.");
    } finally {
      setExtraLoading(false);
    }
  }
  function focusFilter(target: "region" | "theme") {
    if (target === "theme" && advancedFiltersRef.current)
      advancedFiltersRef.current.open = true;
    const element =
      target === "region" ? regionFilterRef.current : contentFilterRef.current;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target === "region") element?.focus();
    else
      requestAnimationFrame(() =>
        (element?.querySelector("button") as HTMLButtonElement | null)?.focus(),
      );
  }
  const pushScope = [
    region ? regionLabel(region) : null,
    audience ? AUDIENCES[audience as keyof typeof AUDIENCES] : null,
    theme ? THEMES[theme as keyof typeof THEMES] : null,
  ].filter(Boolean) as string[];
  async function subscribePush() {
    if (!pushConfig?.enabled || pushState === "unsupported") return;
    if (!pushScope.length) {
      setPushError(
        location
          ? "내 주변 위치는 저장하지 않아요. 지역·누구와·무엇을 중 하나를 선택해 주세요."
          : "지역·누구와·무엇을 중 하나를 선택해 주세요.",
      );
      return;
    }
    setPushError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidBytes(pushConfig.vapidPublicKey!),
        }));
      await readApi<{ ok: boolean }>(
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            preferences: {
              region: region || null,
              audience: audience || null,
              theme: theme || null,
              ...pushTypes,
            },
          }),
        }),
      );
      setPushState("subscribed");
      trackPushSubscribe({
        region: Boolean(region),
        audience: Boolean(audience),
        theme: Boolean(theme),
      });
    } catch {
      setPushState("error");
      setPushError(
        "알림 설정을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }
  async function unsubscribePush() {
    try {
      const registration = await navigator.serviceWorker.ready,
        subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPushState("ready");
      trackPushUnsubscribe();
    } catch {
      setPushError(
        "알림 해지를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }
  const active = Boolean(
    customRange || region || audience || theme || query || location,
  );
  const selectedRangeLabel = customRange
    ? customRange.start === customRange.end
      ? `${dateLabel(customRange.start)}에 열리는 행사`
      : `${dateLabel(customRange.start)} ~ ${dateLabel(customRange.end)}에 열리는 행사`
    : `${PERIODS.find((p) => p.value === period)?.label}에 열리는 행사`;
  const eventDisplayRange = data?.range ?? customRange ?? dateRange(period);
  const heroEvent =
    events.slice(4).find((event) => safeUrl(event.image_url)) ??
    events.find((event) => safeUrl(event.image_url)) ??
    null;
  const heroImage = heroEvent ? safeUrl(heroEvent.image_url) : undefined;
  const discoveryMode = !active && sort === "recommended" && !location;
  const featuredEvents = discoveryMode ? events.slice(0, 4) : [];
  const listEvents = discoveryMode ? events.slice(4) : events;
  const activeFilterLabels = [
    customRange ? selectedRangeLabel : null,
    region ? regionLabel(region) : null,
    audience ? AUDIENCES[audience as keyof typeof AUDIENCES] : null,
    theme ? THEMES[theme as keyof typeof THEMES] : null,
    query ? `검색: ${query}` : null,
    location ? "내 주변" : null,
  ].filter(Boolean) as string[];
  const renderEventCard = (event: EventItem) => (
    <article className="event-card" key={event.id}>
      <button
        className="card-button"
        onClick={() => setSelected(event.id)}
        aria-label={`${event.title} 상세 보기`}
      >
        <Scene event={event} />
        <div className="card-content">
          <div className="card-meta">
            <span>
              <MapPin size={13} />
              {event.region}
            </span>
          </div>
          {sort === "recommended" &&
            !location &&
            (() => {
              const reason = recommendationReasonLabel(
                event,
                eventDisplayRange,
                customRange ? "custom" : period,
              );
              return reason ? (
                <span className="recommendation-reason">{reason}</span>
              ) : null;
            })()}
          <h3>{event.title}</h3>
          <p className="venue">{event.venue}</p>
          <p className="event-date">
            <CalendarDays size={14} />
            {formatEventDateLabel({
              eventStart: event.start_date,
              eventEnd: event.end_date,
              selectedRange: eventDisplayRange,
              selectionMode: customRange ? "custom" : period,
            })}
            {location && (
              <span className="distance">
                {event.distance_km === null
                  ? "거리 미확인"
                  : displayDistance(event.distance_km)}
              </span>
            )}
          </p>
          {formatOperatingHours(event.operating_hours ?? null) && (
            <p className="event-hours">
              <Clock3 size={14} />
              {formatOperatingHours(event.operating_hours ?? null)}
            </p>
          )}
          <div className="card-tags">
            {event.tags.slice(0, 3).map((t) => (
              <span key={t}>#{tagLabel(t)}</span>
            ))}
          </div>
          <div
            className={`card-bottom${cardStatusLabel(event) ? " card-bottom-status" : ""}`}
          >
            {event.is_sample ? (
              <span>
                <Info size={13} />
                실제 행사가 아닌 샘플
              </span>
            ) : (
              <TrustInfo event={event} card />
            )}
            <ArrowRight size={17} />
          </div>
        </div>
      </button>
    </article>
  );
  const close = () => {
    if (selected && detailHistory.current) {
      window.history.back();
      return;
    }
    setSelected(null);
    setAbout(false);
    if (selected) trackPageView("list");
  };
  return (
    <>
      <header className={compactHeader ? "header header-compact" : "header"}>
        <div className="header-inner">
          <a href="/" className="brand" aria-label="갈틈 홈">
            갈틈
          </a>
          {!compactHeader && (
            <span className="header-tagline">
              오늘, 어디 가지?
            </span>
          )}
          {compactHeader && (
            <>
              <form
                className="compact-search"
                role="search"
                aria-label="상단 행사 검색"
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(search.trim());
                  resultsRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              >
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="어디 갈까요?"
                  aria-label="상단 행사 이름 또는 장소 검색"
                  maxLength={80}
                />
                {search && (
                  <button
                    type="button"
                    className="compact-search-clear"
                    onClick={() => setSearch("")}
                    aria-label="상단 검색어 지우기"
                  >
                    <X size={15} />
                  </button>
                )}
                <button
                  type="submit"
                  className="compact-search-submit"
                  aria-label="상단에서 검색하기"
                >
                  <Search size={16} />
                </button>
              </form>
              <label className="compact-region">
                <MapPin size={15} />
                <select
                  aria-label="상단 지역"
                  value={region}
                  onChange={(event) => {
                    if (location) {
                      setLocation(null);
                      setSort("date");
                    }
                    change(setRegion, event.target.value, "region");
                  }}
                >
                  <option value="">전국</option>
                  {REGION_OPTIONS.map(({ queryValue, label }) => (
                    <option key={queryValue} value={queryValue}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="compact-category"
                onClick={() => focusFilter("theme")}
              >
                <SlidersHorizontal size={15} />
                카테고리
              </button>
            </>
          )}
          <button className="trust-link" onClick={() => setAbout(true)}>
            <ShieldCheck size={17} />
            정보 확인 원칙
          </button>
        </div>
      </header>
      {mode === "sample" && (
        <div className="sample-banner">
          <Info size={15} />
          <span>
            <strong>샘플 미리보기</strong> · 모든 행사는 가상 데이터입니다. 실제
            일정·장소·가격으로 사용하지 마세요.
          </span>
        </div>
      )}
      <main>
        <section
          ref={heroRef}
          className={heroImage ? "hero hero-with-image" : "hero"}
        >
          {heroImage && (
            <img
              className="hero-media"
              src={heroImage}
              alt=""
              aria-hidden="true"
              loading="eager"
            />
          )}
          <div className="hero-shade" aria-hidden="true" />
          <div className="hero-copy">
            <span className="eyebrow">
              <span /> 오늘은 어디 가볼까?
            </span>
            <h1>
              드디어,
              <br />
              <span>놀러 갈 틈이 생겼다.</span>
            </h1>
            <p>
              함께하는 사람과 원하는 날짜에 맞춰, 가까운 축제부터 지역 행사·체험까지.
              <br className="desktop-break" />
              갈 만한 곳을 찾아보세요.
            </p>
            <div className="hero-note">
              <Compass size={17} />
              계획은 가볍게, 하루는 특별하게
            </div>
            <form
              className="hero-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim());
                resultsRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              <label className="hero-search-field">
                <Search size={21} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="축제, 행사, 장소를 검색해 보세요"
                  aria-label="행사 이름 또는 장소 검색"
                  maxLength={80}
                />
                {search && (
                  <button
                    type="button"
                    className="hero-search-clear"
                    onClick={() => setSearch("")}
                    aria-label="검색어 지우기"
                  >
                    <X size={16} />
                  </button>
                )}
              </label>
              <button type="submit" className="hero-search-submit">
                찾아보기
              </button>
            </form>
          </div>
        </section>
        <section className="quick-discovery" aria-label="빠른 카테고리">
          <div className="quick-discovery-heading">
            <div>
              <span>빠르게 둘러보기</span>
              <h2>뭐 하고 싶어요?</h2>
            </div>
            <p>관심 있는 주제를 누르면 바로 골라드려요.</p>
          </div>
          <div className="quick-category-grid">
            {QUICK_CATEGORIES.map((category) => (
              <button
                key={category.value || "all"}
                className={
                  theme === category.value
                    ? "quick-category active"
                    : "quick-category"
                }
                onClick={() =>
                  change(
                    setTheme,
                    theme === category.value && category.value ? "" : category.value,
                    "theme",
                  )
                }
                aria-pressed={theme === category.value}
              >
                <span className="quick-category-symbol" aria-hidden="true">
                  {category.symbol}
                </span>
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="discovery" aria-label="행사 검색 및 필터">
          <div className="periods">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                className={period === p.value ? "period active" : "period"}
                onClick={() => choosePreset(p.value)}
                aria-pressed={period === p.value}
              >
                <CalendarDays size={20} />
                <span>
                  <strong>{p.label}</strong>
                  <small>{p.small}</small>
                </span>
                {period === p.value && <Check size={16} />}
              </button>
            ))}
            <button
              className={period === "custom" ? "period active" : "period"}
              onClick={openPicker}
              aria-pressed={period === "custom"}
            >
              <CalendarDays size={20} />
              <span>
                <strong>날짜 선택</strong>
                <small>원하는 날을 골라요</small>
              </span>
              {period === "custom" && <Check size={16} />}
            </button>
          </div>
          {pickerOpen && (
            <div className="date-picker" aria-label="날짜 선택">
              <div className="date-picker-heading">
                <div>
                  <strong>어떤 날의 행사를 볼까요?</strong>
                  <p>현재 등록된 행사 일정 안에서 선택할 수 있어요.</p>
                </div>
                <button
                  className="date-picker-close"
                  onClick={() => setPickerOpen(false)}
                >
                  <X size={16} />
                  닫기
                </button>
              </div>
              <div
                className="date-mode"
                role="group"
                aria-label="날짜 선택 방식"
              >
                <button
                  className={pickerMode === "day" ? "chosen" : ""}
                  onClick={() => {
                    setPickerMode("day");
                    setPickerEnd(pickerStart);
                    setPickerError("");
                  }}
                  aria-pressed={pickerMode === "day"}
                >
                  하루
                </button>
                <button
                  className={pickerMode === "range" ? "chosen" : ""}
                  onClick={() => {
                    setPickerMode("range");
                    setPickerError("");
                  }}
                  aria-pressed={pickerMode === "range"}
                >
                  기간
                </button>
              </div>
              <div className="date-inputs">
                <label>
                  {pickerMode === "day" ? "날짜" : "시작일"}
                  <input
                    type="date"
                    value={pickerStart}
                    min={availableDateRange?.start}
                    max={availableDateRange?.end}
                    onChange={(e) => {
                      setPickerStart(e.target.value);
                      if (pickerMode === "day") setPickerEnd(e.target.value);
                      setPickerError("");
                    }}
                  />
                </label>
                {pickerMode === "range" && (
                  <label>
                    종료일
                    <input
                      type="date"
                      value={pickerEnd}
                      min={pickerStart || availableDateRange?.start}
                      max={availableDateRange?.end}
                      onChange={(e) => {
                        setPickerEnd(e.target.value);
                        setPickerError("");
                      }}
                    />
                  </label>
                )}
                <button className="primary date-apply" onClick={applyPicker}>
                  이 날짜로 보기
                </button>
              </div>
              {pickerError && (
                <p className="date-picker-error" role="alert">
                  {pickerError}
                </p>
              )}
            </div>
          )}
          <div className="filter-body">
            <div className="search-row">
              <label className="region-select">
                <MapPin size={18} />
                <select
                  ref={regionFilterRef}
                  aria-label="지역"
                  value={region}
                  onChange={(e) => {
                    if (location) {
                      setLocation(null);
                      setSort("date");
                    }
                    change(setRegion, e.target.value, "region");
                  }}
                >
                  <option value="">전국 어디든</option>
                  {REGION_OPTIONS.map(({ queryValue, label }) => (
                    <option key={queryValue} value={queryValue}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="location-button"
                onClick={() => {
                  if (location) {
                    setLocation(null);
                    setSort("date");
                    return;
                  }
                  locate();
                }}
                disabled={geoBusy}
                aria-pressed={Boolean(location)}
              >
                <Navigation size={16} />
                {geoBusy
                  ? "확인 중…"
                  : location
                    ? "내 주변 해제"
                    : "내 주변 찾기"}
              </button>
            </div>
            <details
              ref={advancedFiltersRef}
              className="advanced-filters"
              open={Boolean(
                audience ||
                  theme ||
                  geoError ||
                  location ||
                  pushState === "subscribed",
              )}
            >
              <summary>
                <span>
                  <SlidersHorizontal size={16} />
                  세부 필터
                </span>
                <small>누구와 · 주제 · 알림</small>
              </summary>
              <div className="advanced-filter-body">
                <div className="filter-row">
                  <span className="filter-label">누구와</span>
                  <div className="chips">
                    <button
                      className={!audience ? "chip chosen" : "chip"}
                      onClick={() => change(setAudience, "", "audience")}
                      aria-pressed={!audience}
                    >
                      누구든
                    </button>
                    {Object.entries(AUDIENCES).map(([v, label]) => (
                      <button
                        key={v}
                        className={audience === v ? "chip chosen" : "chip"}
                        onClick={() =>
                          change(setAudience, audience === v ? "" : v, "audience")
                        }
                        aria-pressed={audience === v}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="filter-row">
                  <span className="filter-label">무엇을</span>
                  <div className="chips" ref={contentFilterRef} tabIndex={-1}>
                    <button
                      className={!theme ? "chip chosen" : "chip"}
                      onClick={() => change(setTheme, "", "theme")}
                      aria-pressed={!theme}
                    >
                      모두
                    </button>
                    {USER_CONTENT_FILTERS.map(({ queryValue: v, label }) => (
                      <button
                        key={v}
                        className={theme === v ? "chip chosen" : "chip"}
                        onClick={() =>
                          change(setTheme, theme === v ? "" : v, "theme")
                        }
                        aria-pressed={theme === v}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {geoError && (
                  <p className="inline-error" role="alert">
                    {geoError}
                  </p>
                )}
                {location && (
                  <p className="distance-note">
                    위치는 이 탭의 메모리에만 두며, 거리 계산에는 반올림한 좌표만
                    사용합니다. 거리는 직선거리입니다.{" "}
                    <button
                      onClick={() => {
                        setLocation(null);
                        setSort("date");
                      }}
                    >
                      위치 사용 해제
                    </button>
                  </p>
                )}
                {pushState !== "unsupported" && pushConfig?.enabled && (
                  <div className="push-control" aria-live="polite">
                    <div>
                      <strong>
                        <Bell size={16} />{" "}
                        {pushState === "subscribed"
                          ? "알림 받는 중"
                          : "이 조건 알림받기"}
                      </strong>
                      <p>
                        {pushState === "subscribed"
                          ? `${pushScope.join(" · ")} 조건의 알림을 받고 있어요.`
                          : "새 행사나 중요한 일정 변경이 확인되면 알려드려요."}
                      </p>
                    </div>
                    {pushState === "subscribed" ? (
                      <span className="push-actions">
                        <button className="secondary" onClick={subscribePush}>
                          조건 업데이트
                        </button>
                        <button className="secondary" onClick={unsubscribePush}>
                          알림 끄기
                        </button>
                      </span>
                    ) : pushState === "denied" ? (
                      <span className="push-note">
                        브라우저 설정에서 알림 권한을 변경할 수 있어요.
                      </span>
                    ) : (
                      <button className="primary" onClick={subscribePush}>
                        이 조건 알림받기
                      </button>
                    )}
                    {pushState !== "subscribed" && pushState !== "denied" && (
                      <div
                        className="push-types"
                        role="group"
                        aria-label="받을 알림 종류"
                      >
                        {(
                          [
                            ["new_event", "새 행사"],
                            ["schedule_changed", "일정 변경"],
                            ["cancelled_or_postponed", "취소·연기"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={pushTypes[key]}
                              onChange={(event) =>
                                setPushTypes((current) => ({
                                  ...current,
                                  [key]: event.target.checked,
                                }))
                              }
                            />{" "}
                            {label}
                          </label>
                        ))}
                      </div>
                    )}
                    {pushError && (
                      <p className="inline-error" role="alert">
                        {pushError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </details>
            {activeFilterLabels.length > 0 && (
              <div className="active-filters" aria-label="현재 선택한 조건">
                <span className="active-filters-label">현재 조건</span>
                <div className="active-filter-list">
                  {activeFilterLabels.map((label) => (
                    <span className="active-filter" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
                <button className="active-filters-reset" onClick={reset}>
                  모두 지우기
                </button>
              </div>
            )}
          </div>
        </section>
        <section
          ref={resultsRef}
          className="results"
          aria-label="추천 행사"
          aria-busy={busy}
        >
          <div className="result-heading">
            <div>
              <span className="section-kicker">
                {discoveryMode ? "갈틈 추천" : "찾은 행사"}
              </span>
              <h2>
                {discoveryMode ? "이번 주말, 여기 어때요?" : selectedRangeLabel}{" "}
                {data && <span className="result-count">{data.total}곳</span>}
              </h2>
              {data && (
                <p>
                  {dateLabel(data.range.start)}
                  {data.range.start !== data.range.end &&
                    ` – ${dateLabel(data.range.end)}`}{" "}
                  · {region ? regionLabel(region) : "전국"}
                  {location && " · 내 주변 · 가까운순 · 직선거리 기준"}
                  {mode === "sample" && " · 가상 행사 미리보기"}
                  {data.nearby_candidate_limited &&
                    " · 주변 후보가 많아 가까운 일부만 보여드려요"}
                </p>
              )}
            </div>
            <div className="result-tools">
              {active && (
                <button className="reset" onClick={reset}>
                  <SlidersHorizontal size={14} />
                  필터 초기화
                </button>
              )}
              {location ? (
                <span className="sort" aria-label="정렬: 가까운순">
                  <Navigation size={15} /> 가까운순
                </span>
              ) : (
                <label className="sort">
                  <ArrowDownUp size={15} />
                  <select
                    aria-label="정렬"
                    value={sort}
                    onChange={(e) => change(setSort, e.target.value, "sort")}
                  >
                    <option value="recommended">추천순</option>
                    <option value="date">날짜순</option>
                  </select>
                </label>
              )}
            </div>
          </div>
          <div role="status" className="sr-only">
            {busy
              ? "행사를 불러오는 중"
              : error || `${data?.total ?? 0}개의 행사`}
          </div>
          {error ? (
            <div className="empty">
              <Info />
              <h3>잠시 연결이 어려워요</h3>
              <p>잠시 후 다시 시도해 주세요.</p>
              <button className="primary" onClick={() => setRetry(retry + 1)}>
                다시 시도
              </button>
            </div>
          ) : busy ? (
            <div className="event-grid">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="skeleton">
                  <div />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : data?.total === 0 ? (
            <div className="empty">
              <Search />
              <h3>
                {data.range_outside_available
                  ? "현재 등록된 행사 일정 범위를 벗어난 날짜입니다."
                  : customRange
                    ? "선택한 날짜에 등록된 행사가 없습니다."
                    : "조건에 맞는 행사가 아직 없어요"}
              </h3>
              <p>
                {data.range_outside_available
                  ? "현재 등록된 행사 일정 안에서 날짜를 선택해 주세요."
                  : customRange
                    ? "다른 날짜나 지역·조건으로 다시 찾아보세요."
                    : "지역이나 조건을 조금 넓혀보세요. 확인되지 않은 행사는 보여드리지 않아요."}
              </p>
              <div className="empty-actions">
                {(customRange || data.range_outside_available) && (
                  <button className="secondary" onClick={openPicker}>
                    날짜 바꾸기
                  </button>
                )}
                <button className="primary" onClick={reset}>
                  필터 초기화
                </button>
              </div>
            </div>
          ) : discoveryMode && events.length > 4 ? (
            <div className="discovery-results">
              <section className="featured-events" aria-label="먼저 둘러볼 행사">
                <div className="subsection-heading">
                  <div>
                    <span>갈틈 추천</span>
                    <h3>이번 주말 먼저 볼 곳</h3>
                  </div>
                  <p>사진부터 가볍게 둘러보세요.</p>
                </div>
                <div className="event-grid featured-grid">
              {featuredEvents.map((event) => (
                renderEventCard(event)
              ))}
                </div>
              </section>
              <section className="all-events-section" aria-label="더 둘러볼 행사">
                <div className="subsection-heading">
                  <div>
                    <span>더 보기</span>
                    <h3>더 둘러보기</h3>
                  </div>
                  <p>{selectedRangeLabel}</p>
                </div>
                <div className="event-grid">
              {listEvents.map((event) => (
                renderEventCard(event)
              ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="event-grid">
              {events.map((event) => (
                renderEventCard(event)
              ))}
            </div>
          )}
          {data && data.total > 0 && (
            <div className="list-exploration" aria-live="polite">
              <p className="list-progress">
                {batchStart > 1
                  ? `${batchStart * PAGE_SIZE - PAGE_SIZE + 1}~${Math.min(batchStart * PAGE_SIZE - PAGE_SIZE + events.length, data.total)} / ${data.total}개`
                  : `${Math.min(events.length, data.total)} / ${data.total}개`}
              </p>
              {extraError && (
                <div className="list-load-error" role="alert">
                  <span>{extraError}</span>
                  {failedPage !== null && (
                    <button
                      className="secondary"
                      onClick={retryExtra}
                      disabled={extraLoading}
                    >
                      다시 시도
                    </button>
                  )}
                </div>
              )}
              {loadedPages < PAGES_PER_BATCH &&
                events.length < MAX_VISIBLE_ITEMS &&
                batchStart + loadedPages <= totalPages(data.total) && (
                  <button
                    className="load-more"
                    onClick={loadMore}
                    disabled={extraLoading}
                  >
                    {extraLoading ? "불러오는 중…" : `${PAGE_SIZE}개 더 보기`}
                  </button>
                )}
              {(loadedPages >= PAGES_PER_BATCH ||
                batchStart + loadedPages > totalPages(data.total)) && (
                <section className="exploration-cta" aria-label="탐색 전환">
                  <h3>아직 못 정하셨나요?</h3>
                  <p>다른 조건의 행사도 둘러볼 수 있어요.</p>
                  <div className="exploration-actions">
                    <button onClick={() => focusFilter("region")}>
                      지역을 바꿔볼까요?
                    </button>
                    <button onClick={() => focusFilter("theme")}>
                      다른 카테고리를 볼까요?
                    </button>
                    {hasNextBatch(batchStart, data.total) && (
                      <button onClick={loadNextBatch} disabled={extraLoading}>
                        다음 행사 보기 <ChevronRight size={16} />
                      </button>
                    )}
                    {batchStart > 1 && (
                      <button
                        onClick={loadPreviousBatch}
                        disabled={extraLoading}
                      >
                        <ChevronLeft size={16} /> 이전 행사 보기
                      </button>
                    )}
                  </div>
                </section>
              )}
              {batchStart > 1 && loadedPages < PAGES_PER_BATCH && (
                <div className="batch-navigation">
                  <button onClick={loadPreviousBatch} disabled={extraLoading}>
                    <ChevronLeft size={16} /> 이전 행사 보기
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
        <aside className="principle">
          <div className="principle-icon">
            <ShieldCheck size={25} />
          </div>
          <div>
            <h3>좋은 나들이는 정확한 정보에서 시작하니까.</h3>
            <p>
              공식 공지와 공공 데이터를 우선합니다. 알 수 없는 정보는 미확인으로
              표시해요.
            </p>
          </div>
          <button onClick={() => setAbout(true)}>
            확인 원칙 보기 <ArrowRight size={16} />
          </button>
        </aside>
      </main>
      <footer>
        <a className="footer-brand" href="/">
          갈틈
        </a>
        <span>오늘의 작은 발견 하나.</span>
        <small>
          운영 준비 중 ·{" "}
          {mode === "sample" ? "샘플 데이터 모드" : "공식 출처 기반"}
        </small>
      </footer>
      <dialog
        aria-label={about ? "정보 확인 원칙" : "행사 상세 정보"}
        ref={dialog}
        onCancel={close}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="detail-dialog"
      >
        <button className="dialog-close" onClick={close} aria-label="닫기">
          <X size={22} />
        </button>
        {about ? (
          <div className="about-content">
            <ShieldCheck size={35} />
            <h2>추측 대신, 확인된 정보</h2>
            <p>행사 일정·장소·가격·취소 여부를 AI로 만들어내지 않습니다.</p>
            <ol>
              <li>행사·주최기관 공식 공지</li>
              <li>지자체 공식 홈페이지</li>
              <li>한국관광공사 TourAPI</li>
              <li>공공데이터포털 공식 데이터</li>
            </ol>
            <p>
              최근 72시간 이내 확인한 근거가 있는 행사를 추천합니다. 확인 상태는
              실시간 개최를 보장하지 않으므로 출발 전 공식 공지를 확인해 주세요.
              출처에 취소·연기로 표시된 행사는 제외합니다. TourAPI의 개최 상태가
              미제공이면 취소 여부 미확인으로 안내합니다.
            </p>
            <p>
              반려동물 가능 여부나 비용을 확인하지 못하면 미확인으로 표시합니다.
              무료는 입장 기준이며 체험·먹거리 비용은 별도일 수 있어요.
            </p>
            <section className="analytics-notice" aria-label="분석 도구 안내">
              <h3>분석 도구 안내</h3>
              <p>
                {analyticsConfig?.enabled
                  ? `서비스 개선을 위해 ${[analyticsConfig.ga4.enabled ? "Google Analytics" : null, analyticsConfig.cloudflare.enabled ? "Cloudflare Web Analytics" : null].filter(Boolean).join("와 ")}를 사용합니다. `
                  : "서비스 개선을 위한 분석 도구는 현재 활성화되어 있지 않습니다."}
                정확한 GPS 좌표, 검색어 원문, 알림 구독 endpoint는 분석 도구로
                보내지 않습니다.
              </p>
            </section>
            {mode === "sample" && (
              <div className="detail-warning">
                지금 보이는 모든 행사는 UI 검증용 가상 샘플입니다. 실제 행사
                출처나 방문 정보가 아닙니다.
              </div>
            )}
          </div>
        ) : detail ? (
          <div>
            <Scene
              event={detail.event}
              detail
              onExpand={(image, title) => setLightbox({ image, title })}
            />
            <div className="detail-body">
              <span className="eyebrow">
                {detail.event.region} ·{" "}
                {detail.event.verification === "sample"
                  ? "가상 샘플"
                  : "출처 확인"}
              </span>
              <h2>{detail.event.title}</h2>
              {detail.event.is_sample === 1 && (
                <div className="detail-warning">
                  실제 행사가 아닙니다. 일정·장소·가격·좌표 모두 기능 검증용
                  샘플입니다.
                </div>
              )}
              <StatusNotice event={detail.event} />
              <TrustInfo event={detail.event} />
              {detail.enrichment?.summary && (
                <section className="detail-description detail-enrichment-summary">
                  <h3>행사 소개</h3>
                  <p>{detail.enrichment.summary}</p>
                </section>
              )}
              {detail.enrichment?.highlights.length ? (
                <section className="detail-enrichment detail-highlights">
                  <h3>주요 볼거리</h3>
                  <div className="detail-tags">
                    {detail.enrichment.highlights.map((highlight) => (
                      <span className="chip" key={highlight.label}>
                        {highlight.label}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}
              {detail.enrichment?.programs.some(
                (program) => program.featured,
              ) ? (
                <section className="detail-enrichment detail-featured">
                  <h3>주요 일정</h3>
                  <div className="detail-programs">
                    {detail.enrichment.programs
                      .filter((program) => program.featured)
                      .map((program) => (
                        <article className="detail-program" key={program.name}>
                          <strong>{program.name}</strong>
                          {detailProgramSchedule(program) && (
                            <span>{detailProgramSchedule(program)}</span>
                          )}
                          {detailProgramVenue(program) && (
                            <small>{detailProgramVenue(program)}</small>
                          )}
                        </article>
                      ))}
                  </div>
                </section>
              ) : null}
              {(() => {
                const location = locationLines(detail.event);
                const price = detail.event.price_text?.trim();
                return (
                  <dl>
                    <dt>일정</dt>
                    <dd>
                      {detailDateRange(
                        detail.event.start_date,
                        detail.event.end_date,
                      )}
                    </dd>
                    {formatOperatingHours(
                      selectOperatingHours(
                        detail.operating_hours,
                        eventDisplayRange,
                      ),
                    ) && (
                      <>
                        <dt>운영시간</dt>
                        <dd>
                          {formatOperatingHours(
                            selectOperatingHours(
                              detail.operating_hours,
                              eventDisplayRange,
                            ),
                          )}
                        </dd>
                      </>
                    )}
                    {location.primary && (
                      <>
                        <dt>장소</dt>
                        <dd>
                          {location.primary}
                          {location.secondary && (
                            <small>{location.secondary}</small>
                          )}
                        </dd>
                      </>
                    )}
                    {price && (
                      <>
                        <dt>비용</dt>
                        <dd>{price}</dd>
                      </>
                    )}
                    {detail.event.pet_policy !== "unknown" && (
                      <>
                        <dt>반려동물</dt>
                        <dd>
                          {detail.event.pet_policy === "allowed"
                            ? "동반 가능"
                            : "동반 불가"}
                        </dd>
                      </>
                    )}
                    {detail.contact_phone && (
                      <>
                        <dt>문의</dt>
                        <dd className="contact-phone">
                          <span>{detail.contact_phone.display}</span>
                          <a
                            href={detail.contact_phone.href}
                            aria-label={`${detail.contact_phone.display}로 전화하기`}
                          >
                            <Phone size={16} /> 전화하기
                          </a>
                        </dd>
                      </>
                    )}
                  </dl>
                );
              })()}
              {!detail.enrichment?.summary &&
                usefulDescription(detail.event.description) && (
                  <section className="detail-description">
                    <h3>행사 소개</h3>
                    <p>{usefulDescription(detail.event.description)}</p>
                  </section>
                )}
              {detail.enrichment?.programs.some(
                (program) => !program.featured,
              ) ? (
                <section className="detail-enrichment detail-program-list">
                  <h3>프로그램</h3>
                  <div className="detail-programs">
                    {detail.enrichment.programs
                      .filter((program) => !program.featured)
                      .map((program) => (
                        <article className="detail-program" key={program.name}>
                          <strong>{program.name}</strong>
                          {detailProgramSchedule(program) && (
                            <span>{detailProgramSchedule(program)}</span>
                          )}
                          {detailProgramVenue(program) && (
                            <small>{detailProgramVenue(program)}</small>
                          )}
                          {program.description && <p>{program.description}</p>}
                        </article>
                      ))}
                  </div>
                </section>
              ) : null}
              <div className="detail-tags detail-event-tags">
                {detail.event.tags.map((t) => (
                  <span className="chip" key={t}>
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
              {(officialDetailSource(detail) ??
                (hasOfficialSource(detail.event) &&
                  safeUrl(detail.event.trust_source_url))) && (
                <a
                  className="primary source-button detail-official-link"
                  href={
                    officialDetailSource(detail) ??
                    safeUrl(detail.event.trust_source_url)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    trackOfficialLinkClick(
                      detail.event.id,
                      detail.event.source_kind,
                    )
                  }
                >
                  공식 안내 보기 <ExternalLink size={16} />
                </a>
              )}
              <p className="detail-source">
                출처 · {detail.event.source_name ?? "한국관광공사 TourAPI"}
                {formatTrustDate(detail.event.checked_at) && (
                  <> · 마지막 확인 {formatTrustDate(detail.event.checked_at)}</>
                )}
              </p>
              <button className="detail-back" onClick={close}>
                목록으로 돌아가기
              </button>
            </div>
          </div>
        ) : (
          <div className="about-content">
            <Sparkles size={28} />
            <h2>
              {detailError?.startsWith("행사를 찾을")
                ? "행사를 찾을 수 없어요"
                : detailError
                  ? "잠시 정보를 불러오지 못했어요"
                  : "상세 정보를 확인하고 있어요"}
            </h2>
            <p role="status">{detailError || "잠시만 기다려 주세요."}</p>
            {detailError && !detailError.startsWith("행사를 찾을") && (
              <button
                className="primary"
                onClick={() => setDetailRetry((n) => n + 1)}
              >
                다시 시도
              </button>
            )}
          </div>
        )}
      </dialog>
      {lightbox && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.title} 대표 이미지 크게 보기`}
          onClick={() => setLightbox(null)}
        >
          <div
            className="image-lightbox-content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              ref={lightboxClose}
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="이미지 크게 보기 닫기"
            >
              <X size={22} />
            </button>
            <img src={lightbox.image} alt={`${lightbox.title} 대표 이미지`} />
          </div>
        </div>
      )}
    </>
  );
}
