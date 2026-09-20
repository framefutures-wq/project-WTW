# 행사 상세 콘텐츠 보강 v1

상세 enrichment는 공식 주최기관·지자체·공공기관 또는 TourAPI의 명시 정보만 사용한다. 뉴스, 블로그, 추정된 시간·장소·프로그램은 저장하거나 표시하지 않는다.

`event_enrichments`는 행사 한줄 소개, `event_highlights`는 주요 볼거리, `event_programs`와 `event_program_tags`는 날짜·시간·장소가 확인된 프로그램을 저장한다. 프로그램 시간이 없으면 `start_time`은 null로 두며, 공식 원문의 모호한 시간 표현은 `schedule_text`로만 보존한다. 빈 section은 public UI에 표시하지 않는다.

공식 프로그램의 명시 사실은 같은 vocabulary의 `event_tags`로 전파할 수 있다. 이 v1에서는 고양호수예술축제의 공식 불꽃 프로그램만 `fireworks` event tag로 연결한다. 전체 행사 재분류는 수행하지 않는다.

## v1 production 대상

- 고양호수예술축제 (`tourapi-1100492`): 고양시 공식 보도자료와 고양호수예술축제 공식 누리집을 근거로 summary, highlights, 3개 프로그램을 저장한다.

고양시 공식 보도자료는 축제의 기간·장소·거리예술/체험·9월 20일 불꽃 드론 쇼와 불꽃놀이를 확인한다. 공식 누리집은 `Hey, Listen`의 9월 19일 19:30·한울광장 일정과 서커스 빌리지의 장소·운영시간을 확인한다. 공식 누리집 시간표가 준비중인 항목에는 시간을 만들지 않는다.

이 구조는 정보가 없는 상세에서도 section을 숨기는 방식으로 5개 대표 유형(불꽃, 공연, 체험, 장기행사, 정보부족 행사)을 local fixture/UI 테스트로 검증한다. production data enrichment 확대는 source별 날짜·시간·identity 안정성을 다시 확인한 뒤 결정한다.
