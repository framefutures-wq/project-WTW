# Municipal generic source survey — 2026-09-22

This survey records official municipal sources assessed for generic onboarding.
Generic onboarding accepts only an official HTTPS allowlisted host and enters the
existing JSON-LD, PDF, image, and generic HTML fallback path. Generic HTML reads
only self-contained table rows, list items, or card blocks with explicit title,
full-year date, and venue fields.

## Not added

| Municipality | Official source checked | Result | Reason |
| --- | --- | --- | --- |
| Seocho-gu | `https://www.seocho.go.kr/site/seocho/ex/bbs/List.do?cbIdx=59` | Excluded after generic HTML recheck | The canonical table has title and publication-date columns, but no event period or venue columns. Generic extraction returned zero candidates rather than joining facts from detail posts. |
| Cheongju | `https://schedule.cheongju.go.kr/xwcms/userScheduleCalendar.do?yyyymm=202609` | Excluded after generic HTML recheck | The official schedule is a potential table source, but the canonical endpoint did not complete within the bounded official fetch window during recheck. It is not registered until its runtime availability and durable current-calendar URL are verified. |
| Gangneung | `https://www.gangneung.go.kr/tour/prog/festival/sub01_01_01/list.do` | Excluded | The listed HTTPS hostname did not present a certificate valid for `www.gangneung.go.kr` during the check. It cannot be placed on an HTTPS allowlist until the official endpoint is verified. |

No new source was registered from this survey. This preserves the rule that a
generic source must have a durable canonical list with a verified generic signal;
otherwise it would generate retry noise without safe candidate extraction.
