#!/usr/bin/env node
/**
 * validate.mjs — dependency-free validator for data/cards.json.
 * Checks the data contract (cards.schema.json) without pulling in ajv,
 * so it runs with zero install. Exits non-zero on any error → safe for CI/cron gate.
 *
 * Usage: node scripts/validate.mjs [path/to/cards.json]
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = resolve(process.argv[2] ?? resolve(__dirname, "../data/cards.json"));

const TYPES = ["electric","fire","water","grass","steel","psychic","dragon","dark","fairy","normal"];
const LANGS = ["KR","JP","EN"];
const REQUIRED_STR = ["nameKo","nameEn","set","rarity","grade"];

const errors = [];
const err = (i, msg) => errors.push(`  card[${i}]: ${msg}`);

let cards;
try {
  cards = JSON.parse(await readFile(file, "utf8"));
} catch (e) {
  console.error(`✗ Could not read/parse ${file}\n  ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(cards)) {
  console.error("✗ Root must be an array.");
  process.exit(1);
}
if (cards.length === 0) {
  console.error("✗ cards.json is empty (minItems: 1).");
  process.exit(1);
}

const seenRanks = new Map();
cards.forEach((c, i) => {
  if (typeof c !== "object" || c === null) { err(i, "not an object"); return; }

  if (!Number.isInteger(c.rank) || c.rank < 1) err(i, `rank must be a positive integer (got ${JSON.stringify(c.rank)})`);
  else if (seenRanks.has(c.rank)) err(i, `duplicate rank ${c.rank} (also card[${seenRanks.get(c.rank)}])`);
  else seenRanks.set(c.rank, i);

  for (const k of REQUIRED_STR) {
    if (typeof c[k] !== "string" || c[k].trim() === "") err(i, `${k} must be a non-empty string`);
  }
  if (!TYPES.includes(c.type)) err(i, `type "${c.type}" not in [${TYPES.join(", ")}]`);
  if (!LANGS.includes(c.lang)) err(i, `lang "${c.lang}" not in [${LANGS.join(", ")}]`);
  if (typeof c.krw !== "number" || !(c.krw > 0)) err(i, `krw must be a number > 0 (got ${JSON.stringify(c.krw)})`);

  if ("pop" in c && c.pop !== null && typeof c.pop !== "string") err(i, "pop must be a string or null");
  if ("img" in c && c.img !== null && typeof c.img !== "string") err(i, "img must be a string URL or null");
});

if (errors.length) {
  console.error(`✗ ${file}\n${errors.length} problem(s):\n${errors.join("\n")}`);
  process.exit(1);
}

console.log(`✓ ${cards.length} cards valid — ${file}`);
