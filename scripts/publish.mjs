#!/usr/bin/env node
/**
 * publish.mjs — Phase 4: out/ticker.mp4 + out/caption.txt → 소셜 발행(스캐폴드).
 *
 * 기본 동작은 **dry-run**: 산출물(mp4/caption) 존재를 검증하고 "무엇을 어디로 올릴지"
 * 플랜만 출력한다. 실제 업로드는 토큰(BUFFER_ACCESS_TOKEN)과 `--confirm` 이 둘 다
 * 있을 때만 시도한다(사고 방지).
 *
 * 사용:
 *   node scripts/publish.mjs                 # dry-run (네트워크 호출 없음)
 *   node scripts/publish.mjs --confirm       # 실제 발행 (BUFFER_ACCESS_TOKEN 필요)
 *
 * 발행 경로 = Buffer(→ TikTok/Shorts 연결). 무료 가입 후 토큰/프로필ID 발급:
 *   BUFFER_ACCESS_TOKEN, BUFFER_PROFILE_IDS(쉼표구분) 를 .env 에.
 *
 * ⚠️ TODO(토큰 발급 후 확정): Buffer 영상 업로드는 멀티스텝(미디어 업로드 → update 생성).
 *    아래 postToBuffer() 의 엔드포인트/페이로드를 실제 응답으로 확정하고 가드를 풀 것.
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { renderCaption } from "./caption.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "out");
const VIDEO = join(OUT, "ticker.mp4");
const CAPTION = join(OUT, "caption.txt");

const CONFIRM = process.argv.includes("--confirm");
const log = (...a) => console.log("[publish]", ...a);
const warn = (...a) => console.warn("[publish] ⚠", ...a);

/* ---- .env 무의존 로더 (collect.mjs 와 동일 규칙) ---- */
async function loadEnv() {
  try {
    const txt = await readFile(resolve(ROOT, ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env 없으면 무시 */ }
}

const exists = (p) => stat(p).then(() => true).catch(() => false);
const fmtMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + " MB";

/* ---- 실 발행 (가드 뒤). 토큰 발급 후 엔드포인트/페이로드 확정 필요 ---- */
async function postToBuffer({ token, profileIds, caption /*, videoPath */ }) {
  // TODO: Buffer 영상 발행은 (1) 미디어 업로드 → (2) updates/create 멀티스텝.
  //       실응답 1건으로 엔드포인트/필드 확정 후 아래 스텁을 교체할 것.
  const url = "https://api.bufferapp.com/1/updates/create.json";
  const body = new URLSearchParams();
  body.set("access_token", token);
  for (const id of profileIds) body.append("profile_ids[]", id);
  body.set("text", caption);
  // body.set("media[video]", <uploaded-media-id>);  // ← 미디어 업로드 후 채움
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) throw new Error(`Buffer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  await loadEnv();

  // 1) caption 최신화 (없거나 stale 이어도 항상 다시 렌더)
  await renderCaption();

  // 2) 산출물 검증
  if (!(await exists(VIDEO))) {
    warn(`영상 없음: out/ticker.mp4 — 먼저 \`npm run capture\` (이 환경은 chromium 없어 CI/로컬에서).`);
  } else {
    const s = await stat(VIDEO);
    log(`영상: out/ticker.mp4 (${fmtMB(s.size)})`);
  }
  const caption = (await exists(CAPTION)) ? await readFile(CAPTION, "utf8") : "";
  log(`캡션: ${caption.split("\n")[0] || "(없음)"} …`);

  const token = process.env.BUFFER_ACCESS_TOKEN;
  const profileIds = (process.env.BUFFER_PROFILE_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  // 3) dry-run vs 실 발행
  if (!CONFIRM) {
    log("DRY-RUN (네트워크 호출 없음). 실제 발행: `node scripts/publish.mjs --confirm`");
    log(`  → Buffer profiles: ${profileIds.length ? profileIds.join(", ") : "(BUFFER_PROFILE_IDS 미설정)"}`);
    log(`  → 토큰: ${token ? "설정됨" : "미설정 (BUFFER_ACCESS_TOKEN)"}`);
    return;
  }
  if (!token || !profileIds.length) {
    console.error("✗ --confirm 인데 BUFFER_ACCESS_TOKEN / BUFFER_PROFILE_IDS 가 없습니다.");
    process.exit(1);
  }
  if (!(await exists(VIDEO))) {
    console.error("✗ 발행할 out/ticker.mp4 가 없습니다."); process.exit(1);
  }
  log("발행 시도…");
  const r = await postToBuffer({ token, profileIds, caption, videoPath: VIDEO });
  log("✓ 발행 응답:", JSON.stringify(r).slice(0, 200));
}

main().catch((e) => { console.error("[publish] ✗", e.message); process.exit(1); });
