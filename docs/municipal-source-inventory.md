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
| COLLECTOR_GAP | 30 |
| WATCH | 114 |
| EXCLUDE | 0 |
| UNREVIEWED | 71 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `chungnam-계룡` · 2. `chungnam-공주` · 3. `chungnam-금산` · 4. `chungnam-논산` · 5. `chungnam-당진` · 6. `chungnam-보령` · 7. `chungnam-부여` · 8. `chungnam-서산` · 9. `chungnam-서천` · 10. `chungnam-아산` · 11. `chungnam-예산` · 12. `chungnam-천안` · 13. `chungnam-청양` · 14. `chungnam-태안` · 15. `chungnam-홍성` · 16. `jeonbuk-고창` · 17. `jeonbuk-군산` · 18. `jeonbuk-김제` · 19. `jeonbuk-남원` · 20. `jeonbuk-무주`
