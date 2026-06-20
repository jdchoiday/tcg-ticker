#!/usr/bin/env node
/**
 * caption.mjs — Phase 4: caption.txt 템플릿 → out/caption.txt (placeholder 치환).
 *
 * 흐름: caption.txt(템플릿) + data/cards.json(1위) + lib/fx.mjs(환율) →
 *      {{date}}/{{top1_*}}/{{fx_*}} 등을 채워 out/caption.txt 로 저장.
 *      publish.mjs 가 이 파일을 발행 텍스트로 사용한다.
 *
 * 사용:
 *   node scripts/caption.mjs                 # 오늘 날짜로 렌더
 *   CAPTION_DATE=2026-06-19 node scripts/caption.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { FX, krwToUsd } from "./lib/fx.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "out");
const log = (...a) => console.log("[caption]", ...a);

/** YYYY-MM-DD (로컬). CAPTION_DATE 로 오버라이드 가능 */
const today = () => process.env.CAPTION_DATE || new Date().toISOString().slice(0, 10);

/** 등급가 USD 표시: 정수 달러 + 천단위 콤마 */
const fmtUsd = (krw) => "$" + Math.round(krwToUsd(krw)).toLocaleString("en-US");

async function render() {
  const tpl = await readFile(resolve(ROOT, "caption.txt"), "utf8");
  const cards = JSON.parse(await readFile(resolve(ROOT, "data/cards.json"), "utf8"));
  if (!Array.isArray(cards) || !cards.length) throw new Error("data/cards.json 비어있음");

  const top1 = cards.find((c) => c.rank === 1) ?? cards[0];
  const vars = {
    date: today(),
    top1_nameKo: top1.nameKo,
    top1_nameEn: top1.nameEn,
    top1_grade: top1.grade,
    top1_usd: fmtUsd(top1.krw),
    fx_date: FX.date,
    krwPerUsd: FX.krwPerUsd.toLocaleString("en-US"),
    vndPerUsd: FX.vndPerUsd.toLocaleString("en-US"),
  };

  const missing = [];
  const filled = tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    if (k in vars) return String(vars[k]);
    missing.push(k);
    return `{{${k}}}`;
  });
  if (missing.length) log("⚠ 미치환 placeholder:", [...new Set(missing)].join(", "));

  await mkdir(OUT, { recursive: true });
  const outPath = join(OUT, "caption.txt");
  await writeFile(outPath, filled, "utf8");
  log(`✓ → out/caption.txt (1위 ${vars.top1_nameKo} ${vars.top1_grade} ${vars.top1_usd})`);
  return outPath;
}

// 직접 실행 시에만 렌더 (publish.mjs 에서 import 재사용)
if (import.meta.url === `file://${process.argv[1]}`) {
  render().catch((e) => { console.error("[caption] ✗", e.message); process.exit(1); });
}

export { render as renderCaption };
