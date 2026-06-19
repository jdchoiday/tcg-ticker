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
 * ⚠️ 키 발급 후 확정 필요(TODO): (1) BASE_URL/엔드포인트/쿼리 파라미터,
 *    (2) 응답에서 카드 1건을 고르는 경로, (3) 등급가 키 구조(ebay.psa10.avg 등).
 *    아래는 조사 스키마 기반 best-effort 이며 fixtures 와 동일 가정.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ticker.html CONFIG.fx.krwPerUsd 와 동일하게 유지할 것 (표시 정합)
const KRW_PER_USD = 1500;
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

/* ---- grade 문자열 → 등급가 키. "PSA 10"→psa10, "BGS 9.5"→bgs95 ---- */
const gradeKey = (g) => g.toLowerCase().replace(/[^a-z0-9]/g, "");

/* ---- 카드 응답에서 등급가(USD) 추출. 없으면 market 폴백 ---- */
function pickGradedUsd(card, grade) {
  const key = gradeKey(grade);
  const pools = [card.ebay, card.graded, card.prices?.graded].filter(Boolean);
  for (const pool of pools) {
    const g = pool[key];
    if (g != null) {
      const v = typeof g === "number" ? g : (g.avg ?? g.market ?? g.price ?? g.median);
      if (typeof v === "number") return { usd: v, source: `${key}` };
    }
  }
  const m = card.prices?.market ?? card.market ?? card.prices?.mid;
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

/* ---- 실 API: query 로 카드 1건 ---- */
async function fetchCard(query, lang, key) {
  const url = `${BASE_URL}/cards?search=${encodeURIComponent(query)}&language=${lang}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${query})`);
  const data = await res.json();
  // TODO: 키 후 실응답으로 경로 확정
  return data.data?.[0] ?? data.cards?.[0] ?? data.results?.[0] ?? (Array.isArray(data) ? data[0] : null);
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
      card = MOCK ? await getMock(it.query) : await fetchCard(it.query, it.lang, key);
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
  log(`✓ ${out.length}장 → data/cards.json (1위 ${out[0].nameEn} $${rows[0]._usd})`);
  log("  다음: npm run validate && npm run capture");
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
