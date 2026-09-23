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
| ONBOARDING_READY | 27 |
| COLLECTOR_GAP | 36 |
| WATCH | 153 |
| EXCLUDE | 0 |
| UNREVIEWED | 20 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `gyeongnam-거제` · 2. `gyeongnam-거창` · 3. `gyeongnam-고성` · 4. `gyeongnam-김해` · 5. `gyeongnam-남해` · 6. `gyeongnam-밀양` · 7. `gyeongnam-사천` · 8. `gyeongnam-산청` · 9. `gyeongnam-양산` · 10. `gyeongnam-의령` · 11. `gyeongnam-진주` · 12. `gyeongnam-창녕` · 13. `gyeongnam-창원` · 14. `gyeongnam-통영` · 15. `gyeongnam-하동` · 16. `gyeongnam-함안` · 17. `gyeongnam-함양` · 18. `gyeongnam-합천` · 19. `jeju-서귀포` · 20. `jeju-제주`
