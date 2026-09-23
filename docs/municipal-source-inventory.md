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
| ONBOARDING_READY | 3 |
| COLLECTOR_GAP | 16 |
| WATCH | 30 |
| EXCLUDE | 0 |
| UNREVIEWED | 187 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `gyeonggi-가평` · 2. `gyeonggi-과천` · 3. `gyeonggi-광명` · 4. `gyeonggi-광주` · 5. `gyeonggi-구리` · 6. `gyeonggi-군포` · 7. `gyeonggi-김포` · 8. `gyeonggi-남양주` · 9. `gyeonggi-동두천` · 10. `gyeonggi-성남` · 11. `gyeonggi-시흥` · 12. `gyeonggi-안산` · 13. `gyeonggi-안성` · 14. `gyeonggi-안양` · 15. `gyeonggi-양주` · 16. `gyeonggi-양평` · 17. `gyeonggi-여주` · 18. `gyeonggi-연천` · 19. `gyeonggi-오산` · 20. `gyeonggi-용인`
