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

/* createPost 반환 유니온의 에러 멤버 타입 중 message 필드가 있는 것 → 실패 사유 출력용.
   스키마에 실재하는 타입만 fragment 로 넣어 쿼리 깨짐 방지. 실패 시 빈 문자열(기존 동작). */
async function discoverErrorFragments(token) {
  try {
    const md = await gql(token, `query{ __type(name:"Mutation"){ fields{ name type{ name kind ofType{ name kind ofType{ name } } } } } }`);
    const f = (md.data?.__type?.fields || []).find((x) => x.name === "createPost");
    let rt = f?.type;
    while (rt && !rt.name && rt.ofType) rt = rt.ofType; // NON_NULL 등 언랩
    if (!rt?.name) return "";
    const td = await gql(token, `query{ __type(name:"${rt.name}"){ possibleTypes{ name fields{ name } } } }`);
    const pts = td.data?.__type?.possibleTypes || [];
    return pts
      .filter((pt) => pt.name !== "PostActionSuccess" && (pt.fields || []).some((fl) => fl.name === "message"))
      .map((pt) => `... on ${pt.name} { message }`)
      .join("\n");
  } catch { return ""; }
}

/* 한 채널 1회 발행 시도 → {ok, status?, typename?, message?} (throw 안 함) */
async function tryPost(token, mutation, { channelId, caption, videoUrl, mode, saveDraft, schedulingType = "automatic" }) {
  const input = {
    channelId,
    text: caption,
    schedulingType,                                // "automatic"(완전자동) | "notification"(앱 알림→수동 게시; FB 그룹 등)
    mode,                                          // ShareMode: addToQueue|shareNow|shareNext|customScheduled
    assets: [{ video: { url: videoUrl } }],        // VideoAssetInput { url(필수), thumbnailUrl?, metadata? }
    ...(saveDraft ? { saveToDraft: true } : {}),   // 초안 모드
  };
  try {
    const json = await gql(token, mutation, { input });
    if (json.errors) return { ok: false, typename: "GraphQLError", message: JSON.stringify(json.errors).slice(0, 240) };
    const r = json.data?.createPost;
    if (r?.__typename === "PostActionSuccess") return { ok: true, status: r.post?.status, id: r.post?.id };
    return { ok: false, typename: r?.__typename || "Unknown", message: r?.message };
  } catch (e) {
    return { ok: false, typename: "Exception", message: e.message };
  }
}

/* createPost: 채널별로 영상 URL + 캡션 발행. 채널 하나가 실패해도 나머지는 계속 진행. */
async function postToBuffer({ token, channelIds, caption, videoUrl, saveDraft }) {
  const errFrags = await discoverErrorFragments(token);
  const mutation = `mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ${errFrags}
    }
  }`;
  const results = [];
  for (const channelId of channelIds) {
    let out = await tryPost(token, mutation, { channelId, caption, videoUrl, mode: MODE, saveDraft });
    // FB 그룹 등 완전자동 미지원 채널: "notification scheduling" 요구 시 알림 예약으로 재시도.
    // → Buffer 앱이 게시 시간에 알림을 보내고, 사용자가 탭하면 그룹에 게시(반자동. Meta 정책상 그룹 완전자동 불가).
    if (!out.ok && /notification scheduling/i.test(out.message || "")) {
      warn(`채널 ${channelId} 완전자동 미지원: ${out.message} → 알림(notification) 예약으로 재시도`);
      const notif = await tryPost(token, mutation, { channelId, caption, videoUrl, mode: MODE, schedulingType: "notification" });
      out = notif.ok ? { ...notif, note: "notification·앱 알림→수동 게시" } : notif;
    }
    // 그래도 실패면 초안으로 폴백해 최소한 검수용으로 남김
    if (!out.ok && !saveDraft) {
      warn(`채널 ${channelId} 실패: ${out.typename}${out.message ? " — " + out.message : ""} → 초안(draft)으로 재시도`);
      const draft = await tryPost(token, mutation, { channelId, caption, videoUrl, mode: MODE, saveDraft: true });
      if (draft.ok) out = { ...draft, note: "draft-fallback" };
    }
    results.push({ channelId, ...out });
    log(`  채널 ${channelId}: ${out.ok ? "✓ " + (out.status || "ok") + (out.note ? " (" + out.note + ")" : "") : "✗ " + out.typename + (out.message ? " — " + out.message : "")}`);
  }
  return results;
}

async function main() {
  await loadEnv();
  await renderCaption();

  if (await exists(VIDEO)) log(`영상(로컬): out/ticker.mp4 (${fmtMB((await stat(VIDEO)).size)})`);
  const caption = (await exists(CAPTION)) ? (await readFile(CAPTION, "utf8")).trim() : "";
  log(`캡션: ${caption.split("\n")[0] || "(없음)"} …`);

  // 품질 가드: 카드 이미지 커버리지가 낮으면(빈 카드 많은 영상) 라이브 자동게시 대신 '초안'으로.
  let saveDraft = process.env.BUFFER_SAVE_DRAFT === "1";
  try {
    const cards = JSON.parse(await readFile(resolve(ROOT, "data/cards.json"), "utf8"));
    const withImg = cards.filter((c) => c.img).length;
    const cov = cards.length ? withImg / cards.length : 0;
    log(`이미지 커버리지: ${withImg}/${cards.length} (${Math.round(cov * 100)}%)`);
    if (!saveDraft && cov < 0.8) {
      saveDraft = true;
      console.warn(`⚠ 이미지 커버리지 ${Math.round(cov * 100)}% < 80% — 빈 카드 많은 영상이라 라이브 대신 '초안'으로 전환(검수 필요).`);
    }
  } catch { /* cards.json 없으면 가드 생략 */ }

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

  log(`발행 시도 (mode=${MODE}, ${channelIds.length}개 채널, ${saveDraft ? "초안" : "라이브"})…`);
  const r = await postToBuffer({ token, channelIds, caption, videoUrl, saveDraft });
  const ok = r.filter((x) => x.ok);
  const bad = r.filter((x) => !x.ok);
  log(`발행 결과: ${ok.length}/${r.length} 성공`);
  if (bad.length) warn(`실패 채널: ${bad.map((x) => `${x.channelId}(${x.typename})`).join(", ")}`);
  // 한 채널이라도 성공하면 워크플로는 성공 처리(예: 틱톡 성공 + 페북 실패 → 틱톡 살림). 전부 실패 시에만 실패.
  if (ok.length === 0) { console.error("[publish] ✗ 모든 채널 발행 실패"); process.exit(1); }
}

main().catch((e) => { console.error("[publish] ✗", e.message); process.exit(1); });
