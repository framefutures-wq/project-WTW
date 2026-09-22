# Municipal generic source survey — 2026-09-22

This survey records official municipal sources assessed for generic onboarding.
Generic onboarding accepts only an official HTTPS allowlisted host and enters the
existing JSON-LD, PDF, and image fallback path. It does not infer event core from
ordinary list markup.

## Not added

| Municipality | Official source checked | Result | Reason |
| --- | --- | --- | --- |
| Seocho-gu | `https://www.seocho.go.kr/site/seocho/ex/bbs/List.do?cbIdx=59` | Excluded | The official event board exposes list rows but no JSON-LD Event records or direct PDF/image attachments on the canonical list. The existing fallback does not crawl each post, and adding a parser is outside this onboarding. |
| Cheongju | `https://schedule.cheongju.go.kr/xwcms/userScheduleCalendar.do?yyyymm=202609` | Excluded | The official schedule is an HTML calendar/table. It does not expose JSON-LD Event records or direct document attachments suitable for the generic fallback. |
| Gangneung | `https://www.gangneung.go.kr/tour/prog/festival/sub01_01_01/list.do` | Excluded | The listed HTTPS hostname did not present a certificate valid for `www.gangneung.go.kr` during the check. It cannot be placed on an HTTPS allowlist until the official endpoint is verified. |

No new source was registered from this survey. This preserves the rule that a
generic source must have a durable canonical list with a verified generic signal;
otherwise it would generate retry noise without safe candidate extraction.
