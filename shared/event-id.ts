export const MAX_EVENT_ID_LENGTH = 512;

const INVALID_EVENT_ID = /[\u0000-\u001F\u007F]/;

export function validEventId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_EVENT_ID_LENGTH &&
    !INVALID_EVENT_ID.test(value)
  );
}

export function decodeEventPathId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return validEventId(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
