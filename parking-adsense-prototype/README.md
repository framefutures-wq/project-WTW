# 주차비교 Codespace 프로토타입

`parking-adsense-prototype` 브랜치의 이 폴더는 기존 축제 프로젝트와 분리해 만든 1차 프로토타입입니다.

## Codespace 실행

```bash
cd parking-adsense-prototype
npm install
npm run dev
```

Wrangler가 표시하는 Preview/Forwarded Port 주소에서 확인합니다.

## 현재 포함

- 메인 / 장소 검색
- 서울역·종로·잠실·킨텍스 비교 페이지
- 1시간 / 3시간 / 6시간 예상요금 계산
- 서비스 소개 / 데이터 정책 / 개인정보처리방침 / 문의
- robots.txt / sitemap.xml / ads.txt
- 모바일 반응형
- 검색결과 noindex

## 매우 중요

현재 주차장 이름·주소·요금은 **UI 검증용 예시 데이터**입니다. 실제 서비스로 공개하거나 AdSense를 신청하기 전에 공공데이터포털의 공식 주차장 데이터로 교체해야 합니다.

다음 단계는 Cloudflare D1 + 공공데이터 API를 연결하고, 검수된 장소 페이지만 색인시키는 구조로 확장하는 것입니다.
