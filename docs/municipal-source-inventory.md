# Municipal Source Master Inventory

Generated from `docs/municipal-source-inventory.json`; do not hand-edit counts.

- Administrative-boundary authority: https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000055
- Current monthly baseline: https://jumin.mois.go.kr/statMonth.do
- Legal/current-change cross-checks: https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=286067 · https://www.incheon.go.kr/IC040102
- Baseline as of: 2026-09-23
- Baseline note: 2026-09-23 current baseline. The 2026-08 MOIS monthly current-administration table reflects the unified Jeonnam-Gwangju Special City. The special act took effect 2026-07-01; Incheon’s 2-county/9-district structure also took effect 2026-07-01. Jeju’s two administrative cities remain included as research units by project policy, distinct from autonomous cities/counties/districts.
- Cross-check: https://www.data.go.kr/data/3033254/fileData.do
- Checked: 2026-09-23
- Total research units: 245

| Status | Count |
| --- | ---: |
| ACTIVE | 9 |
| ONBOARDING_READY | 21 |
| COLLECTOR_GAP | 32 |
| WATCH | 127 |
| EXCLUDE | 0 |
| UNREVIEWED | 56 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `jeonbuk-고창` · 2. `jeonbuk-군산` · 3. `jeonbuk-김제` · 4. `jeonbuk-남원` · 5. `jeonbuk-무주` · 6. `jeonbuk-부안` · 7. `jeonbuk-순창` · 8. `jeonbuk-완주` · 9. `jeonbuk-익산` · 10. `jeonbuk-임실` · 11. `jeonbuk-장수` · 12. `jeonbuk-전주` · 13. `jeonbuk-정읍` · 14. `jeonbuk-진안` · 15. `gyeongbuk-경산` · 16. `gyeongbuk-경주` · 17. `gyeongbuk-고령` · 18. `gyeongbuk-구미` · 19. `gyeongbuk-김천` · 20. `gyeongbuk-문경`
