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

function printChannels(orgName, channels) {
  for (const c of channels) {
    const star = /tiktok/i.test(c.service) ? "  ⭐ ← BUFFER_PROFILE_IDS 에 이 id" : "";
    console.log(`  [${c.service}] ${c.name}  → id: ${c.id}${star}`);
  }
}

try {
  // 1) 중첩 쿼리 시도 (org + channels 한 번에)
  let data;
  try {
    data = await gql(`query{ account{ organizations{ id name channels{ id name service } } } }`);
  } catch (e) {
    console.log("• 중첩 쿼리 실패, org→channels 분리 시도:", e.message);
    const od = await gql(`query{ account{ organizations{ id name } } }`);
    data = { account: { organizations: [] } };
    for (const o of od.account.organizations) {
      const cd = await gql(`query{ channels(input:{ organizationId:"${o.id}" }){ id name service } }`);
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
    asset: __type(name:"AssetInput"){ inputFields{ name type{ name kind ofType{ name kind } } } }
    mode:  __type(name:"ShareMode"){ enumValues{ name } }
    post:  __type(name:"CreatePostInput"){ inputFields{ name type{ name kind ofType{ name kind } } } }
  }`);
  console.log("\n=== SCHEMA ===");
  console.log("AssetInput.inputFields:", JSON.stringify(s.asset?.inputFields));
  console.log("ShareMode.enumValues:", JSON.stringify(s.mode?.enumValues));
  console.log("CreatePostInput.inputFields:", JSON.stringify(s.post?.inputFields));
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
}
