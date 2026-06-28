#!/usr/bin/env node
/**
 * capture.mjs — Phase 2: render ticker.html → out/ticker.mp4 (매끄러운 모션).
 *
 * 결정론적 프레임 캡처(deterministic frame capture):
 *   1. serve.mjs 를 자식 프로세스로 띄움
 *   2. headless Chromium(Playwright) 1080x1920 로 로드, 폰트/데이터 준비 대기
 *   3. 모든 CSS 애니메이션을 pause 하고, 프레임마다 currentTime 을 정확히 seek → 스크린샷
 *      (recordVideo 화면녹화의 불균일 fps/저더를 제거 → 완벽히 균일한 모션)
 *   4. ffmpeg 로 PNG 시퀀스를 정확한 CFR fps 로 인코딩(+ assets/bgm.mp3 믹스)
 *
 * 환경변수:
 *   FPS=30|60            출력/캡처 프레임레이트(기본 30, 60=초매끄러움·프레임수 2배)
 *   CAPTURE_SECONDS=8    짧은 테스트 클립(기본=한 바퀴=CONFIG.loopSeconds)
 *   NO_BGM=1             BGM 끄기
 *
 * Requires: playwright, chromium, ffmpeg.
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
const FRAMES = join(OUT, "frames");
const BGM = join(ROOT, "assets", "bgm.mp3");
const PORT = Number(process.env.CAPTURE_PORT) || 4188;
const URL = `http://localhost:${PORT}/`;
const VIDEO_W = 1080, VIDEO_H = 1920;
const FPS = Math.max(24, Math.min(60, Number(process.env.FPS) || 30));

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

/* ---- 4. ffmpeg: PNG 시퀀스 → mp4 (+BGM) ----
 * 프레임이 이미 1080x1920 정확본이라 scale 불필요. -r 로 정확한 CFR 보장(저더 0). */
function encodeFrames(output, seconds) {
  const hasBgm = existsSync(BGM) && process.env.NO_BGM !== "1";
  const pattern = join(FRAMES, "f%05d.png");
  const fadeOut = Math.max(0, (Number(seconds) || 0) - 2.5);
  const args = hasBgm
    ? [
        "-y", "-framerate", String(FPS), "-i", pattern,
        "-i", BGM,
        "-filter_complex",
          `[0:v]format=yuv420p[v];` +
          `[1:a]volume=0.9,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOut.toFixed(2)}:d=2.5[a]`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart",
        output,
      ]
    : [
        "-y", "-framerate", String(FPS), "-i", pattern,
        "-vf", "format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS),
        "-movflags", "+faststart",
        output,
      ];
  log(`encode ${FPS}fps ${hasBgm ? "+ BGM" : "(no BGM)"} …`);
  return new Promise((res, rej) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
    ff.on("error", (e) => rej(new Error("ffmpeg not found on PATH? " + e.message)));
    ff.on("exit", (c) => (c === 0 ? res() : rej(new Error("ffmpeg exited code " + c))));
  });
}

let server;
try {
  await mkdir(OUT, { recursive: true });
  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });

  log("starting server…");
  server = await startServer();
  log("server up:", URL);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({
    viewport: { width: VIDEO_W, height: VIDEO_H },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();

  log("loading ticker…");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector('html[data-ready="1"]', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  // 카드 배경이미지(.photo background-image) 전부 로드 대기 → 첫 프레임 빈 카드 방지
  await page.evaluate(async () => {
    const urls = [...document.querySelectorAll(".card .photo")]
      .map((el) => (getComputedStyle(el).backgroundImage.match(/url\("?(.+?)"?\)/) || [])[1])
      .filter(Boolean);
    await Promise.all(urls.map((u) => new Promise((res) => {
      const im = new Image(); im.onload = im.onerror = res; im.src = u;
      setTimeout(res, 8000); // CDN 지연 상한
    })));
  }).catch(() => {});
  await sleep(500); // 폰트/레이아웃 안정화

  const loopSeconds = await page.evaluate(() => (window.CONFIG?.loopSeconds) ?? 60);
  const seconds = Number(process.env.CAPTURE_SECONDS) || loopSeconds; // 기본=한 바퀴(이음새 0)
  const total = Math.round(seconds * FPS);
  log(`capturing ${total} frames (${seconds}s × ${FPS}fps, loopSeconds=${loopSeconds})…`);

  // 모든 애니메이션 일시정지 → 프레임마다 정확히 seek (균일 모션의 핵심)
  await page.evaluate(() => { for (const a of document.getAnimations()) a.pause(); });

  const clip = { x: 0, y: 0, width: VIDEO_W, height: VIDEO_H };
  for (let i = 0; i < total; i++) {
    const tMs = (i / FPS) * 1000;
    await page.evaluate((t) => {
      for (const a of document.getAnimations()) { try { a.currentTime = t; } catch {} }
    }, tMs);
    await page.screenshot({ path: join(FRAMES, `f${String(i).padStart(5, "0")}.png`), clip, type: "png" });
    if (i && i % 150 === 0) log(`  ${i}/${total}`);
  }

  await page.close();
  await context.close();
  await browser.close();

  log("encoding → out/ticker.mp4 …");
  await encodeFrames(join(OUT, "ticker.mp4"), seconds);
  await rm(FRAMES, { recursive: true, force: true });
  log("✓ done → out/ticker.mp4");
} catch (e) {
  console.error("[capture] ✗", e.message);
  process.exitCode = 1;
} finally {
  if (server) server.kill();
}
