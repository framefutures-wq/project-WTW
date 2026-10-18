import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Grid2X2, X } from "lucide-react";
import { USER_CONTENT_FILTERS } from "../shared/content-filters";

export default function CategoryQuickSwitch() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const current = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("theme") ?? "";
  }, []);
  const currentLabel =
    USER_CONTENT_FILTERS.find(({ queryValue }) => queryValue === current)?.label ??
    "카테고리";

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

  const choose = (theme: string) => {
    const url = new URL(window.location.href);
    url.pathname = "/";
    url.searchParams.delete("event");
    if (theme) url.searchParams.set("theme", theme);
    else url.searchParams.delete("theme");
    window.location.assign(`${url.pathname}${url.search}`);
  };

  return (
    <>
      <button className="category-quick-trigger" onClick={() => setOpen(true)}>
        <Grid2X2 size={16} />
        <span>{currentLabel}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="category-drawer-layer" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="category-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="카테고리 선택"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="category-drawer-head">
              <div>
                <strong>무엇을 하고 싶나요?</strong>
                <p>관심 있는 즐길거리를 골라보세요.</p>
              </div>
              <button ref={closeRef} onClick={() => setOpen(false)} aria-label="카테고리 선택 닫기">
                <X size={20} />
              </button>
            </div>
            <div className="category-drawer-list">
              <button className={!current ? "selected" : ""} onClick={() => choose("")}>
                <span className="category-mark">전체</span>
                <span><strong>모든 즐길거리</strong><small>지금 갈 수 있는 행사를 한 번에</small></span>
              </button>
              {USER_CONTENT_FILTERS.map(({ queryValue, label }) => (
                <button key={queryValue} className={current === queryValue ? "selected" : ""} onClick={() => choose(queryValue)}>
                  <span className="category-mark">{label.slice(0, 1)}</span>
                  <span><strong>{label}</strong><small>{label} 관련 행사 보기</small></span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
