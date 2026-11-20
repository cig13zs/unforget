#!/usr/bin/env node
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const host = resolve(here, "host.mjs");
const key = JSON.parse(readFileSync(resolve(here, "../src/extension-key.json"), "utf8"));
chmodSync(host, 0o755);

const manifest = {
  name: "com.unforget.bridge",
  description: "Unforget local reading-history bridge",
  path: host,
  type: "stdio",
  allowed_origins: [`chrome-extension://${key.id}/`],
};

const dirs = hostDirs();
for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "com.unforget.bridge.json");
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${target}`);
}

console.log(`Extension id: ${key.id}`);
console.log("Enable Desktop bridge in Unforget options, then restart Chrome.");
console.log("The host writes ~/.unforget/index.json with mode 0600.");

function hostDirs() {
  const home = homedir();
  if (process.platform === "darwin") {
    return [
      join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
      join(home, "Library/Application Support/Chromium/NativeMessagingHosts"),
    ];
  }
  if (process.platform === "win32") {
    console.log("On Windows, save the manifest and add this registry key:");
    console.log('REG ADD "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.unforget.bridge" /ve /t REG_SZ /d "%USERPROFILE%\\com.unforget.bridge.json" /f');
    return [join(home, "NativeMessagingHosts")];
  }
  return [
    join(home, ".config/google-chrome/NativeMessagingHosts"),
    join(home, ".config/chromium/NativeMessagingHosts"),
  ];
}
