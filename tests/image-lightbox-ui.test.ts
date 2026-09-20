import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventImageLayers } from "../src/App";

const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

test("detail images use contain and expose an accessible lightbox", () => {
  assert.match(app, /detail\s*\n\s*onExpand/);
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
});
