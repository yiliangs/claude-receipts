import { createServer } from "http";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { resolve, extname, isAbsolute, relative } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { homeDir } from "../utils/paths.js";

export interface PortalOptions {
  port?: string;
  open?: boolean;
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export class PortalCommand {
  async execute(options: PortalOptions): Promise<void> {
    const packageRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
    const assetsRoot = resolve(packageRoot, "dist", "portal");
    const dataRoot = resolve(homeDir(), ".agent-usage-stat", "portal-data");
    const builder = resolve(packageRoot, "portal", "scripts", "build-data.mjs");
    const port = this.parsePort(options.port);

    if (!existsSync(resolve(assetsRoot, "index.html"))) {
      throw new Error("Portal assets are missing. Run npm run build:portal.");
    }

    await this.runDataBuilder(builder, dataRoot);

    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url || "/", "http://localhost");
        const fromData = url.pathname.startsWith("/data/");
        const root = fromData ? dataRoot : assetsRoot;
        const requestedPath = fromData
          ? url.pathname.slice("/data/".length)
          : url.pathname === "/"
            ? "index.html"
            : url.pathname.slice(1);
        let path = resolve(root, requestedPath);
        const pathFromRoot = relative(root, path);
        if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
          response.writeHead(403).end("Forbidden");
          return;
        }
        if (!fromData && !(await this.isFile(path))) {
          path = resolve(assetsRoot, "index.html");
        }
        const body = await readFile(path);
        response.writeHead(200, {
          "Content-Type": MIME[extname(path)] || "application/octet-stream",
          "Cache-Control": fromData ? "no-store" : "public, max-age=3600",
        });
        response.end(body);
      } catch {
        response.writeHead(404).end("Not found");
      }
    });

    await new Promise<void>((resolveReady, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolveReady);
    });

    const url = `http://127.0.0.1:${port}`;
    console.log(chalk.green(`Agent Usage Stat is running at ${url}`));
    console.log(chalk.gray("Press Ctrl+C to stop."));
    if (options.open !== false) this.openBrowser(url);
  }

  private async runDataBuilder(builder: string, output: string): Promise<void> {
    await new Promise<void>((resolveDone, reject) => {
      const child = spawn(process.execPath, [builder, "--output", output], {
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolveDone();
        else reject(new Error(`Portal data build failed with exit code ${code}`));
      });
    });
  }

  private openBrowser(url: string): void {
    const command =
      process.platform === "darwin"
        ? { file: "open", args: [url] }
        : process.platform === "win32"
          ? { file: "cmd", args: ["/c", "start", "", url] }
          : { file: "xdg-open", args: [url] };
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  }

  private parsePort(value?: string): number {
    const port = Number(value || 4179);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${value}`);
    }
    return port;
  }

  private async isFile(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  }
}
