export const CANONICAL_HOST = "galteum.com";
export const LEGACY_WORKERS_HOST = "weekend-mwohae.framefutures.workers.dev";

export function legacyHostRedirect(url: URL): Response | null {
  if (url.hostname !== LEGACY_WORKERS_HOST) return null;
  const target = new URL(url.pathname + url.search, `https://${CANONICAL_HOST}`);
  return Response.redirect(target.toString(), 301);
}
