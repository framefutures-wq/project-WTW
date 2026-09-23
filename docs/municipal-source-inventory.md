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
| ONBOARDING_READY | 12 |
| COLLECTOR_GAP | 20 |
| WATCH | 43 |
| EXCLUDE | 0 |
| UNREVIEWED | 161 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `busan-gangseo` · 2. `busan-금정` · 3. `busan-기장` · 4. `busan-남` · 5. `busan-동` · 6. `busan-동래` · 7. `busan-부산진` · 8. `busan-북` · 9. `busan-사상` · 10. `busan-사하` · 11. `busan-서` · 12. `busan-수영` · 13. `busan-연제` · 14. `busan-영도` · 15. `busan-jung` · 16. `busan-해운대` · 17. `daegu-군위` · 18. `daegu-남` · 19. `daegu-달서` · 20. `daegu-달성`
