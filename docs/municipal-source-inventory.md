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
| COLLECTOR_GAP | 15 |
| WATCH | 22 |
| EXCLUDE | 0 |
| UNREVIEWED | 197 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `incheon-강화` · 2. `incheon-계양` · 3. `incheon-남동` · 4. `incheon-동` · 5. `incheon-미추홀` · 6. `incheon-부평` · 7. `incheon-서` · 8. `incheon-연수` · 9. `incheon-옹진` · 10. `incheon-jung` · 11. `gyeonggi-가평` · 12. `gyeonggi-과천` · 13. `gyeonggi-광명` · 14. `gyeonggi-광주` · 15. `gyeonggi-구리` · 16. `gyeonggi-군포` · 17. `gyeonggi-김포` · 18. `gyeonggi-남양주` · 19. `gyeonggi-동두천` · 20. `gyeonggi-성남`
