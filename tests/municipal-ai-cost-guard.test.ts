import assert from "node:assert/strict";
import test from "node:test";
import {
  municipalDocumentAI,
  type Env,
} from "../worker/env";
import type { MunicipalMarkdownAI } from "../shared/municipal-document-fallback";

const fakeAI: MunicipalMarkdownAI = {
  async toMarkdown() {
    return { format: "text", data: "ok" };
  },
};

const env = (flag?: string, ai: MunicipalMarkdownAI | undefined = fakeAI) =>
  ({
    AI: ai,
    MUNICIPAL_DOCUMENT_AI_ENABLED: flag,
  }) as Env;

test("municipal document AI is disabled by default even if a binding exists", () => {
  assert.equal(municipalDocumentAI(env(undefined)), undefined);
  assert.equal(municipalDocumentAI(env("false")), undefined);
});

test("municipal document AI requires an exact true flag and an available binding", () => {
  assert.equal(municipalDocumentAI(env("TRUE")), undefined);
  assert.equal(municipalDocumentAI(env("true", undefined)), undefined);
  assert.equal(municipalDocumentAI(env("true")), fakeAI);
});
