import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

test("detail images use contain and expose an accessible lightbox", () => {
  assert.match(app, /detail\s*\n\s*onExpand/);
  assert.match(app, /role="dialog"/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /이미지 크게 보기 닫기/);
  assert.match(css, /\.scene-detail \.scene-image[\s\S]*object-fit: contain/);
});
