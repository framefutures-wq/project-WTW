import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailMedia, EventImageLayers, Scene } from "../src/App";
import type { EventItem } from "../shared/domain";

const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const redesign = readFileSync("src/redesign.css", "utf8");

const fallbackEvent = {
  id: "fallback",
  title: "이미지 없는 행사",
  description: "",
  region: "서울",
  venue: "광장",
  address: "서울 광장",
  start_date: "2026-09-26",
  end_date: "2026-09-28",
  lat: null,
  lng: null,
  cost: "unknown",
  price_text: null,
  pet_policy: "unknown",
  status: "scheduled",
  verification: "verified",
  is_sample: 0,
  checked_at: null,
  source_url: null,
  source_name: null,
  source_kind: null,
  trust_status: null,
  trust_checked_at: null,
  trust_source_url: null,
  trust_source_types: [],
  trust_changed_fields: [],
  image_url: null,
  tags: ["performance"],
  distance_km: null,
} satisfies EventItem;

test("detail images use contain and expose an accessible lightbox", () => {
  assert.match(app, /<DetailMedia/);
  assert.match(app, /role="dialog"/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /이미지 크게 보기 닫기/);
  assert.match(
    css,
    /\.scene-detail \.scene-image-foreground[\s\S]*object-fit: contain/,
  );
});

test("contain and detail images add a decorative blurred duplicate behind the sharp image", () => {
  assert.match(app, /scene-image-backdrop/);
  assert.match(app, /className="scene-image scene-image-foreground"/);
  assert.match(app, /alt=""\s+aria-hidden="true"/);
  assert.match(css, /\.scene-image-backdrop[\s\S]*filter: blur\(18px\)/);
  assert.match(css, /\.scene-image-backdrop[\s\S]*pointer-events: none/);
  assert.match(
    css,
    /\.scene-contain \.scene-image-foreground[\s\S]*object-fit: contain/,
  );
  assert.match(
    css,
    /\.scene-detail \.scene-image-foreground[\s\S]*background: transparent/,
  );
});

test("rendered contain/detail layers use the same source and cover cards omit the blur image", () => {
  const image = "https://example.org/poster.jpg";
  const blurred = renderToStaticMarkup(
    createElement(EventImageLayers, {
      image,
      title: "테스트 포스터",
      backdrop: true,
      loading: "lazy",
    }),
  );
  assert.equal((blurred.match(/<img/g) ?? []).length, 2);
  assert.match(blurred, /scene-image-backdrop/);
  assert.match(blurred, /src="https:\/\/example.org\/poster.jpg"/);
  assert.match(blurred, /alt=""/);
  assert.match(blurred, /aria-hidden="true"/);
  assert.match(blurred, /scene-image-foreground/);
  assert.match(blurred, /alt="테스트 포스터 대표 이미지"/);

  const cover = renderToStaticMarkup(
    createElement(EventImageLayers, {
      image,
      title: "일반 사진",
      backdrop: false,
      loading: "lazy",
    }),
  );
  assert.equal((cover.match(/<img/g) ?? []).length, 1);
  assert.doesNotMatch(cover, /scene-image-backdrop/);
  assert.match(
    app,
    /className="scene-image scene-image-backdrop"[\s\S]*onError=\{onImageError\}/,
  );
});

test("detail without an image uses an event-data graphic while cards retain their fallback", () => {
  const detail = renderToStaticMarkup(
    createElement(Scene, { event: fallbackEvent, detail: true }),
  );
  const card = renderToStaticMarkup(
    createElement(Scene, { event: fallbackEvent }),
  );
  assert.match(detail, /detail-info-graphic/);
  assert.match(detail, />서울</);
  assert.match(detail, />공연</);
  assert.match(detail, /9\.26 ~ 9\.28/);
  assert.doesNotMatch(detail, /scene-fallback/);
  assert.match(card, /scene-fallback/);
  assert.match(app, /imageFailed\) && \(/);
  assert.match(redesign, /\.detail-info-graphic\s*\{[\s\S]*background: #f7f4ee/);
  assert.match(redesign, /\.detail-info-graphic-orbit[\s\S]*#f26b38/);
  const graphicStyles = redesign.slice(
    redesign.indexOf(".detail-dialog .scene-detail .detail-info-graphic"),
    redesign.indexOf(".detail-summary-panel"),
  );
  assert.doesNotMatch(graphicStyles, /#155d4b/);
});

test("detail with an official image remains expandable", () => {
  const detail = renderToStaticMarkup(
    createElement(Scene, {
      event: { ...fallbackEvent, image_url: "https://example.org/poster.jpg" },
      detail: true,
      onExpand: () => undefined,
    }),
  );
  assert.match(detail, /<button/);
  assert.match(detail, /scene-image-foreground/);
  assert.match(detail, /대표 이미지 크게 보기/);
  assert.doesNotMatch(detail, /detail-info-graphic/);
});

test("two detail images render a main and secondary image with independent controls", () => {
  const detail = renderToStaticMarkup(
    createElement(DetailMedia, {
      event: fallbackEvent,
      images: [
        { image_url: "https://example.org/main.jpg", source_type: "tourapi", source_page_url: null, is_primary: true, sort_order: 1 },
        { image_url: "https://example.org/secondary.jpg", source_type: "tourapi", source_page_url: null, is_primary: false, sort_order: 2 },
      ],
      onExpand: () => undefined,
    }),
  );
  assert.match(detail, /detail-media-pair/);
  assert.match(detail, /detail-media-main/);
  assert.match(detail, /detail-media-secondary/);
  assert.equal((detail.match(/<button/g) ?? []).length, 2);
  assert.match(redesign, /\.detail-media-pair\s*\{[\s\S]*grid-template-columns/);
});

test("empty detail image contract retains the existing information graphic fallback", () => {
  const detail = renderToStaticMarkup(
    createElement(DetailMedia, { event: fallbackEvent, images: [], onExpand: () => undefined }),
  );
  assert.match(detail, /detail-info-graphic/);
  assert.doesNotMatch(detail, /detail-media-pair/);
  assert.match(app, /onImageError=\{\(\) => fail\(image\)\}/);
  assert.match(app, /if \(active\.length === 0\)/);
});
