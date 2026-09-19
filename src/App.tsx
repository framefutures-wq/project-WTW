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
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  REGIONS,
  koreaDate,
  AUDIENCES,
  THEMES,
  type Period,
  type DateRange,
  type EventItem,
  type EventResponse,
  type Tag,
  validDate,
} from "../shared/domain";
import {
  formatTrustDate,
  hasOfficialSource,
  officialSourceLabel,
  trustChangeLabel,
  trustDescription,
  trustTitle,
} from "./trust";

type Evidence = {
  field: string;
  excerpt: string;
  checked_at: string;
  name: string;
  url: string | null;
  kind: string;
};
type Detail = { event: EventItem; evidence: Evidence[] };
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
    throw new Error(message);
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
const tagLabel = (tag: Tag) => ({ ...AUDIENCES, ...THEMES })[tag];
const safeUrl = (url: string | null) => {
  try {
    return url && new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};
function TrustInfo({ event, card = false }: { event: EventItem; card?: boolean }) {
  if (event.is_sample === 1 || !event.trust_status) return null;
  const changed = event.trust_status === "changed";
  const sourceLabel = officialSourceLabel(event.trust_source_types);
  const sourceLink = hasOfficialSource(event) ? safeUrl(event.trust_source_url) : undefined;
  const checked = formatTrustDate(event.trust_checked_at);
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
  return (
    <section className={`trust-info trust-${event.trust_status}`} aria-label="행사 신뢰정보">
      <div className="trust-info-heading">
        <span className="trust-info-icon">
          {changed ? <Info size={18} /> : <ShieldCheck size={18} />}
        </span>
        <div>
          <h3>{changed ? trustChangeLabel(event.trust_changed_fields) : trustTitle(event.trust_status)}</h3>
          <p>{trustDescription(event.trust_status)}</p>
        </div>
      </div>
      <dl className="trust-info-meta">
        {checked && (
          <>
            <dt>공식정보 마지막 확인</dt>
            <dd>{checked}</dd>
          </>
        )}
        {sourceLabel && (
          <>
            <dt>출처 유형</dt>
            <dd>{sourceLabel}</dd>
          </>
        )}
      </dl>
      {sourceLink && (
        <a className="trust-source-link" href={sourceLink} target="_blank" rel="noopener noreferrer">
          공식 안내 보기 <ExternalLink size={14} />
        </a>
      )}
    </section>
  );
}
function Scene({ event }: { event: EventItem }) {
  const theme = event.tags.find((t) => t in THEMES) ?? "experience";
  const icons = {
    flowers: "✿",
    food: "◒",
    fireworks: "✺",
    experience: "△",
    performance: "♫",
  };
  return (
    <div className={`scene scene-${theme}`} aria-hidden="true">
      <div className="scene-sun" />
      <div className="hill hill-one" />
      <div className="hill hill-two" />
      <span className="scene-symbol">{icons[theme as keyof typeof icons]}</span>
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
  );
}
export default function App() {
  const [period, setPeriod] = useState<Period>("weekend");
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"day" | "range">("day");
  const [pickerStart, setPickerStart] = useState("");
  const [pickerEnd, setPickerEnd] = useState("");
  const [pickerError, setPickerError] = useState("");
  const [availableDateRange, setAvailableDateRange] = useState<DateRange | null>(null);
  const [region, setRegion] = useState(""),
    [audience, setAudience] = useState(""),
    [theme, setTheme] = useState(""),
    [cost, setCost] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [sort, setSort] = useState("date"),
    [location, setLocation] = useState<{ lat: number; lng: number } | null>(
      null,
    );
  const [geoBusy, setGeoBusy] = useState(false),
    [geoError, setGeoError] = useState("");
  const [page, setPage] = useState(1),
    [data, setData] = useState<EventResponse | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState("");
  const [mode, setMode] = useState(""),
    [about, setAbout] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    fetch("/api/meta")
      .then(readApi<{ available_date_range: DateRange | null }>)
      .then((body) => setAvailableDateRange(body.available_date_range))
      .catch(() => setAvailableDateRange(null));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    const params = new URLSearchParams({
      period: customRange ? "custom" : period,
      sort,
      page: String(page),
      limit: "9",
    });
    if (customRange) {
      if (customRange.start === customRange.end) params.set("date", customRange.start);
      else {
        params.set("startDate", customRange.start);
        params.set("endDate", customRange.end);
      }
    }
    for (const [key, value] of Object.entries({
      region,
      audience,
      theme,
      cost,
      q: query,
    }))
      if (value) params.set(key, value);
    if (location) {
      params.set("lat", String(location.lat));
      params.set("lng", String(location.lng));
    }
    fetch("/api/events?" + params, { signal: controller.signal })
      .then(readApi<EventResponse>)
      .then((body) => {
        setData(body);
        setMode(body.mode);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
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
    cost,
    query,
    sort,
    location,
    page,
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
        if (e.name !== "AbortError") setDetailError(e.message);
      });
    return () => controller.abort();
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
  function reset() {
    setRegion("");
    setAudience("");
    setTheme("");
    setCost("");
    setSearch("");
    setQuery("");
    setPage(1);
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
    setPage(1);
    setPickerOpen(false);
  }
  function choosePreset(value: Period) {
    setCustomRange(null);
    setPickerOpen(false);
    setPickerError("");
    setPeriod(value);
    setPage(1);
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
        setLocation({ lat: p.coords.latitude, lng: p.coords.longitude });
        setSort("distance");
        setPage(1);
        setGeoBusy(false);
      },
      () => {
        setGeoError(
          "위치를 확인하지 못했어요. 브라우저 위치 권한을 확인해 주세요.",
        );
        setGeoBusy(false);
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }
  const change = (fn: (v: string) => void, value: string) => {
    fn(value);
    setPage(1);
  };
  const active = Boolean(region || audience || theme || cost || query);
  const selectedRangeLabel = customRange
    ? customRange.start === customRange.end
      ? `${dateLabel(customRange.start)} 행사`
      : `${dateLabel(customRange.start)} ~ ${dateLabel(customRange.end)} 행사`
    : `${PERIODS.find((p) => p.value === period)?.label}의 발견`;
  const close = () => {
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
                <button className="date-picker-close" onClick={() => setPickerOpen(false)}>
                  <X size={16} />
                  닫기
                </button>
              </div>
              <div className="date-mode" role="group" aria-label="날짜 선택 방식">
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
              {pickerError && <p className="date-picker-error" role="alert">{pickerError}</p>}
            </div>
          )}
          <div className="filter-body">
            <div className="search-row">
              <label className="region-select">
                <MapPin size={18} />
                <select
                  aria-label="지역"
                  value={region}
                  onChange={(e) => change(setRegion, e.target.value)}
                >
                  <option value="">전국 어디든</option>
                  {REGIONS.map((r) => (
                    <option key={r}>{r}</option>
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
                onClick={locate}
                disabled={geoBusy}
              >
                <Navigation size={16} />
                {geoBusy
                  ? "확인 중…"
                  : location
                    ? "위치 새로 확인"
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
              <div className="chips">
                <button
                  className={!theme ? "chip chosen" : "chip"}
                  onClick={() => change(setTheme, "")}
                  aria-pressed={!theme}
                >
                  모두
                </button>
                {Object.entries(THEMES).map(([v, label]) => (
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
              <div className="cost-filter">
                <span className="filter-label">비용</span>
                <select
                  value={cost}
                  onChange={(e) => change(setCost, e.target.value)}
                  aria-label="비용"
                >
                  <option value="">전체</option>
                  <option value="free">무료</option>
                  <option value="paid">유료</option>
                  <option value="unknown">미확인</option>
                </select>
              </div>
            </div>
            {geoError && (
              <p className="inline-error" role="alert">
                {geoError}
              </p>
            )}
            {location && (
              <p className="distance-note">
                현재 위치는 저장하지 않으며 거리 계산 요청에만 사용합니다.
                거리는 직선거리입니다.{" "}
                <button
                  onClick={() => {
                    setLocation(null);
                    setSort("date");
                    setPage(1);
                  }}
                >
                  위치 사용 해제
                </button>
              </p>
            )}
          </div>
        </section>
        <section className="results" aria-label="추천 행사" aria-busy={busy}>
          <div className="result-heading">
            <div>
              <span className="section-kicker">YOUR NEXT LITTLE ADVENTURE</span>
              <h2>
                {selectedRangeLabel}{" "}
                {data && <span>{data.total}</span>}
              </h2>
              {data && (
                <p>
                  {dateLabel(data.range.start)}
                  {data.range.start !== data.range.end &&
                    ` – ${dateLabel(data.range.end)}`}{" "}
                  · {region || "전국"}
                  {mode === "sample"
                    ? " · 가상 행사 미리보기"
                    : " · 출처에 등록된 행사 · 출발 전 개최 여부 확인"}
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
              <label className="sort">
                <ArrowDownUp size={15} />
                <select
                  aria-label="정렬"
                  value={sort}
                  onChange={(e) => {
                    if (e.target.value === "distance" && !location) {
                      locate();
                      return;
                    }
                    change(setSort, e.target.value);
                  }}
                >
                  <option value="date">날짜순</option>
                  <option value="distance">거리순</option>
                </select>
              </label>
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
              <p>{error}</p>
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
              <button className="primary" onClick={reset}>
                필터 초기화
              </button>
            </div>
          ) : (
            <div className="event-grid">
              {data?.events.map((event) => (
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
                              : "비용 미확인"}
                        </span>
                      </div>
                      <h3>{event.title}</h3>
                      <p className="venue">{event.venue}</p>
                      <p className="event-date">
                        <CalendarDays size={14} />
                        {dateLabel(event.start_date)} –{" "}
                        {dateLabel(event.end_date)}
                        {location && (
                          <span className="distance">
                            {event.distance_km === null
                              ? "거리 미확인"
                              : `${event.distance_km.toFixed(1)} km`}
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
          {data && data.total > data.limit && (
            <nav className="pagination" aria-label="결과 페이지">
              <button
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                aria-label="이전 페이지"
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {page} / {Math.ceil(data.total / data.limit)}
              </span>
              <button
                disabled={page >= Math.ceil(data.total / data.limit)}
                onClick={() => setPage(page + 1)}
                aria-label="다음 페이지"
              >
                <ChevronRight size={18} />
              </button>
            </nav>
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
            <Scene event={detail.event} />
            <div className="detail-body">
              <span className="eyebrow">
                {detail.event.region} ·{" "}
                {detail.event.verification === "sample"
                  ? "가상 샘플"
                  : "출처 확인"}
              </span>
              <h2>{detail.event.title}</h2>
              <p>{detail.event.description}</p>
              {detail.event.is_sample === 1 && (
                <div className="detail-warning">
                  실제 행사가 아닙니다. 일정·장소·가격·좌표 모두 기능 검증용
                  샘플입니다.
                </div>
              )}
              <TrustInfo event={detail.event} />
              <dl>
                <dt>일정</dt>
                <dd>
                  {detail.event.start_date} ~ {detail.event.end_date}
                </dd>
                <dt>장소</dt>
                <dd>
                  {detail.event.venue}
                  <small>{detail.event.address}</small>
                </dd>
                <dt>비용</dt>
                <dd>
                  {detail.event.price_text ?? "미확인 · 공식 공지 확인 필요"}
                </dd>
                <dt>반려동물</dt>
                <dd>
                  {
                    {
                      allowed: "동반 가능",
                      prohibited: "동반 불가",
                      unknown: "미확인",
                    }[detail.event.pet_policy]
                  }
                </dd>
                <dt>확인 상태</dt>
                <dd>
                  {
                    {
                      scheduled: "마지막 확인: 개최 예정",
                      cancelled: "취소",
                      postponed: "연기",
                      unknown:
                        "개최·취소 여부 미확인 · 출발 전 공식 공지 확인 필요",
                    }[detail.event.status]
                  }
                </dd>
                <dt>확인 시각</dt>
                <dd>
                  {detail.event.checked_at
                    ? new Date(detail.event.checked_at).toLocaleString(
                        "ko-KR",
                        { timeZone: "Asia/Seoul" },
                      )
                    : "미확인"}{" "}
                  (한국 시간)
                  {detail.event.is_sample === 1 && (
                    <small>
                      샘플 생성 시각이며 공식 정보 확인 시각이 아닙니다.
                    </small>
                  )}
                </dd>
                <dt>출처</dt>
                <dd>{detail.event.source_name ?? "미확인"}</dd>
              </dl>
              <div className="detail-tags">
                {detail.event.tags.map((t) => (
                  <span className="chip" key={t}>
                    {tagLabel(t)}
                  </span>
                ))}
              </div>
              {safeUrl(detail.event.source_url) && (
                <a
                  className="primary source-button"
                  href={safeUrl(detail.event.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  TourAPI 원문 보기 <ExternalLink size={16} />
                </a>
              )}
              {detail.evidence.length > 0 && (
                <div className="evidence">
                  <h3>정보 확인 근거</h3>
                  {detail.evidence.map((e, i) => (
                    <p key={i}>
                      <strong>{e.field}</strong> · {e.excerpt}
                      <small>
                        {e.name} ·{" "}
                        {new Date(e.checked_at).toLocaleString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </small>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="about-content">
            <Sparkles size={28} />
            <h2>
              {detailError
                ? "불러오지 못했어요"
                : "상세 정보를 확인하고 있어요"}
            </h2>
            <p role="status">{detailError || "잠시만 기다려 주세요."}</p>
          </div>
        )}
      </dialog>
    </>
  );
}
