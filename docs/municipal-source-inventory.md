# Municipal Source Master Inventory

Generated from `docs/municipal-source-inventory.json`; do not hand-edit counts.

- Administrative-boundary authority: https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000055
- Cross-check: https://www.data.go.kr/data/3033254/fileData.do
- Checked: 2026-09-23
- Total research units: 245

| Status | Count |
| --- | ---: |
| ACTIVE | 9 |
| ONBOARDING_READY | 4 |
| COLLECTOR_GAP | 4 |
| WATCH | 6 |
| EXCLUDE | 0 |
| UNREVIEWED | 222 |

## Deterministic survey queue

Order: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become `ONBOARDING_READY`; common collector deficiencies become `COLLECTOR_GAP`; source-side deficiencies become `WATCH`; unsuitable sources become `EXCLUDE`. When 3–5 `ONBOARDING_READY` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.

First 20 queue entries: 1. `seoul-gangnam` · 2. `seoul-gangdong` · 3. `seoul-gangbuk` · 4. `seoul-gangseo` · 5. `seoul-gwanak` · 6. `seoul-gwangjin` · 7. `seoul-guro` · 8. `seoul-geumcheon` · 9. `seoul-nowon` · 10. `seoul-dobong` · 11. `seoul-dongdaemun` · 12. `seoul-dongjak` · 13. `seoul-mapo` · 14. `seoul-seodaemun` · 15. `seoul-seocho` · 16. `seoul-seongdong` · 17. `seoul-seongbuk` · 18. `seoul-songpa` · 19. `seoul-yangcheon` · 20. `seoul-yeongdeungpo`
