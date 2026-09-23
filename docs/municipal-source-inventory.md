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
| ONBOARDING_READY | 14 |
| COLLECTOR_GAP | 23 |
| WATCH | 54 |
| EXCLUDE | 0 |
| UNREVIEWED | 145 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `daegu-군위` · 2. `daegu-남` · 3. `daegu-달서` · 4. `daegu-달성` · 5. `daegu-동` · 6. `daegu-북` · 7. `daegu-서` · 8. `daegu-수성` · 9. `daegu-jung` · 10. `jeonnam-gwangju-강진` · 11. `jeonnam-gwangju-고흥` · 12. `jeonnam-gwangju-곡성` · 13. `jeonnam-gwangju-광산` · 14. `jeonnam-gwangju-광양` · 15. `jeonnam-gwangju-구례` · 16. `jeonnam-gwangju-나주` · 17. `jeonnam-gwangju-남` · 18. `jeonnam-gwangju-담양` · 19. `jeonnam-gwangju-동` · 20. `jeonnam-gwangju-목포`
