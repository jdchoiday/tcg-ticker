#!/usr/bin/env node
/**
 * gen-weekly-watchlists.mjs — 요일별 테마 워치리스트 7종 생성(1회성 빌더).
 *
 * ✅ 확정 라인업(JD 지정, 요일 = KST 게시일):
 *   월  빈티지 그레일 (Base·1st Ed 리자몽 등)   EN
 *   화  모던 알트아트 (SAR/SR)                  JP
 *   수  이색·골드스타·크리스탈                  EN
 *   목  인기 포켓몬 (피카츄·이브이 계열)        JP
 *   금  프리미엄 모던 ex                        EN
 *   토  구판 홀로 클래식                        JP
 *   일  주간 급등락 무버스 (TOP movers)         혼합 (mode:movers)
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (f) => JSON.parse(await readFile(join(ROOT, "data", f), "utf8"));
const en = (await load("watchlist.en.json")).cards;   // 0:BaseZard 1:Rainbow 2:GS Zard 3:GS Ray 4:GS Umbreon 5:GS Espeon
                                                      // 6-9:1stEd 10:Moonbreon 11:RayAlt 12:GiratinaAlt 13:MewAlt 14:LugiaAlt
                                                      // 15:GlaceonAlt 16:LeafeonAlt 17:Zard ex SIR(OF)
const jp = (await load("watchlist.jp.json")).cards;   // 0:ブラッキー 1:リザードンex SAR 2:レックウザSSR 3-9:イーブイズSA
                                                      // 10:ルギアSA 11:ギラティナSA 12:ミュウSA 13:リザードンV SSR
                                                      // 14:ミュウツーSA 15:ナンジャモSAR 16:ミライドンSAR 17:ピカチュウ促
const pick = (arr, idx) => idx.map((i) => arr[i]);

/* ── 신규 시드(검증된 리스트에 없는 유명 카드). 매칭은 첫 실행 로그로 확인 후 tcgPlayerId 고정 ── */
// 월: EN 빈티지 보강
const vintageExtra = [
  { query: "Charizard 1st Edition Base Set", nameKo: "Charizard", nameEn: "1st Edition Holo", set: "Base Set 4/102", rarity: "1st Ed Holo", type: "fire", lang: "EN", grade: "PSA 10" },
  { query: "Alakazam 1st Edition Base Set", nameKo: "Alakazam", nameEn: "1st Edition Holo", set: "Base Set 1/102", rarity: "1st Ed Holo", type: "psychic", lang: "EN", grade: "PSA 10" },
];
// 수: EN 이색(크리스탈·샤이닝)
const oddballExtra = [
  { query: "Crystal Charizard Skyridge", nameKo: "Crystal Charizard", nameEn: "Crystal Type", set: "Skyridge 146/144", rarity: "Crystal", type: "fire", lang: "EN", grade: "PSA 10" },
  { query: "Crystal Lugia Aquapolis", nameKo: "Crystal Lugia", nameEn: "Crystal Type", set: "Aquapolis 149/147", rarity: "Crystal", type: "normal", lang: "EN", grade: "PSA 10" },
  { query: "Shining Charizard Neo Destiny", nameKo: "Shining Charizard", nameEn: "Shining", set: "Neo Destiny 107/105", rarity: "Shining", type: "fire", lang: "EN", grade: "PSA 10" },
  { query: "Shining Mewtwo Neo Destiny", nameKo: "Shining Mewtwo", nameEn: "Shining", set: "Neo Destiny 109/105", rarity: "Shining", type: "psychic", lang: "EN", grade: "PSA 10" },
];
// 금: EN 프리미엄 모던 ex (Pokémon 151 SIR)
const modernExFri = [
  { query: "Charizard ex Pokemon 151 199/165", nameKo: "Charizard ex", nameEn: "Special Illustration Rare", set: "151 199/165", rarity: "SIR", type: "fire", lang: "EN", grade: "PSA 10" },
  { query: "Venusaur ex Pokemon 151 198/165", nameKo: "Venusaur ex", nameEn: "Special Illustration Rare", set: "151 198/165", rarity: "SIR", type: "grass", lang: "EN", grade: "PSA 10" },
  { query: "Blastoise ex Pokemon 151 200/165", nameKo: "Blastoise ex", nameEn: "Special Illustration Rare", set: "151 200/165", rarity: "SIR", type: "water", lang: "EN", grade: "PSA 10" },
  { query: "Mew ex Pokemon 151 205/165", nameKo: "Mew ex", nameEn: "Special Illustration Rare", set: "151 205/165", rarity: "SIR", type: "psychic", lang: "EN", grade: "PSA 10" },
  { query: "Zapdos ex Pokemon 151 202/165", nameKo: "Zapdos ex", nameEn: "Special Illustration Rare", set: "151 202/165", rarity: "SIR", type: "electric", lang: "EN", grade: "PSA 10" },
  { query: "Alakazam ex Pokemon 151 201/165", nameKo: "Alakazam ex", nameEn: "Special Illustration Rare", set: "151 201/165", rarity: "SIR", type: "psychic", lang: "EN", grade: "PSA 10" },
];
// 토: JP 구판 홀로 클래식 (언어 파라미터 japanese 로 일판 매칭)
const jpVintageSat = [
  { query: "Charizard Base Set", nameKo: "リザードン", nameEn: "Base Set Holo (JP)", set: "旧裏 Base", rarity: "Holo", type: "fire", lang: "JP", grade: "PSA 10" },
  { query: "Blastoise Base Set", nameKo: "カメックス", nameEn: "Base Set Holo (JP)", set: "旧裏 Base", rarity: "Holo", type: "water", lang: "JP", grade: "PSA 10" },
  { query: "Venusaur Base Set", nameKo: "フシギバナ", nameEn: "Base Set Holo (JP)", set: "旧裏 Base", rarity: "Holo", type: "grass", lang: "JP", grade: "PSA 10" },
  { query: "Mewtwo Base Set", nameKo: "ミュウツー", nameEn: "Base Set Holo (JP)", set: "旧裏 Base", rarity: "Holo", type: "psychic", lang: "JP", grade: "PSA 10" },
  { query: "Gyarados Base Set", nameKo: "ギャラドス", nameEn: "Base Set Holo (JP)", set: "旧裏 Base", rarity: "Holo", type: "water", lang: "JP", grade: "PSA 10" },
  { query: "Dark Charizard Team Rocket", nameKo: "わるいリザードン", nameEn: "Team Rocket Holo (JP)", set: "旧裏 Rocket", rarity: "Holo", type: "fire", lang: "JP", grade: "PSA 10" },
  { query: "Lugia Neo Genesis", nameKo: "ルギア", nameEn: "Neo Genesis Holo (JP)", set: "旧裏 Neo", rarity: "Holo", type: "normal", lang: "JP", grade: "PSA 10" },
  { query: "Ho-Oh Neo Revelation", nameKo: "ホウオウ", nameEn: "Neo Revelation Holo (JP)", set: "旧裏 Neo", rarity: "Holo", type: "fire", lang: "JP", grade: "PSA 10" },
  { query: "Shining Charizard Neo Destiny", nameKo: "ひかるリザードン", nameEn: "Neo Destiny Shining (JP)", set: "旧裏 Neo", rarity: "Shining", type: "fire", lang: "JP", grade: "PSA 10" },
];

const themes = {
  mon: { title: "🏛 Vintage Grails (EN)",          mode: "top",    cards: pick(en, [0, 6, 7, 8, 9]).concat(vintageExtra) },              // 7장
  tue: { title: "🎨 Modern Alt-Art SAR/SR (JP)",   mode: "top",    cards: pick(jp, [1, 2, 10, 11, 12, 13, 14, 15, 16]) },               // 9장
  wed: { title: "✨ Gold Star·Crystal·Shining (EN)", mode: "top",  cards: pick(en, [2, 3, 4, 5, 1]).concat(oddballExtra) },             // 9장
  thu: { title: "⚡ Pikachu & Eevee (JP)",          mode: "top",    cards: pick(jp, [17, 0, 3, 4, 5, 6, 7, 8, 9]) },                     // 9장
  fri: { title: "💠 Premium Modern ex (EN)",        mode: "top",    cards: [en[17]].concat(modernExFri) },                                // 7장
  sat: { title: "📜 Classic JP Holo (구판)",        mode: "top",    cards: jpVintageSat },                                                // 9장
  sun: { title: "📈 Weekly TOP Movers (혼합)",      mode: "movers", cards: pick(jp, [0, 1, 2, 10, 11, 12, 15, 16, 17]).concat(pick(en, [0, 1, 2, 10, 11, 12, 13, 14])), topN: 10 },
};

for (const [day, { title, mode, cards, topN }] of Object.entries(themes)) {
  const out = {
    _note: `요일 테마(KST 게시일 기준) — ${title}. daily.yml 이 요일로 선택.`,
    _warning: "가격/이미지는 수집기가 API 로 채움. 신규 시드는 첫 실행 로그에서 매칭 확인 후 tcgPlayerId 고정 권장.",
    mode,
    cardImages: true,
    topN: topN ?? cards.length,
    cards: cards.map((x) => { const { cardImages, ...rest } = x; return rest; }),
  };
  await writeFile(join(ROOT, "data", `watchlist.${day}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`✓ data/watchlist.${day}.json — ${title} (${cards.length}장, mode=${mode})`);
}
