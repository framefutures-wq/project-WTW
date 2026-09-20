export const validProgramTime = (value: string | null | undefined) => value == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
