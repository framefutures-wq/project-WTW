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
| ONBOARDING_READY | 2 |
| COLLECTOR_GAP | 15 |
| WATCH | 21 |
| EXCLUDE | 0 |
| UNREVIEWED | 198 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `incheon-강화` · 2. `incheon-검단` · 3. `incheon-계양` · 4. `incheon-남동` · 5. `incheon-미추홀` · 6. `incheon-부평` · 7. `incheon-서해` · 8. `incheon-연수` · 9. `incheon-영종` · 10. `incheon-옹진` · 11. `incheon-제물포` · 12. `gyeonggi-가평` · 13. `gyeonggi-과천` · 14. `gyeonggi-광명` · 15. `gyeonggi-광주` · 16. `gyeonggi-구리` · 17. `gyeonggi-군포` · 18. `gyeonggi-김포` · 19. `gyeonggi-남양주` · 20. `gyeonggi-동두천`
