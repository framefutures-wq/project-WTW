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
| ONBOARDING_READY | 17 |
| COLLECTOR_GAP | 28 |
| WATCH | 82 |
| EXCLUDE | 0 |
| UNREVIEWED | 109 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `daejeon-대덕` · 2. `daejeon-동` · 3. `daejeon-서` · 4. `daejeon-유성` · 5. `daejeon-jung` · 6. `ulsan-남` · 7. `ulsan-동` · 8. `ulsan-북` · 9. `ulsan-울주` · 10. `ulsan-jung` · 11. `gangwon-강릉` · 12. `gangwon-고성` · 13. `gangwon-동해` · 14. `gangwon-삼척` · 15. `gangwon-속초` · 16. `gangwon-양구` · 17. `gangwon-양양` · 18. `gangwon-영월` · 19. `gangwon-원주` · 20. `gangwon-인제`
