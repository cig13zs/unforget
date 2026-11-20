import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

if (!existsSync("dist/manifest.json")) {
  throw new Error("dist/manifest.json is missing. Run npm run build first.");
}
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const name = `unforget-${version}.zip`;
execSync(`rm -f ${name} && cd dist && zip -r ../${name} . -x '*.map'`, { stdio: "inherit" });
console.log(name);
