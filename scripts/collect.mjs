#!/usr/bin/env node
/**
 * collect.mjs — Phase 3: PokemonPriceTracker → data/cards.json
 *
 * 흐름: watchlist.json 의 각 카드를 query 로 조회 → grade 의 등급가(USD) 추출
 *      → KRW 환산 → 시세 내림차순 정렬 → rank 부여 → topN 자르기 → cards.json 저장.
 * 렌더(ticker.html)는 손대지 않는다. cards.schema.json 계약만 만족시키면 됨.
 *
 * 사용:
 *   node scripts/collect.mjs --mock      # 키 없이 fixtures 로 변환 검증
 *   node scripts/collect.mjs             # 실 API (PPT_API_KEY 필요, .env 또는 env)
 *
 * 키 발급(무료): https://www.pokemonpricetracker.com → 가입 → API 키 → .env 에 PPT_API_KEY=...
 *
 * ✅ 매핑은 PPT OpenAPI v2 명세로 확정됨:
 *    - GET /api/v2/cards?search=&language=english|japanese&limit=1&includeEbay=true
 *    - 등급가: data.ebay.salesByGrade.<psa10|psa9|bgs9_5...>.smartMarketPrice.price (또는 averagePrice)
 *    - 단건 정확도↑: watchlist 항목에 tcgPlayerId 넣으면 그걸로 단건 조회(검색 모호성 제거 + 1크레딧).
 *    - 과금은 limit 기준(기본 50!). 단건은 반드시 limit=1.
 *    첫 실 응답 1건 받으면 search→tcgPlayerId 로 고정 추천(결정적·저비용).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { FX } from "./lib/fx.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// 환율 단일 출처: scripts/lib/fx.mjs (ticker.html CONFIG.fx 와 일치 유지)
const KRW_PER_USD = FX.krwPerUsd;
const BASE_URL = process.env.PPT_BASE_URL || "https://www.pokemonpricetracker.com/api/v2"; // TODO 키 후 확정

const MOCK = process.argv.includes("--mock");
const log = (...a) => console.log("•", ...a);
const warn = (...a) => console.warn("⚠", ...a);

/* ---- .env 무의존 로더 ---- */
async function loadEnv() {
  try {
    const txt = await readFile(resolve(ROOT, ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env 없으면 무시 */ }
}

/* ---- grade 문자열 → salesByGrade 키. "PSA 10"→psa10, "PSA 9"→psa9, "BGS 9.5"→bgs9_5 ---- */
const gradeKey = (g) => g.toLowerCase().replace(/\s+/g, "").replace(/\./g, "_");

/* ---- watchlist lang → PPT language 파라미터 (PPT 는 KR 미지원 → english 폴백) ---- */
const LANG_API = { EN: "english", JP: "japanese", KR: "english" };

/* ---- 카드 응답에서 등급가(USD) 추출. PPT v2: data.ebay.salesByGrade.<key>. 없으면 market 폴백 ---- */
function pickGradedUsd(card, grade) {
  const key = gradeKey(grade);
  const g = card.ebay?.salesByGrade?.[key];
  if (g) {
    // smartMarketPrice(추천) > averagePrice > medianPrice > 7일가
    const v = g.smartMarketPrice?.price ?? g.averagePrice ?? g.medianPrice ?? g.marketPrice7Day;
    if (typeof v === "number") return { usd: v, source: `ebay.${key}` };
  }
  const m = card.prices?.market;
  if (typeof m === "number") return { usd: m, source: "market(fallback)" };
  return null;
}

/* ---- mock: fixtures 에서 query 매칭 ---- */
let MOCK_CARDS = null;
async function getMock(query) {
  if (!MOCK_CARDS) {
    const f = JSON.parse(await readFile(resolve(__dirname, "fixtures/ppt_sample.json"), "utf8"));
    MOCK_CARDS = f.cards;
  }
  const q = query.toLowerCase();
  return MOCK_CARDS.find((c) => c.query.toLowerCase() === q) ?? null;
}

/* ---- 실 API: 카드 1건. tcgPlayerId 있으면 정확 단건, 없으면 search 최상위 1건 ----
 *  과금: limit 기준이라 단건은 limit=1 (1크레딧 + includeEbay 1크레딧 = 2). 기본 50 쓰면 50크레딧! */
let LAST_REMAINING = null;
async function fetchCard(it, key) {
  const base = `${BASE_URL}/cards`;
  const url = it.tcgPlayerId
    ? `${base}?tcgPlayerId=${encodeURIComponent(it.tcgPlayerId)}&includeEbay=true`
    : `${base}?search=${encodeURIComponent(it.query)}&language=${LANG_API[it.lang] || "english"}` +
      `&limit=1&includeEbay=true&sortBy=price&sortOrder=desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${it.query})`);
  const rem = res.headers.get("x-ratelimit-daily-remaining");
  if (rem != null) LAST_REMAINING = rem;
  const json = await res.json();
  const d = json.data;            // 단건이면 객체, 검색이면 배열
  return Array.isArray(d) ? (d[0] ?? null) : (d ?? null);
}

async function main() {
  await loadEnv();
  const key = process.env.PPT_API_KEY;
  if (!MOCK && !key) {
    console.error("✗ PPT_API_KEY 없음. .env 에 키를 넣거나, 키 없이 검증하려면: node scripts/collect.mjs --mock");
    process.exit(1);
  }
  log(MOCK ? "MOCK 모드 (fixtures)" : `실 API: ${BASE_URL}`);

  const wl = JSON.parse(await readFile(resolve(ROOT, "data/watchlist.json"), "utf8"));
  const topN = wl.topN ?? wl.cards.length;

  const rows = [];
  for (const it of wl.cards) {
    let card;
    try {
      card = MOCK ? await getMock(it.query) : await fetchCard(it, key);
    } catch (e) {
      warn(`조회 실패: ${it.query} — ${e.message}`); continue;
    }
    if (!card) { warn(`결과 없음: ${it.query}`); continue; }

    const got = pickGradedUsd(card, it.grade);
    if (!got) { warn(`시세 없음: ${it.query} (${it.grade})`); continue; }

    const krw = Math.round(got.usd * KRW_PER_USD);
    rows.push({
      nameKo: it.nameKo, nameEn: it.nameEn, set: it.set, rarity: it.rarity,
      type: it.type, lang: it.lang, grade: it.grade,
      ...(it.pop ? { pop: it.pop } : {}),
      krw, img: null,
      _usd: got.usd, _src: got.source,
    });
  }

  if (!rows.length) { console.error("✗ 수집된 카드가 0개입니다."); process.exit(1); }

  rows.sort((a, b) => b._usd - a._usd);
  const out = rows.slice(0, topN).map((r, i) => {
    const { _usd, _src, ...card } = r;
    return { rank: i + 1, ...card };
  });

  await writeFile(resolve(ROOT, "data/cards.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  log(`✓ ${out.length}장 → data/cards.json (1위 ${out[0].nameKo} $${rows[0]._usd})`);
  if (!MOCK && LAST_REMAINING != null) log(`  남은 크레딧(일일): ${LAST_REMAINING}`);
  log("  다음: npm run validate && npm run capture");
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
