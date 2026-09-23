# Municipal Source Master Inventory

Generated from `docs/municipal-source-inventory.json`; do not hand-edit counts.

- Administrative-boundary authority: https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000055
- Cross-check: https://www.data.go.kr/data/3033254/fileData.do
- Checked: 2026-09-23
- Total research units: 245

| Status | Count |
| --- | ---: |
| ACTIVE | 9 |
| ONBOARDING_READY | 1 |
| COLLECTOR_GAP | 2 |
| WATCH | 2 |
| EXCLUDE | 0 |
| UNREVIEWED | 231 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `gyeonggi` · 2. `gangwon` · 3. `chungbuk` · 4. `chungnam` · 5. `jeonbuk` · 6. `jeonnam` · 7. `gyeongbuk` · 8. `gyeongnam` · 9. `jeju` · 10. `seoul-gangnam` · 11. `seoul-gangdong` · 12. `seoul-gangbuk` · 13. `seoul-gangseo` · 14. `seoul-gwanak` · 15. `seoul-gwangjin` · 16. `seoul-guro` · 17. `seoul-geumcheon` · 18. `seoul-nowon` · 19. `seoul-dobong` · 20. `seoul-dongdaemun`
