/**
 * fx.mjs — 환율/표시값 단일 출처 (스크립트 측).
 *
 * ⚠️ ticker.html 의 CONFIG.fx 와 값이 **항상 일치**해야 함(렌더 표시 ↔ 캡션/수집 정합).
 *    환율을 바꿀 땐 두 곳을 함께 갱신할 것. (렌더는 인라인 CONFIG, 스크립트는 여기서 import)
 */
export const FX = {
  date: "2026-06-16", // 환율 기준일 (캡션·표시에 노출)
  krwPerUsd: 1500,    // JD 표준 환율
  vndPerUsd: 25400,   // 추정
};

/** krw → usd (반올림 X, 정수 달러로 표시할 땐 호출부에서 Math.round) */
export const krwToUsd = (krw) => krw / FX.krwPerUsd;
/** usd → vnd */
export const usdToVnd = (usd) => usd * FX.vndPerUsd;
