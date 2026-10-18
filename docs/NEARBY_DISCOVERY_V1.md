# Nearby discovery v1

`내 주변 찾기` is activated only by a user click. The browser requests a
low-accuracy location with a 10-second timeout and a five-minute maximum age.
Coordinates are rounded to three decimal places before the request, kept only in
React memory for the current tab, and are never stored in D1, browser storage,
URLs, analytics, or Worker logs. Refreshing clears nearby mode.

The client calls `POST /api/events/nearby` with the rounded coordinates and the
same date, search, companion, content, and cost filters used by the list. The
response is `no-store`. Region and nearby do not combine: enabling nearby clears
region; choosing a region clears nearby and restores date ordering.

The Worker first applies existing visibility and user filters, then a 200 km
latitude/longitude bounding box. It reads at most 501 candidate rows, computes
Haversine straight-line distance only for the first 500, sorts by distance then
start date, end date, and id, and slices the globally sorted result for pages.
The UI is told if the cap is reached so it does not imply an exact total.
`idx_events_nearby_candidates` supports the bounding candidate query.

Distance labels are approximate straight-line distances, not routes or travel
time. The same 9-item pages and 36-item visible batch cap apply. Nearby state
stays in memory while opening and closing detail, but never becomes a shareable
URL state.

At a scale where 500 nearby candidates is routinely reached, replace the
longitude/latitude B-tree candidate strategy with a dedicated spatial tiling or
geospatial service. Maps, route distance, geocoding, background location, and
location persistence are out of scope for v1.
