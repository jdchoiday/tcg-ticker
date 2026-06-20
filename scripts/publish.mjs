#!/usr/bin/env node
/**
 * publish.mjs — Phase 4: 렌더된 영상 + 캡션 → Buffer(→ TikTok) 발행.
 *
 * Buffer 새 GraphQL API(https://api.buffer.com)는 영상 "직접 업로드"는 베타 미지원이라,
 * **공개 영상 URL**(public repo 의 raw URL)을 assets 로 넘긴다.
 *
 * 환경:
 *   BUFFER_ACCESS_TOKEN   개인 API 키 (Bearer)
 *   BUFFER_PROFILE_IDS    채널 id(쉼표구분)  ※ TikTok 채널 id
 *   PUBLISH_VIDEO_URL     공개 mp4 URL (예: raw.githubusercontent.com/.../samples/ticker-latest.mp4)
 *   BUFFER_MODE           addToQueue(기본) | shareNow | addToDrafts  ← 안전 테스트는 addToDrafts
 *
 * 사용:
 *   node scripts/publish.mjs                 # dry-run (네트워크 호출 없음)
 *   node scripts/publish.mjs --confirm       # 실제 createPost 호출
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
const API = "https://api.buffer.com";

const CONFIRM = process.argv.includes("--confirm");
const MODE = process.env.BUFFER_MODE || "addToQueue";
const log = (...a) => console.log("[publish]", ...a);
const warn = (...a) => console.warn("[publish] ⚠", ...a);

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
const fmtMB = (b) => (b / 1024 / 1024).toFixed(2) + " MB";

/* ---- Buffer GraphQL ---- */
async function gql(token, query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`); }
  return json;
}

/* createPost: 채널별로 영상 URL + 캡션 발행 */
async function postToBuffer({ token, channelIds, caption, videoUrl }) {
  const mutation = `mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
    }
  }`;
  const results = [];
  for (const channelId of channelIds) {
    const input = {
      channelId,
      text: caption,
      schedulingType: "automatic",
      mode: MODE,                                   // ShareMode: addToQueue|shareNow|shareNext|customScheduled
      assets: [{ video: { url: videoUrl } }],       // VideoAssetInput { url(필수), thumbnailUrl?, metadata? }
      ...(process.env.BUFFER_SAVE_DRAFT === "1" ? { saveToDraft: true } : {}), // 안전 테스트=초안
    };
    const json = await gql(token, mutation, { input });
    results.push({ channelId, json });
    log(`  채널 ${channelId} 응답: ${JSON.stringify(json).slice(0, 500)}`);
    if (json.errors) throw new Error("GraphQL 오류 — 위 응답으로 스키마 보정 필요");
    const r = json.data?.createPost;
    if (r && r.__typename !== "PostActionSuccess") throw new Error("Buffer 비성공 응답: " + JSON.stringify(r));
  }
  return results;
}

async function main() {
  await loadEnv();
  await renderCaption();

  if (await exists(VIDEO)) log(`영상(로컬): out/ticker.mp4 (${fmtMB((await stat(VIDEO)).size)})`);
  const caption = (await exists(CAPTION)) ? (await readFile(CAPTION, "utf8")).trim() : "";
  log(`캡션: ${caption.split("\n")[0] || "(없음)"} …`);

  const token = process.env.BUFFER_ACCESS_TOKEN;
  const channelIds = (process.env.BUFFER_PROFILE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const videoUrl = process.env.PUBLISH_VIDEO_URL;

  if (!CONFIRM) {
    log("DRY-RUN (네트워크 호출 없음). 실제 발행: --confirm");
    log(`  토큰: ${token ? "설정됨" : "없음"} · 채널: ${channelIds.join(",") || "없음"} · mode: ${MODE}`);
    log(`  영상 URL: ${videoUrl || "(PUBLISH_VIDEO_URL 미설정)"}`);
    return;
  }
  if (!token || !channelIds.length) { console.error("✗ BUFFER_ACCESS_TOKEN / BUFFER_PROFILE_IDS 필요"); process.exit(1); }
  if (!videoUrl) { console.error("✗ PUBLISH_VIDEO_URL(공개 mp4 URL) 필요"); process.exit(1); }

  log(`발행 시도 (mode=${MODE}, ${channelIds.length}개 채널)…`);
  const r = await postToBuffer({ token, channelIds, caption, videoUrl });
  log("✓ 완료:", JSON.stringify(r).slice(0, 300));
}

main().catch((e) => { console.error("[publish] ✗", e.message); process.exit(1); });
