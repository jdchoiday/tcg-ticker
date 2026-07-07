#!/usr/bin/env node
/**
 * gen-weekly-watchlists.mjs — 요일별 테마 워치리스트 7종 생성(1회성 빌더).
 *
 * 확정 라인업(요일=KST 게시일, 1위 카드가 요일마다 다르도록 설계):
 *   월 🇯🇵 일판 PSA10 TOP        (ピカチュウ 프로모 제외 → 토요일 리드로 예약)
 *   화 🇺🇸 영문판 PSA10 TOP      (리드: Gold Star/Base Charizard)
 *   수 📈 주간 급등/급락 Movers   (mode:movers — history 변동폭순, 동적 리드)
 *   목 💎 등급 프리미엄 PSA10vs9  (mode:gradePremium — 같은 응답의 psa9 사용, 추가 크레딧 0)
 *   금 🆕 모던 TOP(2020+)        (리드: Moonbreon)
 *   토 ⚡ 피카츄·이브이 데이      (리드: ピカチュウ 프로모)
 *   일 ⚖️ JP vs EN 가격차        (mode:jpVsEn — 같은 카드 일판/영판 비교, 동적 리드)
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (f) => JSON.parse(await readFile(join(ROOT, "data", f), "utf8"));
const en = (await load("watchlist.en.json")).cards;   // 0:BaseZard 1:Rainbow 2:GS Zard 3:GS Ray 4:GS Umbreon 5:GS Espeon
                                                      // 6-9:1stEd 10:Moonbreon 11:RayAlt 12:GiratinaAlt 13:MewAlt 14:LugiaAlt
                                                      // 15:GlaceonAlt 16:LeafeonAlt 17:Zard ex SIR
const jp = (await load("watchlist.jp.json")).cards;   // 0:ブラッキー 1:リザードンex SAR 2:レックウザ 3-9:イーブイズ SA
                                                      // 10:ルギア 11:ギラティナ 12:ミュウ 13:リザードンV 14:ミュウツー
                                                      // 15:ナンジャモ 16:ミライドン 17:ピカチュウ促
const pick = (arr, idx) => idx.map((i) => arr[i]);

// 일요일 JP vs EN 짝: JP 카드(메인) + 같은 카드 영문판 조회 정보
const pair = (jpCard, enQuery) => ({ ...jpCard, en: { query: enQuery } });
const sunPairs = [
  pair(jp[0],  en[10].query), // ブラッキーVMAX SA  vs Moonbreon EN
  pair(jp[2],  en[11].query), // レックウザVMAX     vs Rayquaza alt EN
  pair(jp[11], en[12].query), // ギラティナV SA     vs Giratina alt EN
  pair(jp[12], en[13].query), // ミュウVMAX SA      vs Mew alt EN
  pair(jp[10], en[14].query), // ルギアV SA         vs Lugia alt EN
  pair(jp[15], "Iono Special Illustration Rare Paldea Evolved 269/193"), // ナンジャモ vs Iono EN
];

const themes = {
  mon: { title: "🇯🇵 JP PSA10 TOP",        mode: "top",          cards: pick(jp, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]) },
  tue: { title: "🇺🇸 EN PSA10 TOP",        mode: "top",          cards: en.slice() },
  wed: { title: "📈 Weekly Movers",         mode: "movers",       cards: pick(jp, [0,1,2,10,11,12,15,16]).concat(pick(en, [0,1,10,11,12,13,14,17])), topN: 10 },
  thu: { title: "💎 Grade Premium 10vs9",   mode: "gradePremium", cards: pick(en, [0,1,2,10,11,12,13,14]).concat(pick(jp, [0,12])), topN: 9 },
  fri: { title: "🆕 Modern TOP (2020+)",    mode: "top",          cards: pick(en, [10,11,12,13,14,15,16,17]).concat(pick(jp, [1,15,16])) },
  sat: { title: "⚡ Pikachu & Eevee Day",   mode: "top",          cards: pick(jp, [17,0,3,4,5,6,7,8,9]).concat(pick(en, [10])) },
  sun: { title: "⚖️ JP vs EN Showdown",     mode: "jpVsEn",       cards: sunPairs },
};

for (const [day, { title, mode, cards, topN }] of Object.entries(themes)) {
  const out = {
    _note: `요일 테마(KST 게시일 기준) — ${title}. daily.yml 이 요일로 선택.`,
    _warning: "가격/이미지는 수집기가 API 로 채움. 매칭 이상 시 tcgPlayerId 로 고정 권장.",
    mode,
    cardImages: true,
    topN: topN ?? cards.length,
    cards: cards.map((x) => { const { cardImages, ...rest } = x; return rest; }),
  };
  await writeFile(join(ROOT, "data", `watchlist.${day}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ data/watchlist.${day}.json — ${title} (${cards.length}장, mode=${mode})`);
}
