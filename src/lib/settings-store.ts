import { normalizeSettings, type Settings } from "./settings";

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const bag = await chrome.storage.local.get(KEY);
  const settings = normalizeSettings(bag[KEY]);
  if (!bag[KEY]) await chrome.storage.local.set({ [KEY]: settings });
  return settings;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const settings = normalizeSettings(next);
  await chrome.storage.local.set({ [KEY]: settings });
  await applyBadge(settings.paused);
  return settings;
}

export async function applyBadge(paused: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: paused ? "OFF" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b8422f" });
  await chrome.action.setTitle({
    title: paused ? "Unforget is paused" : "Unforget: search pages you've read",
  });
}
