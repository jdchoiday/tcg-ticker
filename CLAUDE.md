# TCG Graded Price Ticker — CLAUDE.md
포켓몬 카드 등급·시세 티커 / 자동화 콘텐츠 프로젝트

> 이 파일은 세션마다 자동으로 읽힘. 핸드오버 원문 + 현재 빌드 상태.

---

## ⚙️ BUILD STATUS  `[updated 2026-06-19]`

> ⚠️ 원격(웹) 세션 제약: chromium 다운로드 호스트가 egress allowlist 밖이라 **이 환경에선 영상 실렌더 불가**. 영상화는 로컬 또는 GitHub Actions(`.github/workflows/daily.yml`)/Railway 에서 돈다.

| Phase | 내용 | 상태 |
|---|---|---|
| 렌더 엔진 | `src/ticker.html` — 무한 스크롤, 등급/USD/VND/순위, 9:16 | ✅ |
| **Phase 0** | 데이터/뷰 분리: `fetch('../data/cards.json')` + DEMO 폴백 | ✅ |
| Phase 0 | `data/cards.schema.json` + `scripts/validate.mjs` (무의존 validator) | ✅ |
| **Phase 1** | 수동 18장 `data/cards.json` + `caption.txt` 템플릿 | ✅ |
| **Phase 2** | `scripts/capture.mjs` — Playwright 녹화 → ffmpeg → `out/ticker.mp4` | ✅ |
| **Phase 3** | 수집기 `scripts/collect.mjs` (PokemonPriceTracker) + `watchlist.json` | 🟢 OpenAPI v2 명세로 매핑 확정(엔드포인트/파라미터/`ebay.salesByGrade.psa10`). 키만 꽂으면 실데이터. 명세: `docs/ppt-openapi-v2.json` |
| **Phase 4** | 오케스트레이터 `pipeline.mjs` + 캡션렌더 `caption.mjs` + 발행 스캐폴드 `publish.mjs` + 스케줄러 `.github/workflows/daily.yml` | 🟡 파이프라인/캡션/스케줄 동작. 발행은 dry-run까지(Buffer 토큰 발급 후 실전송 가드 해제 필요) |

### 데이터 소스 = PokemonPriceTracker (확정)
조사·정밀검증 완료. **유일하게 약관(§6)이 "콘텐츠에 가격 표시"를 명시 허용**(출처표기 의무 없음), 무료 티어부터 PSA 등급가 제공, EN/JP 지원(**KR 미지원**). 카드 이미지는 포켓몬사 IP → **가격 텍스트 + 자체 스타일카드만**. 상세: 메모리 `project_tcg_data_source_research`.

### 실행 / Commands
```bash
npm install                         # playwright 설치
npx playwright install chromium     # 브라우저 1회 설치
npm run collect:mock                # 키 없이 fixtures → cards.json (변환 검증)
npm run collect                     # 실 API (.env 의 PPT_API_KEY 필요)
npm run validate                    # cards.json 스키마 검증
npm run serve                       # http://localhost:4173 미리보기
npm run capture                     # out/ticker.mp4 생성 (한 루프 = CONFIG.loopSeconds)
CAPTURE_SECONDS=6 npm run capture   # 짧은 테스트 클립
npm run caption                     # caption.txt → out/caption.txt (placeholder 치환)
npm run publish                     # 발행 dry-run (토큰+--confirm 없으면 전송 안 함)
npm run pipeline                    # collect→validate→capture→caption 한 번에 (실 API)
npm run pipeline:mock               # 위를 fixtures 로 (키 불필요)
node scripts/pipeline.mjs --mock --no-video --publish  # chromium 없는 환경 검증용
```

### Phase 4 발행(Buffer) 토큰 발급 후 할 일 (publish.mjs 의 TODO)
1. `.env` 에 `BUFFER_ACCESS_TOKEN`, `BUFFER_PROFILE_IDS`(쉼표구분) 입력
2. Buffer 영상 발행 멀티스텝(미디어 업로드 → updates/create) 실응답으로 확정 → `postToBuffer()` 스텁 교체
3. GitHub Actions 시크릿(`PPT_API_KEY`/`BUFFER_*`) 등록 후 `daily.yml` cron 시각 조정

### Phase 3 키 발급 후 할 일 (매핑은 명세로 확정됨 — 남은 건 키 + 정밀화)
1. `PPT_API_KEY` 를 GitHub Secrets(또는 `.env`)에 입력 (https://www.pokemonpricetracker.com 무료 가입)
2. `npm run collect` 1회 실행 → 18장 실응답 확인 (매핑/등급가 경로는 이미 명세대로 구현됨)
3. 첫 실응답에서 각 카드의 **tcgPlayerId** 를 받아 `watchlist.json` 에 넣으면 검색 모호성 제거 + 결정적·저비용(단건 1크레딧). collect.mjs 가 tcgPlayerId 있으면 우선 사용.
4. 9.5 등급 등 `salesByGrade` 키 표기(`bgs9_5` 가정)는 실응답으로 1회 확인

---

## 0. 한 줄 정의
매일 "등급 카드 시세 랭킹" 세로(9:16) 영상을 자동 양산해 TikTok에 올리는 콘텐츠 파이프라인.

## 2. 디자인 시스템 (요약)
- **캔버스 1080×1920 고정**, `#stage` 를 `translate(-50%,-50%) scale(min(vw/1080, vh/1920))` 로 맞춤. **스케일 방식 변경 금지.**
- 컬러 토큰(`:root`): `--void/--void2/--holo-a(#6EE7F0)/--holo-b(#C77DFF)/--gold(#F5C84B)/--ink/--muted/--vnd(#7DE3B0)`. 속성색은 `TYPE{}`.
- 타이포: Space Grotesk(UI) / Space Mono(숫자) / Pretendard(한글). 가격(USD)이 카드당 최대 활자.
- 모션: `#track` 2회 복제 → `@keyframes scroll`(translateX -50%, linear infinite, dur=loopSeconds); 카드 sheen 왕복; `#rail:hover` 일시정지; `prefers-reduced-motion` 존중.

## 3. 데이터 계약 (핵심)
수집기는 `data/cards.schema.json` 스키마의 배열(JSON)만 뱉으면 됨. 렌더는 손대지 않음.
필드: `rank, nameKo, nameEn, set, rarity, type, lang, grade, pop?, krw, img?`.
환산: `usd = krw / fx.krwPerUsd`, `vnd = usd * fx.vndPerUsd`. **통화 항상 USD+VND 병기.**
`CONFIG`(ticker.html 상단): brandName/markText/backWord/subtitle/handle/tagline/loopSeconds/dataUrl/fx{date,krwPerUsd,vndPerUsd}.

## 4. 목표 아키텍처
`[수집]가격소스→cards.json  [렌더]ticker.html  [영상화]Playwright→mp4  [발행]Buffer→TikTok` (+ Supabase 시세 이력, Railway cron). 스택은 기존 JD 스택과 정합.

## 6. 가드레일 — 반드시 준수
1. 공식 포켓몬 아트·로고 **대량 스크래핑/재배포 금지.** `img`는 자가촬영 또는 권리정리 소스만.
2. The Pokémon Company 로고/"공식" 룩 금지. "시세/마켓 인덱스" 성격 유지.
3. 가격 소스 robots.txt·ToS 준수. 공식 API 우선.
4. "Pokémon"은 카테고리 식별(지명적 사용)만.
5. 본 가이드는 법률 자문 아님. KR/VN 저작권·상표 검토 필요(특히 수익화 시).

## 7. 파일 구조
```
CLAUDE.md            이 문서
src/ticker.html      렌더 엔진
data/cards.json      데이터
data/cards.schema.json
scripts/validate.mjs   스키마 검증 (무의존)
scripts/serve.mjs      정적 서버 (미리보기 + capture 용)
scripts/capture.mjs    Phase 2: mp4 녹화
scripts/collect.mjs    Phase 3 (미착수)
out/                 mp4 산출물 (gitignore)
.env                 BUFFER_TOKEN, SUPABASE_URL 등 (커밋 금지)
```

## 8. 결정 현황  `[updated 2026-06-19]`
1. **가격 데이터 소스** → ✅ PokemonPriceTracker (무료 100c/day, PSA 등급가, 약관상 가격표시 허용). 백업 후보 PokeTrace.
2. **타깃 언어** → ✅ EN (영어). 캡션/해시태그 영어. (시장 세부는 추후)
3. **브랜드명·채널 핸들** → 🟡 추후공지. `CONFIG.brandName="TCG INDEX"`, `handle="@your_handle"` placeholder 유지.
4. **카드 이미지 소스** → 🔴 실제 사진 ON(`watchlist.cardImages:true`, API `imageCdnUrl`). JD 리스크 감수 결정. ⚠️ 포켓몬/TCGPlayer IP — 수익화 시 저작권/ToS 본인 책임(§6과 상충, 의식적 선택). 권리정리 이미지는 카드별 `img`로 우선 적용 가능.
5. **콘텐츠 방향** → ✅ 최고등급(PSA 10)·**가격 높은 카드 중심**(빈티지 그레일 + 프리미엄 모던 alt-art). `data/watchlist.json` 스타터 리스트(Illustrator·1st Ed Charizard·Gold Star·Moonbreon 등). USD/VND 포맷 M/B/T 약어 지원.

### 남은 액션(외부 계정 — JD 직접):
- PPT 가입 → `PPT_API_KEY` 발급 → GitHub Secrets 등록
- Buffer 가입 + TikTok 연결 → `BUFFER_ACCESS_TOKEN`/`BUFFER_PROFILE_IDS` → GitHub Secrets
- 채널명/핸들 확정 시 `CONFIG.brandName`/`handle` 교체

`[판단: Phase 0~4 골격 완료 + 영어 화제카드 워치리스트 구성. 다음 트리거 = PPT 키 → 실응답 매핑 확정(Phase 3) → Buffer 토큰 → 실발행(Phase 4)]`
