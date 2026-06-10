import { hostname } from "os";
import type { ReceiptData } from "./receipt-generator.js";
import type { WeatherSnapshot } from "../utils/weather.js";
import {
  formatCurrency,
  formatNumber,
  formatDateTime,
  formatDuration,
} from "../utils/formatting.js";
import { displayModelName } from "./model-names.js";

export class HtmlRenderer {
  /**
   * Generate HTML receipt with embedded CSS
   */
  generateHtml(data: ReceiptData, receiptText: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Receipt - ${data.transcriptData.sessionSlug}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;700&display=block">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Geist Mono', ui-monospace, 'Courier New', Courier, monospace;
      font-size: 16px;
      font-variant-ligatures: none;
      font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
      background: #3a3a3a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .receipt-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 40px;
    }

    .receipt {
      background: #f8f8f8;
      width: 400px;
      padding: 30px 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
      position: relative;
      animation: slideIn 0.5s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .receipt::before,
    .receipt::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      height: 15px;
      background: repeating-linear-gradient(
        90deg,
        transparent,
        transparent 10px,
        #f8f8f8 10px,
        #f8f8f8 20px
      );
    }

    .receipt::before {
      top: -15px;
      left: -10px;
    }

    .receipt::after {
      bottom: -15px;
    }

    .receipt-content {
      color: #333;
      line-height: 1.6;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .header {
      text-align: center;
      padding: 20px 0;
    }

    .logo {
      line-height: 1.2;
      font-weight: bold;
      white-space: pre;
      display: inline-block;
      margin: 10px 0;
    }

    .separator {
      border-bottom: 2px solid #333;
      margin: 15px 0;
    }

    .light-separator {
      border-bottom: 1px dashed #999;
      margin: 10px 0;
    }

    .summary {
      background: #fff;
      padding: 15px;
      margin: 15px 0;
      border-left: 4px solid #333;
    }

    .line-item {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      color: #555;
    }

    .model-header {
      display: flex;
      justify-content: space-between;
      padding: 8px 0 4px 0;
      margin-top: 10px;
      border-bottom: 1px dashed #ccc;
    }

    .model-header:first-child {
      margin-top: 0;
    }

    .model-name {
      font-weight: bold;
      color: #333;
    }

    .model-cost {
      font-weight: bold;
      color: #333;
    }

    .total-section {
      margin-top: 20px;
      padding-top: 15px;
      border-top: 2px solid #333;
    }

    .total {
      font-weight: bold;
      display: flex;
      justify-content: space-between;
      margin: 10px 0;
    }

    .footer {
      text-align: center;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 2px dashed #999;
      color: #666;
    }

    .footer-message {
      margin: 15px 0;
      color: #333;
    }

    .meta {
      margin: 10px 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .meta-row {
      color: #666;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 1px;
      text-align: left;
    }

    .meta .dots {
      overflow: hidden;
      text-wrap: auto;
      word-wrap: break-word;
      height: 1rem;
    }

    .meta .value {
      text-align: right;
    }

    .download-link {
      text-align: center;
      margin-top: 20px;
    }

    .download-link a {
      display: inline-block;
      padding: 10px 20px;
      background: #333;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      transition: background 0.3s;
    }

    .download-link a:hover {
      background: #000;
    }

    .generated-by {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px dashed #999;
    }

    .weather {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px dashed #999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      color: #333;
    }

    .weather-icon {
      font-size: 36px;
      line-height: 1;
    }

    .weather-text {
      font-size: 14px;
    }

    .weather-place {
      font-size: 12px;
      color: #777;
    }

    @media print {
      body {
        background: white;
      }
      .receipt {
        box-shadow: none;
        width: 100%;
      }
      .download-link {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="receipt">
      <div class="header">
        <div class="logo"> ▐▛███▜▌
 ▝▜█████▛▘
 ▘▘ ▝▝
</div>
        <div class="meta">
          ${this.renderProjectRow(data)}
          <div class="meta-row">
            <div>Session</div><div class="dots">....................</div><div class="value">${this.escapeHtml(data.transcriptData.sessionSlug)}</div>
          </div>
          <div class="meta-row">
            <div>Machine</div><div class="dots">....................</div><div class="value">${this.escapeHtml(hostname())}</div>
          </div>
          <div class="meta-row">
            <div>Date</div><div class="dots">....................</div><div class="value">${formatDateTime(data.transcriptData.endTime, data.config.timezone)}</div>
          </div>
        </div>
      </div>

      <div class="separator"></div>

      ${this.renderLineItems(data)}

      <div class="total-section">
        <div class="total">
          <span>TOTAL</span>
          <span>${formatCurrency(data.sessionData.totalCost)}</span>
        </div>
      </div>

      <div class="footer">
        <div>CASHIER: ${this.getMainModel(data)}</div>
        <div class="footer-message">Thank you for building!</div>
        ${this.renderWeather(data)}
      </div>
    </div>
  </div>

  <script>
    // Add keyboard shortcut to close window
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.close();
      }
    });

    console.log('Claude Receipt Generated!');
    console.log('Session:', '${this.escapeHtml(data.transcriptData.sessionSlug)}');
    console.log('Cost:', '${formatCurrency(data.sessionData.totalCost)}');
    console.log('Press ESC to close');
  </script>
</body>
</html>`;
  }

  /** Project/branch row for the header meta block. Hidden when neither is known. */
  private renderProjectRow(data: ReceiptData): string {
    const { projectName, gitBranch } = data.transcriptData;
    if (!projectName && !gitBranch) return "";

    const value =
      projectName && gitBranch
        ? `${projectName} @ ${gitBranch}`
        : projectName || gitBranch || "";

    return `<div class="meta-row">
            <div>Project</div><div class="dots">....................</div><div class="value">${this.escapeHtml(value)}</div>
          </div>`;
  }

  /** Weather footer block. Hidden when the fetch failed. */
  private renderWeather(data: ReceiptData): string {
    const w: WeatherSnapshot | null | undefined = data.weather;
    if (!w) return "";
    const temp = `${Math.round(w.tempC)}°C`;
    const place = w.place
      ? `<div class="weather-place">${this.escapeHtml(w.place)}</div>`
      : "";
    return `<div class="weather">
          <div class="weather-icon">${this.escapeHtml(w.icon)}</div>
          <div class="weather-text">${this.escapeHtml(w.description)} · ${temp}</div>
          ${place}
        </div>`;
  }

  /**
   * Render line items HTML
   * Shows token counts and model subtotals (not per-token-type costs, which would be inaccurate)
   */
  private renderLineItems(data: ReceiptData): string {
    let html = '<div style="margin: 20px 0;">';

    if (
      data.sessionData.modelBreakdowns &&
      data.sessionData.modelBreakdowns.length > 0
    ) {
      for (const model of data.sessionData.modelBreakdowns) {
        // Model name with its subtotal cost
        html += `<div class="model-header">
          <span class="model-name">${this.escapeHtml(this.getModelName(model.modelName))}</span>
          <span class="model-cost">${formatCurrency(model.cost)}</span>
        </div>`;

        html += `<div class="line-item">
          <span>  Input tokens</span>
          <span>${formatNumber(model.inputTokens)}</span>
        </div>`;

        html += `<div class="line-item">
          <span>  Output tokens</span>
          <span>${formatNumber(model.outputTokens)}</span>
        </div>`;

        if (model.cacheCreationTokens && model.cacheCreationTokens > 0) {
          html += `<div class="line-item">
            <span>  Cache write</span>
            <span>${formatNumber(model.cacheCreationTokens)}</span>
          </div>`;
        }

        if (model.cacheReadTokens && model.cacheReadTokens > 0) {
          html += `<div class="line-item">
            <span>  Cache read</span>
            <span>${formatNumber(model.cacheReadTokens)}</span>
          </div>`;
        }
      }
    }

    // Session-level duration row — sits with the line items, under Cache read.
    html += `<div class="line-item">
      <span>  Duration</span>
      <span>${this.escapeHtml(
        formatDuration(
          data.transcriptData.startTime,
          data.transcriptData.endTime,
        ),
      )}</span>
    </div>`;

    html += "</div>";
    return html;
  }

  /**
   * Get clean model name
   */
  private getModelName(model: string): string {
    return displayModelName(model);
  }

  /**
   * Get main model
   */
  private getMainModel(data: ReceiptData): string {
    if (
      data.sessionData.modelBreakdowns &&
      data.sessionData.modelBreakdowns.length > 0
    ) {
      return this.getModelName(data.sessionData.modelBreakdowns[0].modelName);
    }

    if (data.sessionData.modelsUsed && data.sessionData.modelsUsed.length > 0) {
      return this.getModelName(data.sessionData.modelsUsed[0]);
    }

    return "Claude";
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
