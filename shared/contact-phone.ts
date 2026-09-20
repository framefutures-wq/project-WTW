export type ContactPhone = { display: string; href: string };

function displayKoreanPhone(digits: string) {
  if (/^1[5-8]\d{2}\d{4}$/.test(digits))
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.startsWith("02")) {
    if (digits.length !== 9 && digits.length !== 10) return null;
    const middle = digits.length === 9 ? 5 : 6;
    return `02-${digits.slice(2, middle)}-${digits.slice(middle)}`;
  }
  if (
    /^0\d{2}/.test(digits) &&
    (digits.length === 10 || digits.length === 11)
  ) {
    const middle = digits.length === 10 ? 6 : 7;
    return `${digits.slice(0, 3)}-${digits.slice(3, middle)}-${digits.slice(middle)}`;
  }
  return null;
}

/** TourAPI's tel field can contain labels, multiple numbers, or extensions. */
export function normalizeOfficialPhone(value: unknown): ContactPhone | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || /[^0-9+()\s-]/.test(raw)) return null;
  const compact = raw.replace(/[\s()-]/g, "");
  if (/^\+82\d{9,10}$/.test(compact)) {
    const display = displayKoreanPhone(`0${compact.slice(3)}`);
    return display ? { display, href: `tel:${compact}` } : null;
  }
  if (!/^\d+$/.test(compact)) return null;
  const display = displayKoreanPhone(compact);
  return display ? { display, href: `tel:${compact}` } : null;
}
