import { readFileSync, writeFileSync } from "node:fs";

const checkedAt = "2026-09-23";
const statuses = new Set([
  "ACTIVE",
  "ONBOARDING_READY",
  "COLLECTOR_GAP",
  "WATCH",
  "EXCLUDE",
  "UNREVIEWED",
]);
const authority = {
  administrative_boundary_source: "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000055",
  current_baseline_source: "https://jumin.mois.go.kr/statMonth.do",
  cross_check_source: "https://www.data.go.kr/data/3033254/fileData.do",
  legal_basis_sources: [
    "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=286067",
    "https://www.incheon.go.kr/IC040102",
  ],
  baseline_as_of: checkedAt,
  baseline_note: "2026-09-23 current baseline. The 2026-08 MOIS monthly current-administration table reflects the unified Jeonnam-Gwangju Special City. The special act took effect 2026-07-01; Incheon’s 2-county/9-district structure also took effect 2026-07-01. Jeju’s two administrative cities remain included as research units by project policy, distinct from autonomous cities/counties/districts.",
  checked_at: checkedAt,
};

const metros = [
  ["seoul", "서울특별시", "special_city", "https://www.seoul.go.kr"],
  ["busan", "부산광역시", "metropolitan_city", "https://www.busan.go.kr"],
  ["daegu", "대구광역시", "metropolitan_city", "https://www.daegu.go.kr"],
  ["incheon", "인천광역시", "metropolitan_city", "https://www.incheon.go.kr"],
  ["jeonnam-gwangju", "전남광주통합특별시", "special_city", "https://www.jeonnam.go.kr"],
  ["daejeon", "대전광역시", "metropolitan_city", "https://www.daejeon.go.kr"],
  ["ulsan", "울산광역시", "metropolitan_city", "https://www.ulsan.go.kr"],
  ["sejong", "세종특별자치시", "special_self_governing_city", "https://www.sejong.go.kr"],
  ["gyeonggi", "경기도", "province", "https://www.gg.go.kr"],
  ["gangwon", "강원특별자치도", "special_self_governing_province", "https://state.gwd.go.kr"],
  ["chungbuk", "충청북도", "province", "https://www.chungbuk.go.kr"],
  ["chungnam", "충청남도", "province", "https://www.chungnam.go.kr"],
  ["jeonbuk", "전북특별자치도", "special_self_governing_province", "https://www.jeonbuk.go.kr"],
  ["gyeongbuk", "경상북도", "province", "https://www.gb.go.kr"],
  ["gyeongnam", "경상남도", "province", "https://www.gyeongnam.go.kr"],
  ["jeju", "제주특별자치도", "special_self_governing_province", "https://www.jeju.go.kr"],
];

const divisions = {
  seoul: "종로구,중구,용산구,성동구,광진구,동대문구,중랑구,성북구,강북구,도봉구,노원구,은평구,서대문구,마포구,양천구,강서구,구로구,금천구,영등포구,동작구,관악구,서초구,강남구,송파구,강동구",
  busan: "중구,서구,동구,영도구,부산진구,동래구,남구,북구,해운대구,사하구,금정구,강서구,연제구,수영구,사상구,기장군",
  daegu: "중구,동구,서구,남구,북구,수성구,달서구,달성군,군위군",
  incheon: "강화군,옹진군,제물포구,영종구,미추홀구,연수구,남동구,부평구,계양구,서해구,검단구",
  "jeonnam-gwangju": "동구,서구,남구,북구,광산구,목포시,여수시,순천시,나주시,광양시,담양군,곡성군,구례군,고흥군,보성군,화순군,장흥군,강진군,해남군,영암군,무안군,함평군,영광군,장성군,완도군,진도군,신안군",
  daejeon: "동구,중구,서구,유성구,대덕구",
  ulsan: "중구,남구,동구,북구,울주군",
  gyeonggi: "수원시,성남시,의정부시,안양시,부천시,광명시,평택시,동두천시,안산시,고양시,과천시,구리시,남양주시,오산시,시흥시,군포시,의왕시,하남시,용인시,파주시,이천시,안성시,김포시,화성시,광주시,양주시,포천시,여주시,연천군,가평군,양평군",
  gangwon: "춘천시,원주시,강릉시,동해시,태백시,속초시,삼척시,홍천군,횡성군,영월군,평창군,정선군,철원군,화천군,양구군,인제군,고성군,양양군",
  chungbuk: "청주시,충주시,제천시,보은군,옥천군,영동군,증평군,진천군,괴산군,음성군,단양군",
  chungnam: "천안시,공주시,보령시,아산시,서산시,논산시,계룡시,당진시,금산군,부여군,서천군,청양군,홍성군,예산군,태안군",
  jeonbuk: "전주시,군산시,익산시,정읍시,남원시,김제시,완주군,진안군,무주군,장수군,임실군,순창군,고창군,부안군",
  gyeongbuk: "포항시,경주시,김천시,안동시,구미시,영주시,영천시,상주시,문경시,경산시,의성군,청송군,영양군,영덕군,청도군,고령군,성주군,칠곡군,예천군,봉화군,울진군,울릉군",
  gyeongnam: "창원시,진주시,통영시,사천시,김해시,밀양시,거제시,양산시,의령군,함안군,창녕군,고성군,남해군,하동군,산청군,함양군,거창군,합천군",
  jeju: "제주시,서귀포시",
};

const known = {
  "jeonnam-gwangju": ["WATCH", "https://www.jeonnam.go.kr/", "official_tourism_listing_unverified", "source_core_unverified", "현재 통합특별시 공식 누리집(구 전라남도청)이 통합특별시 명칭·주소로 운영되며 관광객 메뉴에 ‘시군축제 일정’ 링크가 노출된다. 다만 live HTTP 요청은 timeout/DNS 오류로 목록 target과 지속성, 2026 full-year start/end·venue·detail URL·pagination 및 generic extraction을 확인하지 못했다. 구 전남 축제 목록과 구 광주 source를 임의 결합하거나 legacy 내용을 계승하지 않으며, 확인 가능한 광역 canonical source가 확보될 때까지 WATCH."],
  seoul: ["ACTIVE", "https://hangang.seoul.go.kr/www/eventMng/list.do?mid=538", "official_event_listing", "generic_fallback", "한강사업본부 행사 source; 서울 전체 coverage를 뜻하지 않음"],
  "seoul-gangnam": ["ONBOARDING_READY", "https://www.gangnam.go.kr/office/gfac/board/gfac_lifeculture/list.do?mid=gfac_festival06", "official_culture_listing", "generic_fallback_paginated", "강남문화재단(강남구 산하 공식 문화기관) 축제 목록. live 목록에서 title·2026 full-year 행사기간·행사장소·first-party detail URL이 같은 항목 블록에 있고 페이지네이션도 확인되어 현재 generic collector의 self-contained extraction에 적합함. 대표 항목은 2026 강남생활문화축제(2026-10-17~2026-10-18, 일원에코파크 및 에코센터)." , "https://www.gangnam.go.kr"],
  "seoul-gangdong": ["WATCH", "https://www.gangdong.go.kr/web/culture/contents/gdc030_040", "official_culture_detail", "source_core_inconsistent", "강동구청 강동문화포털의 선사문화축제 일정표는 공식 소유권과 행사별 장소를 확인할 수 있으나 live 페이지가 2025 일정표 중심의 정적 프로그램 표이고, source-wide 지속 목록에서 2026 full-year 행사기간·detail URL·pagination을 일관되게 제공하지 않음. 보도자료의 2026 동 지역축제는 단발성 공지라 canonical daily source로 승격하지 않음.", "https://www.gangdong.go.kr"],
  "seoul-gangbuk": ["WATCH", "https://child.gangbuk.go.kr/", "official_government_portal", "source_core_inconsistent", "강북구 공식 포털에서 백맥축제·문화/행사 예약 항목은 확인되지만 홈페이지 혼합 콘텐츠와 개별 모집/보도 페이지가 중심이다. 행사별 title·date·venue는 일부 detail에서 확인되나 지속적으로 갱신되는 full-year canonical listing 및 안정적인 pagination을 확인하지 못했고 generic collector의 source-wide self-contained extraction을 확정할 수 없음.", "https://www.gangbuk.go.kr"],
  "seoul-gangseo": ["WATCH", "https://www.gangseo.seoul.kr/munhwa/mh010204", "official_culture_detail", "source_core_missing", "강서문화관광의 겸재문화예술제 공식 detail은 title·2026-05-09 기간·겸재정선미술관/궁산근린공원 장소를 제공하지만, 확인한 canonical 페이지는 개별 행사 detail이고 source-wide 행사 listing·pagination·지속 detail index를 확인하지 못함. 단발성 행사 detail을 generic daily source로 승격하지 않음.", "https://www.gangseo.seoul.kr"],
  "seoul-gwanak": ["WATCH", "https://www.gwanak.go.kr/site/gwanak/main.do", "official_government_portal", "source_core_missing", "관악구청 공식 포털의 문화관광소식·예약/교육 상세에서 개별 행사 사실은 확인되지만 홈페이지는 혼합 게시판/예약 포털이며, 행사·축제의 title·full-year date·venue를 함께 유지하는 durable canonical listing과 pagination을 확인하지 못함. 관악강감찬축제 관련 과거 전자책/보도자료는 daily source로 사용하지 않음.", "https://www.gwanak.go.kr"],
  "seoul-gwangjin": ["WATCH", "https://www.gwangjin.go.kr/portal/main/main.do", "official_government_portal", "source_core_missing", "광진구청 공식 포털에서 주간행사·개별 행사/보도자료는 확인되지만 축제·문화 일정이 혼합 게시판과 개별 공지로 분산되어 있다. source-wide full-year date·venue·durable detail URL을 함께 제공하는 canonical listing과 pagination을 live 확인하지 못함.", "https://www.gwangjin.go.kr"],
  "seoul-guro": ["WATCH", "https://www.guro.go.kr/www/index.do", "official_government_portal", "source_core_missing", "구로구청 공식 홈페이지와 월간 소식/예약 영역에서 행사 title·일시·장소가 개별 콘텐츠로 보이지만 행사·축제용 durable listing이 아니라 홈페이지 혼합 feed와 예약/소식 콘텐츠 구조다. source-wide full-year core와 안정적인 detail/list pagination을 확인하지 못해 generic collector source로 확정하지 않음.", "https://www.guro.go.kr"],
  "seoul-geumcheon": ["WATCH", "https://www.geumcheon.go.kr/shub/index.do", "official_government_portal", "source_core_missing", "금천구 공식 소셜허브·미디어홍보에서 과학축제 등 행사 제목과 게시일은 확인되지만, 행사기간·장소·durable detail이 source-wide로 함께 유지되는 공식 일정 listing이 아니라 홍보 feed/개별 게시물 구조다. pagination과 current generic self-contained extraction을 확인하지 못함.", "https://www.geumcheon.go.kr"],
  "seoul-nowon": ["WATCH", "https://www.nowon.kr/www/index.do", "official_government_portal", "source_core_missing", "노원구청 공식 홈페이지는 축제행사·문화공연 메뉴와 개별 행사 안내를 제공하지만 확인한 live 구조는 홈페이지 메뉴/공지·보도/행사 detail이 혼합되어 있다. 행사별 full-year date·venue는 일부 확인되나 source-wide durable listing·pagination과 generic collector의 일관된 self-contained extraction을 확정하지 못함.", "https://www.nowon.kr"],
  "seoul-dobong": ["WATCH", "https://tour.dobong.go.kr/Contents.asp?code=10003458", "official_tourism_detail", "source_core_inconsistent", "도봉구 공식 문화관광의 축제와 문화행사 페이지는 정월대보름·도봉한글잔치·도봉옛길 문화제 등 title·장소·반복 시기/내용을 제공하지만 exact full-year start/end가 아닌 음력·기념일·월중 표현이 섞인 정적 소개 페이지다. durable event listing·pagination과 generic full-year extraction을 확인하지 못함.", "https://www.dobong.go.kr"],
  "seoul-dongdaemun": ["WATCH", "https://www.ddm.go.kr/www/index.do", "official_government_portal", "source_core_inconsistent", "동대문구청 공식 홈페이지의 문화행사 feed에서 2026 잇다마켓·청년축제 등 title/date와 개별 detail은 확인되지만 구정소식·교육·문화행사가 혼합된 homepage feed다. 행사별 venue와 source-wide full-year durable listing/pagination을 일관되게 확인하지 못해 generic self-contained source로 확정하지 않음.", "https://www.ddm.go.kr"],
  "seoul-dongjak": ["COLLECTOR_GAP", "https://www.dongjak.go.kr/yeyak/main/main.do", "official_reservation_listing", "list_detail_core_followup_needed_js_rendered", "동작구청 공식 통합예약의 문화/행사 source는 공식 ownership과 행사 detail 체계를 확인할 수 있으나 live 목록이 예약 포털의 JS/API·필터 구조로 렌더링되어 현재 generic HTML collector가 self-contained candidate를 안정적으로 읽지 못함. 행사 detail에서 core 확인이 필요한 공통 list→detail/렌더링 gap 유형이며 구현은 하지 않음.", "https://www.dongjak.go.kr"],
  "seoul-mapo": ["COLLECTOR_GAP", "https://www.mfac.or.kr/", "official_culture_listing", "list_detail_core_followup_needed", "마포문화재단(마포구 산하 공식 문화기관) live 공연·전시 목록은 title·2026 full-year start/end·first-party detail URL을 제공하지만 목록 블록에 venue가 없고 venue는 detail follow-up에서 확인해야 함. 현재 generic collector의 self-contained extraction 조건을 만족하지 않는 기존 list→detail core gap 유형.", "https://www.mapo.go.kr"],
  "seoul-seodaemun": ["WATCH", "https://sdm.go.kr/culture/index.do", "official_culture_portal", "source_core_missing", "서대문구 공식 문화관광 포털은 벚꽃축제·어린이축제·서대문독립민주축제 등 행사 index와 개별 공지/프로그램을 제공하지만 live source-wide 목록에서 각 항목의 exact full-year start/end·venue·durable detail을 함께 유지하는 pagination listing을 확인하지 못함.", "https://www.sdm.go.kr"],
  "seoul-seocho": ["COLLECTOR_GAP", "https://www.seocho.go.kr/site/seocho/CinemaHeaven.do", "official_culture_calendar", "list_detail_core_followup_needed", "서초구 공식 문화·행사달력은 2026-09 live calendar에서 행사 title과 날짜별 항목 및 first-party detail URL을 제공하지만 calendar list에는 venue와 full-year start/end가 self-contained로 없고 detail follow-up이 필요함. 마포·송파와 동일한 list→detail core gap 유형이며 구현은 하지 않음.", "https://www.seocho.go.kr"],
  "seoul-seongdong": ["WATCH", "https://www.sd.go.kr/tour/index.do", "official_tourism_portal", "source_core_missing", "성동구 공식 문화관광 포털과 두모포 페스티벌 detail은 official ownership·venue·반복 시기를 확인할 수 있으나 대표 detail은 ‘매년 6월 말~7월 초’이고 포털 전체에서 행사별 exact full-year listing/pagination을 확인하지 못함. 연도 추론 없이 WATCH 유지.", "https://www.sd.go.kr"],
  "seoul-seongbuk": ["WATCH", "https://www.sb.go.kr/tour/index.do", "official_tourism_portal", "source_core_inconsistent", "성북구 공식 문화관광 포털의 Festival & Event 영역과 선잠제 등 detail은 행사명·장소/소개를 제공하지만 live 페이지가 static festival landing 중심이고 exact full-year start/end·durable listing/pagination을 source-wide로 확인하지 못함.", "https://www.sb.go.kr"],
  "seoul-songpa": ["COLLECTOR_GAP", "https://www.songpa.go.kr/culture/index.do", "official_culture_calendar", "list_detail_core_followup_needed", "송파구 공식 문화관광 포털은 축제/공연/전시/행사 calendar와 2026 호수벚꽃축제 등 title·full-year date·first-party detail 링크를 제공하지만 live 목록에 venue가 self-contained로 포함되지 않음. 서초·마포와 동일한 list→detail core gap 유형이며 구현은 하지 않음.", "https://www.songpa.go.kr"],
  "seoul-yangcheon": ["WATCH", "https://www.yangcheon.go.kr/", "official_government_portal", "source_core_missing", "양천구 공식 홈페이지와 평생학습 포털에서 문화 프로그램·주민 행사 안내는 확인되지만 source-wide 행사·축제의 title·exact full-year date·venue·durable detail을 함께 제공하는 지속 canonical listing/pagination을 확인하지 못함. 과거 마을자료/단발성 공지는 daily source로 사용하지 않음.", "https://www.yangcheon.go.kr"],
  "seoul-yeongdeungpo": ["ONBOARDING_READY", "https://www.ydp.go.kr/tour/selectTnTursmSchdulListU.do?key=4016", "official_tourism_listing", "generic_fallback_paginated", "영등포구 공식 문화관광 문화행사 일정 목록. live listing 구조에서 title·full-year start/end·venue가 같은 카드/목록 블록에 있고 first-party detail URL·기간/구분 검색 구조가 확인되어 current generic self-contained extraction에 적합함. 개별 detail은 기간·장소·주최를 제공하며 URL은 공식 ydp.go.kr host로 유지됨.", "https://www.ydp.go.kr"],
  "seoul-yongsan": ["COLLECTOR_GAP", "https://yongsanculture.or.kr/site/main/home", "official_culture_listing", "generic_html_card_structure_gap", "용산구 공식 출연기관 용산문화재단의 지속 갱신 문화 listing은 협력전시 PARALLAX 등에서 title·2026 full-year start/end·venue·first-party static HTTPS detail URL을 같은 slide 항목에 제공한다. 다만 live HTML은 `slide`/`txt-wr` 카드 구조라 current generic extractor가 0 candidates로 fail-closed했다. list→detail core 부족이 아니라 기존 충남·제주와 같은 generic HTML card structure gap이다.", "https://www.yongsan.go.kr"],
  "seoul-eunpyeong": ["COLLECTOR_GAP", "https://www.efac.or.kr/page03/sub01.php", "official_culture_listing", "generic_html_card_structure_gap", "은평구 산하 은평문화재단 문화사업 일정은 title·2026 full-year date·venue·주최/주관 및 first-party detail을 지속적으로 제공한다. 대표 live 항목은 제35회 전국무용제 부대행사 해외무용단 쇼케이스(2026-09-29, 은평문화예술회관 공연장)이며 목록/상세 구조가 유지된다. 현재 generic extractor read-only probe는 0 candidates여서 충남·제주·용산과 같은 generic HTML card structure gap으로 분류한다.", "https://www.ep.go.kr"],
  "seoul-jongno": ["COLLECTOR_GAP", "https://culture.jongno.go.kr/media/ko/index.do", "official_culture_listing", "generic_html_card_structure_gap", "종로문화재단의 공식 종로문화플랫폼 행사/축제 listing은 윤동주문학제 등 title·2026 full-year start/end·venue·same-host durable detail URL을 같은 항목에서 제공하고 지속 갱신된다. pagination/목록 구조도 있으나 current generic extractor read-only probe가 0 candidates여서 venue follow-up이 아닌 generic HTML card structure gap으로 분류한다.", "https://www.jongno.go.kr"],
  "seoul-jung": ["COLLECTOR_GAP", "https://www.caci.or.kr/", "official_culture_listing", "generic_html_card_structure_gap", "중구청이 설립·운영하는 중구문화재단(충무아트센터) 공식 문화 listing은 월요극장·뮤지컬·전시의 title·2026 full-year 기간·공연장/venue와 first-party product/detail URL을 지속 갱신한다. current generic extractor read-only probe는 main listing에서 0 candidates여서 list→detail core 부족이 아닌 generic HTML card structure gap으로 유지한다.", "https://www.junggu.seoul.kr"],
  "seoul-jungnang": ["COLLECTOR_GAP", "https://www.jnfac.or.kr/app/show/list", "official_culture_listing", "js_api_rendered_listing_gap", "중랑구 출연 중랑문화재단의 공식 행사 source는 중랑열린버스킹 등 title·2026 full-year date와 first-party detail을 제공하며 구 공식 e학당에서도 재단 항목을 연계한다. 그러나 직접 canonical list는 Svelte/JS rendering shell로 반환되어 current generic static HTML extractor가 candidate를 만들 수 없다. static HTTPS list→detail follow-up으로 해결되지 않는 기존 동작과 같은 JS/API rendering gap이다.", "https://www.jungnang.go.kr"],
  busan: ["COLLECTOR_GAP", "https://www.visitbusan.net/schedule/list.do?boardId=BBS_0000009&menuCd=DOM_000000204012000000&month=0", "official_tourism_listing", "list_detail_core_followup_needed", "목록에 venue가 없어 bounded detail core follow-up 필요"],
  daegu: ["WATCH", "https://tour.daegu.go.kr/index.do?menu_id=00002932&servletPath=%2Findex.do", "official_tourism_listing", "source_core_inconsistent", "연도 없는 recurring date가 섞여 있음"],
  incheon: ["ACTIVE", "https://www.incheon.go.kr/res/RE050101/", "official_event_listing", "generic_fallback_paginated", "Registry key incheon-res"],
  daejeon: ["ACTIVE", "https://daejeon.go.kr/fvu/FvuEventList.do?menuSeq=504", "official_event_listing", "generic_fallback", "Registry key daejeon-fvu"],
  ulsan: ["WATCH", "https://tour.ulsan.go.kr/tour/korean/unit/fstvl/list.ulsan?mId=001003001000000000&searchDvsn1=1", "official_tourism_listing", "source_core_inconsistent", "source-wide full-year exact core 부족"],
  sejong: ["COLLECTOR_GAP", "https://www.sjcf.or.kr/hangeul/www/prfr/list.do?key=2504150023", "official_culture_listing", "list_detail_core_followup_needed", "목록 venue 부재"],
  gyeonggi: ["WATCH", "https://ggtour.or.kr/main", "official_tourism_portal", "source_core_inconsistent", "경기관광 메인에서 행사·축제 보도와 콘텐츠는 확인되지만, 광역 단위로 title·full-year date·venue가 함께 유지되는 canonical bounded listing을 확인하지 못함. 보도자료를 daily source로 승격하지 않음"],
  gangwon: ["WATCH", "https://m.gangwon.to/gwtour/now/festival", "official_tourism_listing", "source_fetch_unavailable", "live HTTP probe가 repeated timeout으로 source document를 안정적으로 읽지 못함. generic extraction·pagination·candidate contract를 확인할 수 있을 때까지 ACTIVE 승격 금지"],
  chungbuk: ["COLLECTOR_GAP", "https://tour.chungbuk.go.kr/www/selectBbsNttList.do?bbsNo=10&key=80", "official_tourism_listing", "list_detail_core_followup_needed", "충북나드리 연간축제일정에서 공식 축제 목록과 날짜는 확인되나 카드/표 변형과 일부 월·일 표기 혼재로 generic collector의 안정적 self-contained extraction을 추가 검증해야 함"],
  chungnam: ["COLLECTOR_GAP", "https://tour.chungnam.go.kr/prog/fstvl/kor/sub02_02_02/list.do", "official_tourism_listing", "generic_html_card_structure_gap", "pageIndex=1..3 official 목록은 HTTP 200, full-year date·venue·detail 구조와 pagination을 제공하지만 현재 generic extractor는 카드 HTML에서 0 candidates로 fail-closed됨"],
  jeonbuk: ["COLLECTOR_GAP", "https://tour.jb.go.kr/index.do", "official_tourism_listing", "list_detail_core_followup_needed", "투어전북의 현재 행사 목록과 full-year 기간은 확인되지만 대표 목록 카드에서 venue self-contained 여부가 일관되지 않아 list-detail follow-up이 필요함"],
  gyeongbuk: ["WATCH", "https://www.gb.go.kr/Main/programs/announce/announce.do?A_CYCLE=&A_ITEM=&A_LIST=&A_TIME=&DEPT_BUSEO=&LCODE=10&MCODE=&SCODE=&mnu_uid=0&pageNo=3&strkey=&word=", "official_government_data_catalog", "source_core_missing", "경북도 행정정보공표 목록에 시군구별 지역축제·행사 데이터 항목은 있으나 현재 public bounded listing과 candidate-level durable URL을 확인하지 못함"],
  gyeongnam: ["WATCH", "https://tour.gyeongnam.go.kr/index.gyeong", "official_tourism_portal", "source_core_missing", "경남관광 공식 포털은 확인했으나 광역 행사·축제의 full-year date·venue를 함께 제공하는 지속적 canonical listing을 확인하지 못함"],
  jeju: ["COLLECTOR_GAP", "https://www.visitjeju.net/kr/festival", "official_tourism_listing", "generic_html_card_structure_gap", "Visit Jeju canonical festival/list endpoint는 HTTP 200과 first-party detail structure를 제공하지만 현재 generic extractor는 0 candidates. list card extraction 지원 전 ACTIVE 승격 금지"],
  "gyeonggi-paju": ["ACTIVE", "https://tour.paju.go.kr/user/link/cultural/BD_index.do", "official_event_listing", "registered_parser", "Registry key paju"],
  "gyeonggi-suwon": ["ACTIVE", "https://www.swcf.or.kr/?p=29", "official_event_listing", "registered_parser", "Registry key suwon"],
  "gyeonggi-goyang": ["ACTIVE", "https://goyang.go.kr/visitgoyang/www/contents.do?key=595&searchCtgry=1674023925303", "official_event_listing", "registered_parser", "Registry key goyang"],
  "gyeonggi-hwaseong": ["ACTIVE", "https://tour.hscity.go.kr/NEW/6festival/festival5.jsp", "official_event_listing", "registered_parser", "Registry key hwaseong"],
  "gyeonggi-bucheon": ["ACTIVE", "https://www.bucheon.go.kr/site/homepage/menu/viewMenu?menuid=145007003", "official_event_listing", "registered_parser", "Registry key bucheon"],
  "gangwon-taebaek": ["ACTIVE", "https://www.taebaek.go.kr/www/selectWebScheduleUserList.do?key=1502", "official_event_listing", "generic_fallback", "Registry key taebaek"],
};

const roman = {
  "서울특별시":"seoul","부산광역시":"busan","대구광역시":"daegu","인천광역시":"incheon","전남광주통합특별시":"jeonnam-gwangju","대전광역시":"daejeon","울산광역시":"ulsan","세종특별자치시":"sejong","경기도":"gyeonggi","강원특별자치도":"gangwon","충청북도":"chungbuk","충청남도":"chungnam","전북특별자치도":"jeonbuk","경상북도":"gyeongbuk","경상남도":"gyeongnam","제주특별자치도":"jeju",
  "파주시":"paju","수원시":"suwon","고양시":"goyang","화성시":"hwaseong","부천시":"bucheon","태백시":"taebaek",
  "종로구":"jongno","중구":"jung","용산구":"yongsan","성동구":"seongdong","광진구":"gwangjin","동대문구":"dongdaemun","중랑구":"jungnang","성북구":"seongbuk","강북구":"gangbuk","도봉구":"dobong","노원구":"nowon","은평구":"eunpyeong","서대문구":"seodaemun","마포구":"mapo","양천구":"yangcheon","강서구":"gangseo","구로구":"guro","금천구":"geumcheon","영등포구":"yeongdeungpo","동작구":"dongjak","관악구":"gwanak","서초구":"seocho","강남구":"gangnam","송파구":"songpa","강동구":"gangdong",
};
const slug = (name) => roman[name] ?? name.replace(/시$|군$|구$/u, "").replace(/\s/g, "").toLowerCase();
const level = (name, parent) => parent === "jeju" ? "administrative_city" : name.endsWith("군") ? "county" : name.endsWith("구") ? "district" : "city";
const queueBucket = (entry) => {
  if (entry.government_level !== "metro" && entry.government_level !== "province" && entry.government_level !== "special_city" && entry.government_level !== "metropolitan_city" && entry.government_level !== "special_self_governing_city" && entry.government_level !== "special_self_governing_province") return [entry.region_key === "seoul" || entry.region_key === "gyeonggi" || entry.region_key === "incheon" ? 1 : 3, entry.region_order, entry.locality];
  return [0, entry.region_order, entry.locality];
};

export function buildInventory() {
  const entries = [];
  metros.forEach(([regionKey, region, governmentLevel, homepage], regionOrder) => {
    const metroKnown = known[regionKey];
    entries.push({
      key: regionKey, region_key: regionKey, region, locality: region, government_level: governmentLevel,
      official_homepage: homepage, source_status: metroKnown?.[0] ?? "UNREVIEWED", source_url: metroKnown?.[1] ?? null,
      source_type: metroKnown?.[2] ?? null, collector_fit: metroKnown?.[3] ?? "unreviewed", notes: metroKnown?.[4] ?? "광역단체 자체 행사 source 미조사", checked_at: checkedAt, region_order: regionOrder,
    });
    for (const locality of (divisions[regionKey] ?? "").split(",").filter(Boolean)) {
      const key = `${regionKey}-${slug(locality)}`;
      const itemKnown = known[key];
      entries.push({
        key, region_key: regionKey, region, locality, government_level: level(locality, regionKey), official_homepage: itemKnown?.[5] ?? null,
        source_status: itemKnown?.[0] ?? "UNREVIEWED", source_url: itemKnown?.[1] ?? null,
        source_type: itemKnown?.[2] ?? null, collector_fit: itemKnown?.[3] ?? "unreviewed", notes: itemKnown?.[4] ?? "공식 행사 source 미조사", checked_at: checkedAt, region_order: regionOrder,
      });
    }
  });
  const queue = entries.filter((entry) => entry.source_status === "UNREVIEWED").sort((a, b) => {
    const left = queueBucket(a), right = queueBucket(b);
    return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2], "ko");
  }).map((entry, index) => ({ rank: index + 1, municipality_key: entry.key }));
  const summary = Object.fromEntries([...statuses].map((status) => [status, entries.filter((entry) => entry.source_status === status).length]));
  return { schema_version: 1, authority, generated_at: checkedAt, municipalities: entries, survey_queue: queue, summary };
}

export function validate(inventory) {
  const keys = new Set();
  for (const item of inventory.municipalities) {
    if (keys.has(item.key)) throw new Error(`duplicate municipality key: ${item.key}`);
    keys.add(item.key);
    if (!statuses.has(item.source_status)) throw new Error(`invalid status: ${item.key}`);
    for (const field of ["region", "locality", "government_level", "official_homepage", "source_status", "source_url", "source_type", "collector_fit", "notes", "checked_at"])
      if (!(field in item)) throw new Error(`missing required field ${field}: ${item.key}`);
    if (!item.region || !item.locality || !item.government_level || !item.checked_at) throw new Error(`empty required field: ${item.key}`);
    if (item.key !== item.region_key) {
      if (!keys.has(item.region_key)) throw new Error(`parent region must precede child: ${item.key}`);
      const parent = inventory.municipalities.find((candidate) => candidate.key === item.region_key);
      if (!parent || parent.region !== item.region || parent.locality !== item.region) throw new Error(`invalid parent relation: ${item.key}`);
    }
  }
  const regionRoots = inventory.municipalities.filter((item) => item.key === item.region_key);
  if (regionRoots.some((item) => ["gwangju", "jeonnam"].includes(item.key) || ["광주광역시", "전라남도"].includes(item.locality))) throw new Error("abolished regional root remains");
  const integratedRoot = inventory.municipalities.find((item) => item.key === "jeonnam-gwangju");
  if (!integratedRoot) throw new Error("integrated city root is missing");
  if (inventory.municipalities.filter((item) => item.region_key === "jeonnam-gwangju" && item.key !== "jeonnam-gwangju").length !== 27) throw new Error("integrated city must have exactly 27 children");
  if (inventory.municipalities.filter((item) => item.region_key === "incheon" && item.key !== "incheon").length !== 11) throw new Error("Incheon must have exactly 11 children");
  if (regionRoots.length !== 16) throw new Error(`expected 16 current provincial-level roots, got ${regionRoots.length}`);
  const actual = Object.fromEntries([...statuses].map((status) => [status, inventory.municipalities.filter((item) => item.source_status === status).length]));
  if (JSON.stringify(actual) !== JSON.stringify(inventory.summary)) throw new Error("summary mismatch");
  if (inventory.survey_queue.length !== actual.UNREVIEWED) throw new Error("queue count mismatch");
  if (new Set(inventory.survey_queue.map((item) => item.municipality_key)).size !== inventory.survey_queue.length) throw new Error("queue duplicate");
  if (new Set(inventory.survey_queue.map((item) => item.municipality_key)).size !== inventory.municipalities.filter((item) => item.source_status === "UNREVIEWED").length) throw new Error("queue does not cover all unreviewed units");
  if (!inventory.survey_queue.every((item, index) => item.rank === index + 1 && inventory.municipalities.find((candidate) => candidate.key === item.municipality_key)?.source_status === "UNREVIEWED")) throw new Error("queue ordering mismatch");
  for (const [key, [status, sourceUrl]] of Object.entries(known)) {
    const item = inventory.municipalities.find((candidate) => candidate.key === key);
    if (!item || item.source_status !== status || item.source_url !== sourceUrl) throw new Error(`known source mismatch: ${key}`);
  }
}

const inventory = buildInventory();
validate(inventory);
const json = `${JSON.stringify(inventory, null, 2)}\n`;
const markdown = `# Municipal Source Master Inventory\n\nGenerated from \`docs/municipal-source-inventory.json\`; do not hand-edit counts.\n\n- Administrative-boundary authority: ${authority.administrative_boundary_source}\n- Current monthly baseline: ${authority.current_baseline_source}\n- Legal/current-change cross-checks: ${authority.legal_basis_sources.join(" · ")}\n- Baseline as of: ${authority.baseline_as_of}\n- Baseline note: ${authority.baseline_note}\n- Cross-check: ${authority.cross_check_source}\n- Checked: ${checkedAt}\n- Total research units: ${inventory.municipalities.length}\n\n| Status | Count |\n| --- | ---: |\n${Object.entries(inventory.summary).map(([status, count]) => `| ${status} | ${count} |`).join("\n")}\n\n## Deterministic survey queue\n\nOrder: unreviewed 광역단체 → 수도권 하위단체 → 광역시/특별자치 하위단체 → 도 단위 시·군. A source is classified without asking a user: immediately viable sources become \`ONBOARDING_READY\`; common collector deficiencies become \`COLLECTOR_GAP\`; source-side deficiencies become \`WATCH\`; unsuitable sources become \`EXCLUDE\`. When 3–5 \`ONBOARDING_READY\` sources accumulate, schedule Phase 6E batch onboarding. Source self-healing remains the later common fail-closed capability.\n\nFirst 20 queue entries: ${inventory.survey_queue.slice(0, 20).map(({ rank, municipality_key }) => `${rank}. \`${municipality_key}\``).join(" · ")}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync("docs/municipal-source-inventory.json", "utf8") !== json) throw new Error("inventory JSON is not generated from the canonical catalog");
  if (readFileSync("docs/municipal-source-inventory.md", "utf8") !== markdown) throw new Error("inventory summary is stale");
  console.log(JSON.stringify({ total: inventory.municipalities.length, summary: inventory.summary, queue_first: inventory.survey_queue.slice(0, 10) }));
} else {
  writeFileSync("docs/municipal-source-inventory.json", json);
  writeFileSync("docs/municipal-source-inventory.md", markdown);
}
