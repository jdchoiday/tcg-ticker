#!/usr/bin/env node
/**
 * buffer-channels.mjs — Buffer 연결된 채널 목록(id/service/name) 출력.
 * BUFFER_PROFILE_IDS 에 넣을 TikTok 채널 id 를 확인하는 용도. 토큰은 출력하지 않음.
 *
 * 사용(CI): BUFFER_ACCESS_TOKEN 시크릿으로 실행. 로컬: .env 의 BUFFER_ACCESS_TOKEN.
 * Buffer 새 GraphQL API: https://api.buffer.com (Bearer 인증).
 */
const token = process.env.BUFFER_ACCESS_TOKEN;
if (!token) { console.error("✗ BUFFER_ACCESS_TOKEN 없음"); process.exit(1); }

async function gql(query) {
  const res = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0,300)}`); }
  if (json.errors) throw new Error("GraphQL: " + JSON.stringify(json.errors).slice(0, 400));
  return json.data;
}

// 채널이 "발행 가능한 건강 상태"인지 판정. Buffer 채널 타입의 상태 필드는
// 버전마다 이름이 달라서, introspection 으로 실재하는 필드만 골라 조회한다.
const HEALTH_FIELDS = [
  "isDisconnected", "shouldReconnect", "needsReconnection",
  "accessTokenExpired", "isLocked", "isQueuePaused", "locked",
];
let HEALTH_AVAILABLE = []; // 런타임에 채워짐

function healthLabel(c) {
  const bad = [];
  if (c.isDisconnected || c.shouldReconnect || c.needsReconnection || c.accessTokenExpired)
    bad.push("재연결 필요(reconnect)");
  if (c.isLocked || c.locked) bad.push("잠김(locked)");
  if (c.isQueuePaused) bad.push("큐 일시정지(queue paused)");
  if (HEALTH_AVAILABLE.length === 0) return "  (상태필드 미지원 — 연결됨만 확인)";
  return bad.length ? `  ⚠️ ${bad.join(", ")}` : "  ✅ 발행 가능(연결 정상)";
}

function printChannels(orgName, channels) {
  for (const c of channels) {
    const star = /tiktok/i.test(c.service) ? "  ⭐ ← BUFFER_PROFILE_IDS 에 이 id" : "";
    console.log(`  [${c.service}] ${c.name}  → id: ${c.id}${star}`);
    console.log(`        상태:${healthLabel(c)}`);
  }
}

try {
  // 0) Channel 타입에 실제로 존재하는 상태 필드만 추려낸다(없는 필드 쿼리 시 전체 실패 방지).
  try {
    const ct = await gql(`query{ __type(name:"Channel"){ fields{ name } } }`);
    const names = new Set((ct.__type?.fields || []).map((f) => f.name));
    HEALTH_AVAILABLE = HEALTH_FIELDS.filter((f) => names.has(f));
  } catch { HEALTH_AVAILABLE = []; }
  const healthSel = HEALTH_AVAILABLE.join(" "); // 쿼리에 끼울 필드 목록

  // 1) 중첩 쿼리 시도 (org + channels 한 번에)
  let data;
  try {
    data = await gql(`query{ account{ organizations{ id name channels{ id name service ${healthSel} } } } }`);
  } catch (e) {
    console.log("• 중첩 쿼리 실패, org→channels 분리 시도:", e.message);
    const od = await gql(`query{ account{ organizations{ id name } } }`);
    data = { account: { organizations: [] } };
    for (const o of od.account.organizations) {
      const cd = await gql(`query{ channels(input:{ organizationId:"${o.id}" }){ id name service ${healthSel} } }`);
      data.account.organizations.push({ ...o, channels: cd.channels });
    }
  }
  const orgs = data.account?.organizations || [];
  if (!orgs.length) { console.log("연결된 조직이 없습니다."); process.exit(0); }
  for (const o of orgs) {
    console.log(`\n■ Organization: ${o.name} (id ${o.id})`);
    printChannels(o.name, o.channels || []);
  }
  console.log("\n→ 위에서 TikTok 채널의 id 를 GitHub Secret BUFFER_PROFILE_IDS 에 넣으세요(여러 개면 쉼표).");

  // ── 스키마 introspection (publish.mjs 입력 형식 확정용) ──
  const s = await gql(`query{
    video: __type(name:"VideoAssetInput"){ inputFields{ name type{ name kind ofType{ name kind } } } }
    sched: __type(name:"SchedulingType"){ enumValues{ name } }
  }`);
  console.log("\n=== SCHEMA ===");
  console.log("VideoAssetInput.inputFields:", JSON.stringify(s.video?.inputFields));
  console.log("SchedulingType.enumValues:", JSON.stringify(s.sched?.enumValues));
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}
