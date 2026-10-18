export const validProgramTime = (value: string | null | undefined) => value == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function formatProgramTime(value: string) {
  const hour = Number(value.slice(0, 2));
  const minute = value.slice(3);
  const period = hour < 12 ? "오전" : hour === 12 && minute === "00" ? "낮" : "오후";
  return `${period} ${hour % 12 || 12}:${minute}`;
}
