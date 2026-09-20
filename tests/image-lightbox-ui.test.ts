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
});
