Cloudflare Pages D1 공유 저장

필수 설정
- D1 database: lemon-cozybook-db
- Pages D1 binding name: DB
- functions/api/guild-state.js 를 프로젝트 루트의 functions/api/ 아래에 유지

이 테스트본은 기존 guild_state 테이블의 state_json 안에 아래 필드를 함께 저장합니다.
- members
- checks
- customFlowers
- updateList

기존 v9 D1 데이터(members/checks)는 자동으로 유지됩니다.
기존 브라우저 localStorage에만 있던 customFlowers/updateList는 서버에 해당 필드가 아직 없을 때 최초 1회 자동 이관됩니다.

배포 후 권장 테스트
1) 기존 신규 꽃 데이터가 있는 크롬에서 메인페이지 또는 page2를 먼저 엽니다.
2) 다른 크롬에서 page2/page5를 열어 신규 꽃이 보이는지 확인합니다.
3) 한 브라우저에서 신규 꽃 추가/수정/삭제 후 다른 브라우저에서 약 3초 내 반영되는지 확인합니다.
4) page2에서 꽃 체크/해제 후 다른 브라우저의 닉네임 (체크수)가 함께 바뀌는지 확인합니다.
