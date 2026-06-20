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

/* ---- 3b. ffmpeg transcode ---- */
function transcode(input, output) {
  const args = [
    "-y", "-i", input,
    "-vf", `scale=${VIDEO_W}:${VIDEO_H}:flags=lanczos,fps=${FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-movflags", "+faststart",
    output,
  ];
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
  await transcode(webm, join(OUT, "ticker.mp4"));
  await rm(webm).catch(() => {});
  log("✓ done → out/ticker.mp4");
} catch (e) {
  console.error("[capture] ✗", e.message);
  process.exitCode = 1;
} finally {
  if (server) server.kill();
}
