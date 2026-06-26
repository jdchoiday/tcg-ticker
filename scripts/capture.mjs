#!/usr/bin/env node
/**
 * capture.mjs — Phase 2: render ticker.html headlessly and record one loop to mp4.
 *
 *   1. spawns serve.mjs on a private port
 *   2. opens it in headless Chromium (Playwright) at 1080x1920, recording video
 *   3. waits for fonts + data-ready, records exactly CONFIG.loopSeconds (one seamless loop)
 *   4. transcodes the .webm → out/ticker.mp4 (H.264, 1080x1920, 30fps) via ffmpeg
 *
 * Usage:
 *   node scripts/capture.mjs                 # full loop (CONFIG.loopSeconds)
 *   CAPTURE_SECONDS=6 node scripts/capture.mjs   # short test clip
 *
 * Requires: playwright (npm i), chromium (npx playwright install chromium), ffmpeg on PATH.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = join(ROOT, "out");
const PORT = Number(process.env.CAPTURE_PORT) || 4188;
const URL = `http://localhost:${PORT}/`;
const VIDEO_W = 1080, VIDEO_H = 1920, FPS = 30;

const log = (...a) => console.log("[capture]", ...a);

/* ---- 1. start static server as a child ---- */
function startServer() {
  const child = spawn(process.execPath, [join(__dirname, "serve.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("server start timeout")), 8000);
    child.stdout.on("data", (d) => {
      if (d.toString().includes("http://localhost")) { clearTimeout(t); res(child); }
    });
    child.on("exit", (c) => rej(new Error("server exited early, code " + c)));
  });
}

/* ---- 3b. ffmpeg transcode (+ optional baked-in BGM) ----
 * assets/bgm.mp3 가 있으면 영상 길이에 맞춰 루프·페이드 후 믹스한다.
 * TikTok 자동발행(Buffer)은 틱톡 인기음원을 못 붙이므로, 음악은 파일에 미리 입혀야 한다.
 * 음원은 직접 합성한 로열티프리 트랙(scripts/make-bgm.sh 로 재생성 가능) → 저작권 자유. */
const BGM = join(ROOT, "assets", "bgm.mp3");
function transcode(input, output, seconds) {
  const hasBgm = existsSync(BGM) && process.env.NO_BGM !== "1";
  const vfilter = `scale=${VIDEO_W}:${VIDEO_H}:flags=lanczos,fps=${FPS},format=yuv420p`;
  const fadeOut = Math.max(0, (Number(seconds) || 0) - 2.5);
  const args = hasBgm
    ? [
        "-y", "-i", input,
        "-i", BGM,   // BGM(60s) 이 영상(~42s)보다 길어 루프 불필요.
        // ⚠ -stream_loop -1 금지: filter_complex+-shortest 와 조합 시 ffmpeg 가
        //   가짜 "No space left on device"(exit 228)로 죽는 버그. 영상이 BGM보다 길어질 일 없게 유지.
        "-filter_complex",
          `[0:v]${vfilter}[v];` +
          `[1:a]volume=0.85,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOut.toFixed(2)}:d=2.5[a]`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",                                 // 영상 끝나면 종료(오디오 잘림)
        // faststart 제거: moov 재배치 2-pass 가 러너에서 실패(exit 228) + Buffer/TikTok 재인코딩이라 불필요
        output,
      ]
    : [
        "-y", "-i", input,
        "-vf", vfilter,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-movflags", "+faststart",
        output,
      ];
  log(hasBgm ? "transcode + BGM mix (assets/bgm.mp3)" : "transcode (no BGM)");
  return new Promise((res, rej) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
    ff.on("error", (e) => rej(new Error("ffmpeg not found on PATH? " + e.message)));
    ff.on("exit", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exited code " + c))));
  });
}

let server;
try {
  await mkdir(OUT, { recursive: true });
  // clean prior webm fragments (keep mp4 + .gitkeep)
  for (const f of await readdir(OUT)) {
    if (f.endsWith(".webm")) await rm(join(OUT, f));
  }

  log("starting server…");
  server = await startServer();
  log("server up:", URL);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({
    viewport: { width: VIDEO_W, height: VIDEO_H },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    recordVideo: { dir: OUT, size: { width: VIDEO_W, height: VIDEO_H } },
  });
  const page = await context.newPage();

  log("loading ticker…");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400); // settle fonts/layout before the clean loop

  const loopSeconds = await page.evaluate(() => (window.CONFIG?.loopSeconds) ?? 60);
  // 빠른 스크롤(작은 loopSeconds)이면 한 루프가 너무 짧으니 정수배로 ~18s 이상 녹화(이음새 유지)
  const loops = Math.max(1, Math.round(18 / loopSeconds));
  const seconds = Number(process.env.CAPTURE_SECONDS) || loops * loopSeconds;
  log(`recording ${seconds}s (loopSeconds=${loopSeconds} ×${loops} loops)…`);
  await sleep(seconds * 1000);

  // closing the context flushes the .webm to disk
  await page.close();
  await context.close();
  await browser.close();

  const webm = (await readdir(OUT)).filter((f) => f.endsWith(".webm")).map((f) => join(OUT, f))[0];
  if (!webm) throw new Error("no .webm produced by Playwright");
  log("transcoding → out/ticker.mp4 …");
  await transcode(webm, join(OUT, "ticker.mp4"), seconds);
  await rm(webm).catch(() => {});
  log("✓ done → out/ticker.mp4");
} catch (e) {
  console.error("[capture] ✗", e.message);
  process.exitCode = 1;
} finally {
  if (server) server.kill();
}
