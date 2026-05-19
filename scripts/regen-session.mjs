#!/usr/bin/env node
// Manually regenerate a receipt for a given session ID + transcript path.
// Bypasses stdin parsing (which is flaky to drive from Git Bash on Windows).
import { DataFetcher } from "../dist/core/data-fetcher.js";
import { TranscriptParser } from "../dist/core/transcript-parser.js";
import { HtmlRenderer } from "../dist/core/html-renderer.js";
import { ImageRenderer } from "../dist/core/image-renderer.js";
import { ReceiptGenerator } from "../dist/core/receipt-generator.js";
import { ConfigManager } from "../dist/core/config-manager.js";
import { LocationDetector } from "../dist/utils/location.js";
import { WeatherFetcher } from "../dist/utils/weather.js";
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";

const [, , sessionId, transcriptPath] = process.argv;
if (!sessionId || !transcriptPath) {
  console.error("usage: regen-session.mjs <sessionId> <transcriptPath>");
  process.exit(1);
}

const fetcher = new DataFetcher();
const parser = new TranscriptParser();
const html = new HtmlRenderer();
const png = new ImageRenderer();
const recGen = new ReceiptGenerator();
const cfgMgr = new ConfigManager();
const loc = new LocationDetector();
const wx = new WeatherFetcher();

const config = await cfgMgr.loadConfig();
const sessionData = await fetcher.fetchSessionById(sessionId);
console.log(`ccusage: cost=$${sessionData.totalCost.toFixed(2)} tokens=${sessionData.totalTokens}`);

const transcriptData = await parser.parseTranscript(transcriptPath, sessionId);
const [location, weather] = await Promise.all([
  loc.getLocation(config),
  wx.getCurrentWeather(),
]);
const receiptData = { sessionData, transcriptData, location, config, weather };
const receiptText = recGen.generateReceipt(receiptData);
const rendered = html.generateHtml(receiptData, receiptText);

const pad = (n) => String(n).padStart(2, "0");
const d = transcriptData.endTime;
const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const slug = transcriptData.sessionSlug || sessionId;
const fileBase = `${slug}-${ts}`;

const home = process.env.HOME || process.env.USERPROFILE || "";
const outDir = join(home, ".claude-receipts", "projects");
await mkdir(outDir, { recursive: true });

const htmlPath = join(outDir, `${fileBase}.html`);
const pngPath = join(outDir, `${fileBase}.png`);
const pdfPath = join(outDir, `${fileBase}.pdf`);

await writeFile(htmlPath, rendered, "utf-8");
console.log(`html: ${htmlPath}`);
await png.renderPng(rendered, pngPath);
console.log(`png:  ${pngPath}`);
await png.renderPdf(rendered, pdfPath);
console.log(`pdf:  ${pdfPath}`);
await png.close();
