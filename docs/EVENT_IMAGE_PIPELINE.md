# 행사 대표 이미지 파이프라인

## 감사 스냅샷

2026-09-19 UTC에 원격 D1 `weekend-mwohae-production`의 실제 TourAPI 행사 263건을 읽기 전용으로 감사했다. 대상은 `events`와 연결된 `sources.kind='tourapi'` 행이며, raw payload와 이미 저장된 공식 출처 감사 기록만 사용했다. 새 TourAPI 동기화, 외부 검색, 공식 페이지 재수집은 실행하지 않았다.

| 항목                                                      |  수 |
| --------------------------------------------------------- | --: |
| 전체 실제 행사                                            | 263 |
| `raw_payload.firstimage` 후보                             | 263 |
| `raw_payload.firstimage2` 후보                            | 263 |
| 공식 출처 감사 링크 보유 행사                             | 209 |
| 공식성 확인 및 접근 가능한 링크                           | 107 |
| TourAPI 이미지가 없어 공식 출처 이미지 보완이 필요한 행사 |   0 |
| 최종 대표 이미지 확보                                     | 263 |
| 계속 플레이스홀더인 행사                                  |   0 |

현재 raw payload에서 확인된 이미지 필드는 `firstimage`, `firstimage2`이며 모두 `https://tong.visitkorea.or.kr/cms/resource/...` 형식이었다. 공식 감사 `url_inventory_json`에도 같은 raw 이미지의 provenance가 저장되어 있다. 따라서 이번 스냅샷에서는 공식 출처 HTML의 `og:image`를 추가로 수집하지 않았고, 보완 후보는 0건이다.

## 저장 구조

비파괴 migration `0005_event_images.sql`로 `event_images`를 추가했다. 행사당 대표 1건을 저장하며 URL, 출처 유형, 출처 페이지, 상태(`ok`, `missing`, `blocked`, `invalid`), MIME/크기(확인 가능한 경우), 마지막 확인 시각, 근거 메모를 보관한다. 기존 `events`, `sources`, `event_evidence`, 공식 감사 데이터는 수정하지 않는다.

## 선택 우선순위와 품질 필터

1. 저장된 TourAPI raw `firstimage`
2. 저장된 TourAPI raw `firstimage2`
3. 해당 행사의 기존 공식 출처 감사 inventory에 저장된 TourAPI asset
4. 위 후보가 없을 때만 기존 공식 출처의 행사 대표 이미지 후보(이번 스냅샷에는 없음)
5. 후보가 없거나 필터를 통과하지 못하면 플레이스홀더

자동 필터는 HTTPS URL만 허용하고, URL이 아니거나 `logo`, `favicon`, `sprite`, `icon` 경로가 포함된 공통 자산은 제외한다. 브라우저 로딩 실패는 카드/상세의 기존 주제 일러스트 fallback으로 전환한다. 현재 raw에는 픽셀 크기와 MIME 메타데이터가 없으므로 이를 추측해 채우지 않는다. 샘플 GET에서 공식 URL이 `image/png`와 실제 이미지 바이트를 반환하는 것을 확인했다.

## UI 반영

목록 카드와 상세 화면의 기존 `Scene` 영역에서 유효한 대표 이미지가 있으면 `object-fit: cover`로 표시한다. 이미지가 없거나 로딩에 실패하면 기존 주제 일러스트를 유지한다. 이미지에는 행사명 기반 대체 텍스트와 작은 `공식 대표 이미지` 표시를 사용하며, 카드 레이아웃과 상세 레이아웃은 유지한다.

## 한계와 다음 단계

현재 모든 실제 행사에 TourAPI 후보가 있어 공식 출처 이미지 보완 경로는 실행되지 않았다. 향후 TourAPI 후보가 없는 행사에서만 이미 저장된 공식 페이지의 직접 행사 이미지(`og:image` 등)가 감사 provenance로 확인될 때 보완할 수 있다. 이미지 binary의 크기/비율을 대규모로 재수집하지 않으며, 표시 실패는 사용자 화면 fallback으로 안전하게 처리한다.
