export function parseVersionUrl(output) {
  const urls = String(output).match(/https:\/\/[^\s"'<>]+/gi) ?? [];
  return urls
    .map((value) => value.replace(/[),.;]+$/, ""))
    .find((value) => { try { return new URL(value).hostname.endsWith("workers.dev"); } catch { return false; } }) ?? null;
}
