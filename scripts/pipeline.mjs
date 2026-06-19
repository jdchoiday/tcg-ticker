#!/usr/bin/env node
/**
 * pipeline.mjs — Phase 4: 하루치 산출을 한 번에. collect → validate → capture → caption → (publish).
 *
 * 각 단계를 자식 프로세스로 순차 실행하고, 실패하면 즉시 중단(fail-fast)한다.
 * cron/Railway/GitHub Actions 에서 이 한 줄만 부르면 됨.
 *
 * 사용:
 *   node scripts/pipeline.mjs                 # 실 API 수집 → 검증 → 영상 → 캡션
 *   node scripts/pipeline.mjs --mock          # fixtures 수집(키 불필요)
 *   node scripts/pipeline.mjs --no-video      # 영상 단계 생략(chromium 없는 환경)
 *   node scripts/pipeline.mjs --publish        # 마지막에 발행 dry-run
 *   node scripts/pipeline.mjs --publish --confirm   # 실제 발행까지
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const MOCK = has("--mock");
const NO_VIDEO = has("--no-video");
const PUBLISH = has("--publish");
const CONFIRM = has("--confirm");

const log = (...a) => console.log("\n[pipeline]", ...a);

/** 자식 노드 스크립트 실행. 0이 아니면 throw */
function run(script, scriptArgs = []) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(__dirname, script), ...scriptArgs], {
      cwd: ROOT, stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${script} exited ${code}`))));
    child.on("error", rej);
  });
}

// 실행할 단계 목록 구성
const steps = [
  ["collect", "collect.mjs", MOCK ? ["--mock"] : []],
  ["validate", "validate.mjs", []],
  ...(NO_VIDEO ? [] : [["capture", "capture.mjs", []]]),
  ["caption", "caption.mjs", []],
  ...(PUBLISH ? [["publish", "publish.mjs", CONFIRM ? ["--confirm"] : []]] : []),
];

const t0 = Date.now();
try {
  log(`start — ${steps.map((s) => s[0]).join(" → ")}`);
  for (const [name, script, sArgs] of steps) {
    log(`▶ ${name}${sArgs.length ? " " + sArgs.join(" ") : ""}`);
    await run(script, sArgs);
  }
  log(`✓ done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error(`\n[pipeline] ✗ ${e.message}`);
  process.exit(1);
}
