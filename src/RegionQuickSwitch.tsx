import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MapPin, Search, X } from "lucide-react";
import { REGION_OPTIONS, regionLabel } from "../shared/region-options";

export default function RegionQuickSwitch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const current = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("region") ?? "";
  }, []);
  const options = REGION_OPTIONS.filter(({ label }) =>
    label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (region: string) => {
    const url = new URL(window.location.href);
    url.pathname = "/";
    url.searchParams.delete("event");
    if (region) url.searchParams.set("region", region);
    else url.searchParams.delete("region");
    window.location.assign(`${url.pathname}${url.search}`);
  };

  return (
    <>
      <button className="region-quick-trigger" onClick={() => setOpen(true)}>
        <MapPin size={16} />
        <span>{current ? regionLabel(current) : "전국"}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="region-drawer-layer" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="region-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="지역 선택"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="region-drawer-head">
              <strong>어디로 갈까요?</strong>
              <button ref={closeRef} onClick={() => setOpen(false)} aria-label="지역 선택 닫기">
                <X size={20} />
              </button>
            </div>
            <label className="region-drawer-search">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="지역 검색" autoFocus />
            </label>
            <div className="region-drawer-list">
              <button className={!current ? "selected" : ""} onClick={() => choose("")}>
                <strong>전국</strong><small>대한민국</small>
              </button>
              {options.map(({ queryValue, label }) => (
                <button key={queryValue} className={current === queryValue ? "selected" : ""} onClick={() => choose(queryValue)}>
                  <strong>{label}</strong><small>대한민국</small>
                </button>
              ))}
              {!options.length && <p>검색한 지역이 없어요.</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
