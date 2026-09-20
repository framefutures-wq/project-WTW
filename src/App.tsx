import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Flower2,
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
  type DateRange,
  type EventItem,
  type EventResponse,
  type Tag,
  validDate,
} from "../shared/domain";
import { USER_CONTENT_FILTERS } from "../shared/content-filters";
import { COST_STATUS_LABELS } from "../shared/cost-status";
import { REGION_OPTIONS, regionLabel } from "../shared/region-options";
import { formatEventDateLabel } from "../shared/event-date-display";
import { cardImageFit, type ImageFit } from "../shared/image-fit";
import {
  MAX_VISIBLE_ITEMS,
  PAGE_SIZE,
  PAGES_PER_BATCH,
  hasNextBatch,
  totalPages,
  uniqueEvents,
} from "../shared/list-exploration";
import { formatTrustDate, hasOfficialSource, trustChangeLabel } from "./trust";

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
};
type PageResponse = Omit<EventResponse, "total"> & { total?: number };
type NearbyLocation = { lat: number; lng: number };
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
const PERIODS: { value: Period; label: string; small: string }[] = [
  { value: "today", label: "오늘", small: "지금 떠나볼까?" },
  { value: "weekend", label: "이번 주말", small: "기다려온 쉬는 날" },
  { value: "next-weekend", label: "다음 주말", small: "미리 계획해요" },
];
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
function TrustInfo({
  event,
  card = false,
}: {
  event: EventItem;
  card?: boolean;
}) {
  if (event.is_sample === 1 || !event.trust_status) return null;
  const changed = event.trust_status === "changed";
  if (card)
    return changed ? (
      <span className="trust-card trust-changed">
        <Info size={13} /> {trustChangeLabel(event.trust_changed_fields)}
      </span>
    ) : event.trust_status === "confirmed" ? (
      <span className="trust-card trust-confirmed">
        <ShieldCheck size={13} /> 공식정보 확인
      </span>
    ) : null;
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
  const [sort, setSort] = useState("date"),
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
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(""),
    [lightbox, setLightbox] = useState<{ image: string; title: string } | null>(
      null,
    );
  const [detailRetry, setDetailRetry] = useState(0);
  const [mode, setMode] = useState(""),
    [about, setAbout] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null),
    resultsRef = useRef<HTMLElement | null>(null),
    regionFilterRef = useRef<HTMLSelectElement | null>(null),
    contentFilterRef = useRef<HTMLDivElement | null>(null),
    batchProgress = useRef(
      new Map<number, { loadedPages: number; scrollY: number }>(),
    ),
    detailHistory = useRef(false),
    lightboxClose = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    fetch("/api/meta")
      .then(readApi<{ available_date_range: DateRange | null }>)
      .then((body) => setAvailableDateRange(body.available_date_range))
      .catch(() => setAvailableDateRange(null));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    for (const key of [
      "period",
      "date",
      "startDate",
      "endDate",
      "region",
      "audience",
      "theme",
      "q",
      "sort",
      "page",
      "limit",
    ])
      params.delete(key);
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
      q: query,
    }))
      if (value) params.set(key, value);
    if (sort !== "date" && !location) params.set("sort", sort);
    const next = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      next ? `${window.location.pathname}?${next}` : window.location.pathname,
    );
  }, [period, customRange, region, audience, theme, query, sort]);
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
      .then(setDetail)
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
  }, [selected, detailRetry]);
  useEffect(() => {
    if (!selected || detailHistory.current) return;
    window.history.pushState(
      { ...(window.history.state ?? {}), eventDetail: selected },
      "",
      window.location.href,
    );
    detailHistory.current = true;
    const onPopState = () => {
      if (detailHistory.current) {
        detailHistory.current = false;
        setSelected(null);
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
    setPickerOpen(false);
  }
  function choosePreset(value: Period) {
    setCustomRange(null);
    setPickerOpen(false);
    setPickerError("");
    setPeriod(value);
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
        setGeoBusy(false);
      },
      (error) => {
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
  const change = (fn: (v: string) => void, value: string) => {
    fn(value);
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
    const element =
      target === "region" ? regionFilterRef.current : contentFilterRef.current;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target === "region") element?.focus();
    else
      (element?.querySelector("button") as HTMLButtonElement | null)?.focus();
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
  const activeFilterLabels = [
    customRange ? selectedRangeLabel : null,
    region ? regionLabel(region) : null,
    audience ? AUDIENCES[audience as keyof typeof AUDIENCES] : null,
    theme ? THEMES[theme as keyof typeof THEMES] : null,
    query ? `검색: ${query}` : null,
    location ? "내 주변" : null,
  ].filter(Boolean) as string[];
  const close = () => {
    if (selected && detailHistory.current) {
      window.history.back();
      return;
    }
    setSelected(null);
    setAbout(false);
  };
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <a href="/" className="brand" aria-label="주말뭐해? 홈">
            <span className="brand-icon">
              <Flower2 size={24} />
            </span>
            주말뭐해<span className="brand-question">?</span>
          </a>
          <span className="header-tagline">
            가까운 곳에서 발견하는 좋은 하루
          </span>
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
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span /> 멀리 가지 않아도, 좋은 주말
            </span>
            <h1>
              이번 주말,
              <br />
              <span>뭐 하면 좋을까?</span>
            </h1>
            <p>
              함께하는 사람에 맞춰, 가까운 축제부터 작은 동네 행사까지.
              <br className="desktop-break" />
              마음에 드는 하루를 찾아보세요.
            </p>
            <div className="hero-note">
              <Compass size={17} />
              계획은 가볍게, 하루는 특별하게
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit" />
            <div className="art-sun" />
            <div className="art-mountain back" />
            <div className="art-mountain front" />
            <div className="art-road" />
            <div className="art-flower flower-left">✿</div>
            <div className="art-flower flower-right">✿</div>
            <div className="art-label">
              <MapPin size={17} /> 우리 동네의 새로운 발견
            </div>
            <span className="art-spark">✧</span>
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
                    change(setRegion, e.target.value);
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
              <label className="search">
                <Search size={19} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="행사 이름이나 장소를 검색해 보세요"
                  aria-label="행사 이름 또는 장소 검색"
                  maxLength={80}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    aria-label="검색어 지우기"
                  >
                    <X size={16} />
                  </button>
                )}
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
            <div className="filter-row">
              <span className="filter-label">누구와</span>
              <div className="chips">
                <button
                  className={!audience ? "chip chosen" : "chip"}
                  onClick={() => change(setAudience, "")}
                  aria-pressed={!audience}
                >
                  누구든
                </button>
                {Object.entries(AUDIENCES).map(([v, label]) => (
                  <button
                    key={v}
                    className={audience === v ? "chip chosen" : "chip"}
                    onClick={() => change(setAudience, audience === v ? "" : v)}
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
                  onClick={() => change(setTheme, "")}
                  aria-pressed={!theme}
                >
                  모두
                </button>
                {USER_CONTENT_FILTERS.map(({ queryValue: v, label }) => (
                  <button
                    key={v}
                    className={theme === v ? "chip chosen" : "chip"}
                    onClick={() => change(setTheme, theme === v ? "" : v)}
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
              <span className="section-kicker">YOUR NEXT LITTLE ADVENTURE</span>
              <h2>
                {selectedRangeLabel} {data && <span>{data.total}</span>}
              </h2>
              {data && (
                <p>
                  {dateLabel(data.range.start)}
                  {data.range.start !== data.range.end &&
                    ` – ${dateLabel(data.range.end)}`}{" "}
                  · {region ? regionLabel(region) : "전국"}
                  {location && " · 내 주변 · 가까운순 · 직선거리 기준"}
                  {mode === "sample"
                    ? " · 가상 행사 미리보기"
                    : " · 출처에 등록된 행사 · 출발 전 개최 여부 확인"}
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
                    onChange={(e) => change(setSort, e.target.value)}
                  >
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
              {[1, 2, 3].map((n) => (
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
          ) : (
            <div className="event-grid">
              {events.map((event) => (
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
                        <span
                          className={
                            event.cost === "free" ? "price free" : "price"
                          }
                        >
                          {event.cost === "free"
                            ? "무료"
                            : event.cost === "paid"
                              ? "유료"
                              : COST_STATUS_LABELS.unknown}
                        </span>
                      </div>
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
                      <div className="card-tags">
                        {event.tags.slice(0, 3).map((t) => (
                          <span key={t}>#{tagLabel(t)}</span>
                        ))}
                      </div>
                      <div className="card-bottom">
                        <span>
                          {event.is_sample ? (
                            <>
                              <Info size={13} />
                              실제 행사가 아닌 샘플
                            </>
                          ) : (
                            <>
                              <ShieldCheck size={13} />
                              {event.status === "unknown"
                                ? "취소 여부 미확인 · "
                                : "출처 확인 · "}
                              {event.checked_at
                                ? dateLabel(event.checked_at)
                                : ""}
                            </>
                          )}
                        </span>
                        <TrustInfo event={event} card />
                        <ArrowRight size={17} />
                      </div>
                    </div>
                  </button>
                </article>
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
          주말뭐해?
        </a>
        <span>당신의 주말에, 작은 발견 하나.</span>
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
              {usefulDescription(detail.event.description) && (
                <section className="detail-description">
                  <h3>행사 소개</h3>
                  <p>{usefulDescription(detail.event.description)}</p>
                </section>
              )}
              <div className="detail-tags">
                {detail.event.tags.map((t) => (
                  <span className="chip" key={t}>
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
              {hasOfficialSource(detail.event) &&
                safeUrl(detail.event.trust_source_url) && (
                  <a
                    className="primary source-button"
                    href={safeUrl(detail.event.trust_source_url)}
                    target="_blank"
                    rel="noopener noreferrer"
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
