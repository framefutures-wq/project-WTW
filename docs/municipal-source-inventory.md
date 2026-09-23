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
| COLLECTOR_GAP | 35 |
| WATCH | 138 |
| EXCLUDE | 0 |
| UNREVIEWED | 42 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `gyeongbuk-경산` · 2. `gyeongbuk-경주` · 3. `gyeongbuk-고령` · 4. `gyeongbuk-구미` · 5. `gyeongbuk-김천` · 6. `gyeongbuk-문경` · 7. `gyeongbuk-봉화` · 8. `gyeongbuk-상주` · 9. `gyeongbuk-성주` · 10. `gyeongbuk-안동` · 11. `gyeongbuk-영덕` · 12. `gyeongbuk-영양` · 13. `gyeongbuk-영주` · 14. `gyeongbuk-영천` · 15. `gyeongbuk-예천` · 16. `gyeongbuk-울릉` · 17. `gyeongbuk-울진` · 18. `gyeongbuk-의성` · 19. `gyeongbuk-청도` · 20. `gyeongbuk-청송`
