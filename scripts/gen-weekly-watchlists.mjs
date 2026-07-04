#!/usr/bin/env node
/**
 * gen-weekly-watchlists.mjs — 요일별 테마 워치리스트 7종 생성(1회성 빌더).
 * 월~목: 기존 검증된 en/jp 카드를 테마별로 재편성(안전).
 * 금~일: 유명 메인스트림 카드 시드(첫 실행에서 매칭 확인 후 정밀화).
 * 매일 JP/EN 은 요일 테마에 내장(월 EN / 화 JP / 수 EN / 목 JP / 금 EN / 토 JP / 일 혼합).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (f) => JSON.parse(await readFile(join(ROOT, "data", f), "utf8"));
const en = (await load("watchlist.en.json")).cards;
const jp = (await load("watchlist.jp.json")).cards;
const pick = (arr, idx) => idx.map((i) => arr[i]);

// 새 시드 카드(금/토/일). query 로 API 검색 매칭. 첫 실행에서 확인 후 tcgPlayerId 로 고정 권장.
const c = (o) => ({ cardImages: undefined, ...o });
const fri = [ // EN 프리미엄 모던 (Pokémon 151 스페셜 일러 레어)
  { query: "Charizard ex Pokemon 151 199/165", nameKo: "Charizard ex", nameEn: "Special Illustration Rare", set: "151 199/165", rarity: "SIR", type: "fire", lang: "EN", grade: "PSA 10" },
  { query: "Venusaur ex Pokemon 151 198/165", nameKo: "Venusaur ex", nameEn: "Special Illustration Rare", set: "151 198/165", rarity: "SIR", type: "grass", lang: "EN", grade: "PSA 10" },
  { query: "Blastoise ex Pokemon 151 200/165", nameKo: "Blastoise ex", nameEn: "Special Illustration Rare", set: "151 200/165", rarity: "SIR", type: "water", lang: "EN", grade: "PSA 10" },
  { query: "Mew ex Pokemon 151 205/165", nameKo: "Mew ex", nameEn: "Special Illustration Rare", set: "151 205/165", rarity: "SIR", type: "psychic", lang: "EN", grade: "PSA 10" },
  { query: "Zapdos ex Pokemon 151 202/165", nameKo: "Zapdos ex", nameEn: "Special Illustration Rare", set: "151 202/165", rarity: "SIR", type: "electric", lang: "EN", grade: "PSA 10" },
  { query: "Alakazam ex Pokemon 151 201/165", nameKo: "Alakazam ex", nameEn: "Special Illustration Rare", set: "151 201/165", rarity: "SIR", type: "psychic", lang: "EN", grade: "PSA 10" },
];
const sat = [ // JP 모던 체이스 (ポケモンカード151 sv2a SAR)
  { query: "リザードンex SAR ポケモンカード151", nameKo: "リザードンex", nameEn: "Charizard ex SAR", set: "sv2a 201/165", rarity: "SAR", type: "fire", lang: "JP", grade: "PSA 10" },
  { query: "フシギバナex SAR ポケモンカード151", nameKo: "フシギバナex", nameEn: "Venusaur ex SAR", set: "sv2a 200/165", rarity: "SAR", type: "grass", lang: "JP", grade: "PSA 10" },
  { query: "カメックスex SAR ポケモンカード151", nameKo: "カメックスex", nameEn: "Blastoise ex SAR", set: "sv2a 202/165", rarity: "SAR", type: "water", lang: "JP", grade: "PSA 10" },
  { query: "ミュウex SAR ポケモンカード151", nameKo: "ミュウex", nameEn: "Mew ex SAR", set: "sv2a 205/165", rarity: "SAR", type: "psychic", lang: "JP", grade: "PSA 10" },
  { query: "フーディンex SAR ポケモンカード151", nameKo: "フーディンex", nameEn: "Alakazam ex SAR", set: "sv2a 203/165", rarity: "SAR", type: "psychic", lang: "JP", grade: "PSA 10" },
];
const sun = [ // 주간 TOP — EN/JP 최고가 그레일 혼합
  en[0],   // Base Set Charizard (EN)
  en[2],   // Gold Star Charizard (EN)
  en[10],  // Moonbreon (EN)
  en[1],   // Rainbow Charizard (EN)
  jp[1],   // リザードンex SAR (JP)
  jp[0],   // ブラッキーVMAX SA (JP)
];

const themes = {
  mon: { title: "EN Vintage Grails", cards: pick(en, [0, 2, 3, 4, 5, 6, 7, 8, 9]) },
  tue: { title: "JP Modern SAR/SSR", cards: pick(jp, [1, 2, 10, 11, 12, 13, 14, 15, 16]) },
  wed: { title: "EN Modern Alt-Art/SIR", cards: pick(en, [1, 10, 11, 12, 13, 14, 15, 16, 17]) },
  thu: { title: "JP Eevee Heroes + Pikachu", cards: pick(jp, [0, 3, 4, 5, 6, 7, 8, 9, 17]) },
  fri: { title: "EN Premium Modern (151)", cards: fri },
  sat: { title: "JP Modern Chase (151)", cards: sat },
  sun: { title: "Weekly TOP — Mixed Grails", cards: sun },
};

for (const [day, { title, cards }] of Object.entries(themes)) {
  const out = {
    _note: `요일별 테마 워치리스트 — ${title}. daily.yml 이 요일(1=월..7=일)로 선택.`,
    _warning: "가격/이미지는 수집기가 API 로 채움. 금/토/일 시드 카드는 첫 실행에서 매칭 확인 후 tcgPlayerId 로 고정 권장.",
    cardImages: true,
    topN: cards.length,
    cards: cards.map((x) => { const { cardImages, ...rest } = x; return rest; }),
  };
  await writeFile(join(ROOT, "data", `watchlist.${day}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ data/watchlist.${day}.json — ${title} (${cards.length}장)`);
}
