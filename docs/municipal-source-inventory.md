# Municipal Source Master Inventory

Generated from `docs/municipal-source-inventory.json`; do not hand-edit counts.

- Administrative-boundary authority: https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000055
- Cross-check: https://www.data.go.kr/data/3033254/fileData.do
- Checked: 2026-09-23
- Total research units: 245

| Status | Count |
| --- | ---: |
| ACTIVE | 9 |
| ONBOARDING_READY | 2 |
| COLLECTOR_GAP | 10 |
| WATCH | 22 |
| EXCLUDE | 0 |
| UNREVIEWED | 202 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `seoul-yongsan` · 2. `seoul-eunpyeong` · 3. `seoul-jongno` · 4. `seoul-jung` · 5. `seoul-jungnang` · 6. `incheon-강화` · 7. `incheon-계양` · 8. `incheon-남동` · 9. `incheon-동` · 10. `incheon-미추홀` · 11. `incheon-부평` · 12. `incheon-서` · 13. `incheon-연수` · 14. `incheon-옹진` · 15. `incheon-jung` · 16. `gyeonggi-가평` · 17. `gyeonggi-과천` · 18. `gyeonggi-광명` · 19. `gyeonggi-광주` · 20. `gyeonggi-구리`
