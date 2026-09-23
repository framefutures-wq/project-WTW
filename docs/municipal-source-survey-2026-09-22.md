# Municipal generic source survey — 2026-09-22

This survey records official municipal sources assessed for generic onboarding.
Generic onboarding accepts only an official HTTPS allowlisted host and enters the
existing JSON-LD, PDF, image, and generic HTML fallback path. Generic HTML reads
only self-contained table rows, list items, or card blocks with explicit title,
full-year date, and venue fields.

## Added

| Municipality  | Official source checked                                               | Generic contract                                       | Safety policy                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taebaek       | `https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502` | self-contained vertical HTML tables under `#scheduler` | Full-year title/date/venue core only; administrative schedules, meetings, and education are retained as candidates solely to pass through the existing `EXCLUDE` gate. |
| Seoul Hangang | `https://hangang.seoul.go.kr/www/eventMng/list.do?mid=538`            | self-contained `li.list-item` event cards              | Full-year title/date/venue and an explicit first-party `축제`, `문화예술`, or `공연` category are required. Other categories fail closed.                              |
| Daejeon      | `https://daejeon.go.kr/fvu/FvuEventList.do?menuSeq=504`               | self-contained `board_table_list` rows with split start/end columns | Full-year title/start/end/venue and a row-local theme in `공연`, `전시`, `축제/이벤트/행사`, or `체육` are required; `기타` fails closed. |

These sources receive no dedicated parser. Detail links expressed as JavaScript
are retained as the canonical official listing URL; external, malformed, or
otherwise non-allowlisted URLs are rejected by the common fallback.

The Daejeon source returned HTTP 200 and passed the live read-only dry-run as
`generic_html`: 10 candidates, all with title/full-year start and end dates,
venue, and allowlisted official URL, with no parse errors. The generic table
extractor now supports explicit split start/end columns and row-local category
allowlists without inferring years or joining facts across rows.

## Not added

| Municipality | Official source checked                                                       | Result                              | Reason                                                                                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seocho-gu    | `https://www.seocho.go.kr/site/seocho/ex/bbs/List.do?cbIdx=59`                | Excluded after generic HTML recheck | The canonical table has title and publication-date columns, but no event period or venue columns. Generic extraction returned zero candidates rather than joining facts from detail posts.                                                                 |
| Cheongju     | `https://schedule.cheongju.go.kr/xwcms/userScheduleCalendar.do?yyyymm=202609` | Excluded after generic HTML recheck | The official schedule is a potential table source, but the canonical endpoint did not complete within the bounded official fetch window during recheck. It is not registered until its runtime availability and durable current-calendar URL are verified. |
| Incheon      | `https://www.incheon.go.kr/res/RE050101/`                              | Deferred after pagination/policy audit | Core card quality is strong, but the list is start-date-descending across 12 pages, so page 1 misses nearer events. Pages 1–3 were ~77% `REVIEW`, which would create `AUTO_RETRY` noise, and literal `<...>` in titles is lost by the current generic cleaner. Do not onboard until product policy and bounded pagination justify it. |
| Gangneung    | `https://www.gangneung.go.kr/tour/prog/festival/sub01_01_01/list.do`          | Excluded                            | The listed HTTPS hostname did not present a certificate valid for `www.gangneung.go.kr` during the check. It cannot be placed on an HTTPS allowlist until the official endpoint is verified.                                                               |

Sources are registered only when the durable canonical list has a verified
generic signal and safe candidate extraction; otherwise they remain unregistered
to avoid retry noise.
