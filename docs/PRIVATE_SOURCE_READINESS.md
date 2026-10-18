# Private official-source readiness sweep (2026-09-21)

This was a read-only, bounded audit: no D1 writes, migrations, production
publishes, or search-engine dependency in the resulting adapter. Each initial
candidate was limited to its official public site and at most six requests.
`PASS` requires every hard gate A–F.

| Source | Official domain / discovery | A | B | C | D | E | F | Current/upcoming candidates | Result / reason |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| 한국민속촌 | [koreanfolk.co.kr](https://www.koreanfolk.co.kr/) homepage promotion links | PASS | PASS | PASS | PASS | PASS | PASS | 7 listing items (5 bounded detail reads) | **Selected.** Homepage exposes current `/home/promotion/event/<numeric-id>` links; details expose explicit `startsAt`/`endsAt`; official [facility profile](https://www.koreanfolk.co.kr/about) supplies the fixed venue/address. Promotion-channel marker distinguishes parser failure from a genuine empty list. |
| 에버랜드 | web.everland.com | PASS | FAIL | PASS (partial) | FAIL | FAIL | PASS (partial) | 0 publishable | Remains disabled: mutable heading fallback and no publishable official venue evidence. |
| 롯데월드 어드벤처 | adventure.lotteworld.com | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Homepage access works, but audited public entry was not a bounded current event listing with durable item identity/core fields. |
| 서울랜드 | seoulland.co.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public landing page did not expose an auditable current official event listing/detail contract in the bounded check. |
| 레고랜드 코리아 | legoland.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public landing page did not expose an auditable current official event listing/detail contract in the bounded check. |
| 경주월드 | gjw.co.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | TLS verification failed in the bounded audit; no safe adapter may bypass certificate validation. |
| 이월드 | eworld.kr | PASS | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public event navigation exists, but the bounded entry did not establish durable item IDs plus date/venue detail fields. |
| 아쿠아플라넷 제주 | aquaplanet.co.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Official HTTPS origin timed out in the bounded audit. |
| 아침고요수목원 | morningcalm.co.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public landing page did not establish a bounded current event listing/detail contract. |
| 화담숲 | hwadamsup.com | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public landing page did not establish a bounded current event listing/detail contract. |
| 키자니아 서울 | kidzania.co.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public landing page did not establish a bounded current event listing/detail contract. |
| 스타필드 하남 | starfield.co.kr | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | Public landing page did not establish a bounded current event listing/detail contract. |
| 제주신화월드 | shinhwaworld.com | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | 0 | TLS verification failed in the bounded audit; no safe adapter may bypass certificate validation. |

## Selected source contract

- Source key: `korean_folk_village`; allowed HTTPS hosts are only
  `www.koreanfolk.co.kr` and `koreanfolk.co.kr`.
- Discovery is the official current homepage. It is capped at 25 candidates,
  then five detail fetches per daily run (six HTTP requests total).
- Identity is the official numeric item ID: `private-korean_folk_village-<id>`.
  It never includes title, dates, or venue formatting.
- Detail pages are the authoritative date source. A homepage banner date is
  never promoted by itself.
- Venue evidence is the official facility profile: 한국민속촌,
  경기도 용인시 기흥구 민속촌로 90. It is stored alongside event venue evidence.
- The listing must contain promotion-event links; a missing marker is a source
  error, not a successful zero-event run. Commercial/store items are excluded;
  inconclusive promotion copy is retained as AUTO_RETRY.

Only this source is enabled. Everland and every other audited candidate remain
disabled. The selection is deterministic: most current publishable candidates,
complete stable-identity coverage, simpler official listing/detail shape, fewer
requests, then Korean name order.
