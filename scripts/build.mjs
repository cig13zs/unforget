import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

execSync("node scripts/icons.mjs", { stdio: "inherit" });
execSync("npx vite build --config vite.config.ts", { stdio: "inherit" });

await build({
  entryPoints: ["src/content/index.ts"],
  bundle: true,
  format: "iife",
  outfile: "dist/content.js",
  target: "chrome120",
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

await build({
  entryPoints: ["src/background/index.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/background.js",
  target: "chrome120",
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const key = JSON.parse(readFileSync("src/extension-key.json", "utf8"));
const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
manifest.version = pkg.version;
manifest.key = key.key;
if (manifest.description.length > 132) {
  throw new Error(`Description is ${manifest.description.length} characters; Chrome allows 132.`);
}
for (const name of ["popup", "options", "search", "sidepanel"]) {
  const html = readFileSync(`dist/src/${name}/index.html`, "utf8").replaceAll("../../assets/", "assets/");
  writeFileSync(`dist/${name}.html`, html);
}
rmSync("dist/src", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
writeFileSync("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
cpSync("NOTICE", "dist/NOTICE");
console.log(`Built Unforget ${pkg.version} (${key.id})`);
