import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/cli.js",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});

chmodSync("dist/cli.js", 0o755);
