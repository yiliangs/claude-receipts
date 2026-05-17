import { spawn } from "child_process";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Render the receipt HTML to PNG / PDF by shelling out to the system's
 * Chromium-based browser (Microsoft Edge on Windows, Chrome elsewhere).
 *
 * No npm Chromium download, no headful UI. The browser is already on
 * the machine; we just drive it with --headless flags.
 *
 * PNG output uses a two-pass capture: pass 1 dumps the DOM with the
 * .receipt bounding rect serialized into <title>, pass 2 captures at
 * the exact measured dimensions for a tight crop on all four sides.
 */
export class ImageRenderer {
  /** 2x device scale factor for crisp PNG output. */
  private readonly pngScale = 2;

  async renderPng(html: string, outputPath: string): Promise<void> {
    const browserPath = this.findBrowser();
    const finalHtml = this.injectMeasureScript(
      this.injectCss(html, this.pngCss()),
    );
    const { htmlPath, profileDir } = await this.writeTempHtml(finalHtml);
    try {
      const bounds = await this.measureReceipt(
        browserPath,
        profileDir,
        htmlPath,
      );

      // Crop hugs the receipt: window-size = receipt size, body padded to 0
      // (handled in pngCss), receipt anchored at (0,0) of the viewport.
      await this.runHeadless(browserPath, profileDir, [
        `--screenshot=${outputPath}`,
        `--window-size=${bounds.w},${bounds.h}`,
        "--force-device-scale-factor=1",
        "--default-background-color=ffffffff",
        "--hide-scrollbars",
        "--virtual-time-budget=5000",
        this.fileUrl(htmlPath),
      ]);
    } finally {
      await this.cleanup(profileDir);
    }
  }

  async renderPdf(html: string, outputPath: string): Promise<void> {
    const browserPath = this.findBrowser();
    const { htmlPath, profileDir } = await this.writeTempHtml(
      this.injectCss(html, this.pdfCss()),
    );
    try {
      await this.runHeadless(browserPath, profileDir, [
        `--print-to-pdf=${outputPath}`,
        "--no-pdf-header-footer",
        "--virtual-time-budget=5000",
        this.fileUrl(htmlPath),
      ]);
    } finally {
      await this.cleanup(profileDir);
    }
  }

  /** No persistent state — each render spawns a fresh process. */
  async close(): Promise<void> {}

  // ---- internals ----

  /**
   * Pass 1: run --dump-dom, parse the .receipt rect serialized into <title>.
   */
  private async measureReceipt(
    browserPath: string,
    profileDir: string,
    htmlPath: string,
  ): Promise<{ w: number; h: number }> {
    const dom = await this.runHeadlessCapture(browserPath, profileDir, [
      "--dump-dom",
      "--force-device-scale-factor=1",
      "--virtual-time-budget=5000",
      this.fileUrl(htmlPath),
    ]);

    const match = dom.match(/<title>([^<]*)<\/title>/);
    if (!match) throw new Error("Measure pass: no <title> in DOM dump");

    const payload = this.decodeHtmlEntities(match[1]);
    let parsed: { w: number; h: number };
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error(
        `Measure pass: <title> was not JSON bounds (got "${payload.slice(0, 80)}")`,
      );
    }
    if (!Number.isFinite(parsed.w) || !Number.isFinite(parsed.h)) {
      throw new Error(`Measure pass: invalid bounds ${JSON.stringify(parsed)}`);
    }
    return { w: Math.ceil(parsed.w), h: Math.ceil(parsed.h) };
  }

  private runHeadless(
    browserPath: string,
    profileDir: string,
    args: string[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        browserPath,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          `--user-data-dir=${profileDir}`,
          ...args,
        ],
        { windowsHide: true },
      );
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Headless browser exited with code ${code}. ${stderr.slice(-400)}`,
            ),
          );
      });
    });
  }

  /** Same as runHeadless but captures stdout. */
  private runHeadlessCapture(
    browserPath: string,
    profileDir: string,
    args: string[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        browserPath,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          `--user-data-dir=${profileDir}`,
          ...args,
        ],
        { windowsHide: true },
      );
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve(stdout);
        else
          reject(
            new Error(
              `Headless browser exited with code ${code}. ${stderr.slice(-400)}`,
            ),
          );
      });
    });
  }

  private async writeTempHtml(
    html: string,
  ): Promise<{ htmlPath: string; profileDir: string }> {
    const dir = await mkdtemp(join(tmpdir(), "claude-receipt-"));
    const htmlPath = join(dir, "receipt.html");
    await writeFile(htmlPath, html, "utf-8");
    return { htmlPath, profileDir: join(dir, "profile") };
  }

  private async cleanup(profileDir: string): Promise<void> {
    const root = profileDir.replace(/[\\/]profile$/, "");
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  private fileUrl(p: string): string {
    return "file:///" + p.replace(/\\/g, "/");
  }

  private injectCss(html: string, css: string): string {
    const tag = `<style>${css}</style>`;
    return html.includes("</head>")
      ? html.replace("</head>", `${tag}</head>`)
      : tag + html;
  }

  /**
   * Inject a measure script just before </body> so .receipt is in the DOM
   * when it runs. Sets <title> to a JSON-encoded bounding rect. We re-measure
   * a few times so whichever fires last (sync parse, fonts.ready, setTimeout)
   * wins — the final value is what --dump-dom captures.
   */
  private injectMeasureScript(html: string): string {
    const script = `<script>
(function () {
  function measure() {
    var el = document.querySelector('.receipt');
    if (!el) { document.title = '{"err":"no-receipt"}'; return; }
    var r = el.getBoundingClientRect();
    var bw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    var bh = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    document.title = JSON.stringify({
      w: Math.ceil(r.width), h: Math.ceil(r.height),
      x: Math.floor(r.left), y: Math.floor(r.top),
      bw: bw, bh: bh,
      iw: window.innerWidth
    });
  }
  measure();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  setTimeout(measure, 500);
  setTimeout(measure, 2000);
})();
</script>`;
    return html.includes("</body>")
      ? html.replace("</body>", `${script}</body>`)
      : html + script;
  }

  private decodeHtmlEntities(s: string): string {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  /**
   * Shared overrides: kill the slideIn animation (otherwise --print-to-pdf
   * captures opacity:0), drop the dark page background, hide share UI, and
   * suppress the ::before/::after notched edges that overflow the receipt box.
   */
  private commonCss(): string {
    return `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .receipt::before, .receipt::after { display: none !important; }
      html, body { background: #ffffff !important; }
      .receipt-container { padding: 0 !important; gap: 0 !important; box-shadow: none !important; }
      .receipt { margin: 0 !important; box-shadow: none !important; opacity: 1 !important; transform: none !important; }
      .share-section, #share-btn, #share-result { display: none !important; }
    `;
  }

  /**
   * For PNG: pin .receipt to (0,0) with position:fixed so it always anchors
   * to the top-left of the viewport regardless of the parent flex/grid
   * layout. Window-size then matches the receipt size exactly = tight crop.
   */
  private pngCss(): string {
    return `
      ${this.commonCss()}
      html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      body { min-height: auto !important; display: block !important; }
      .receipt-container { margin: 0 !important; padding: 0 !important; }
      .receipt {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        margin: 0 !important;
      }
    `;
  }

  /**
   * For PDF we set @page so the page hugs the receipt instead of embedding
   * it on a giant letter sheet. 5in × 12in comfortably fits the 400px-wide
   * receipt with breathing room.
   */
  private pdfCss(): string {
    return `
      @page { size: 5in 12in; margin: 0.15in; }
      ${this.commonCss()}
      body { padding: 0 !important; min-height: auto !important; display: block !important; }
    `;
  }

  private findBrowser(): string {
    const env = process.env;
    const candidates = [
      env.CLAUDE_RECEIPTS_BROWSER,
      // Windows Edge (stable, then beta/dev as fallbacks)
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      // Windows Chrome
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      // macOS
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      // Linux
      "/usr/bin/microsoft-edge",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].filter((p): p is string => !!p);

    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    throw new Error(
      "No Chromium-based browser found. Install Microsoft Edge or Google Chrome, " +
        "or set CLAUDE_RECEIPTS_BROWSER to the absolute path of the browser binary.",
    );
  }
}
