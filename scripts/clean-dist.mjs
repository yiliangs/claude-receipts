import { rmSync } from "node:fs";

const distUrl = new URL("../dist/", import.meta.url);

rmSync(distUrl, { recursive: true, force: true });
