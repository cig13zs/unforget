import { fragmentPhrase } from "../../shared/snippet";
import { highlightStorageKey, withTextFragment } from "../lib/url";

export async function openAtPassage(url: string, quote: string): Promise<void> {
  const phrase = fragmentPhrase(quote);
  if (phrase) {
    await chrome.storage.session.set({ [highlightStorageKey(url)]: { quote: phrase } });
  }
  await chrome.tabs.create({ url: phrase ? withTextFragment(url, phrase) : url });
}
