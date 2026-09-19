export function imageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (/\b(?:logo|favicon|sprite|icon)\b/.test(url.pathname.toLowerCase()))
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function chooseTourApiImage(raw, inventory = []) {
  const first = imageUrl(raw?.firstimage) || imageUrl(raw?.firstimage2);
  if (first)
    return {
      url: first,
      evidence: "sources.raw_payload.firstimage/firstimage2",
    };
  const stored = inventory.find(
    (item) =>
      item?.asset === true &&
      /^raw\.firstimage/.test(item.path || "") &&
      imageUrl(item.url),
  );
  return stored
    ? {
        url: imageUrl(stored.url),
        evidence: "official_source_audits.url_inventory_json",
      }
    : null;
}
