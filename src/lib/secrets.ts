import { decryptString, encryptString, type CipherBlob } from "./crypto";

const SECRET_KEY = "secret";
const SESSION_KEY = "unlockedKey";

interface SecretRecord {
  plain?: string;
  cipher?: CipherBlob;
}

export async function readSecret(): Promise<SecretRecord> {
  const bag = await chrome.storage.local.get(SECRET_KEY);
  const value = bag[SECRET_KEY];
  if (!value || typeof value !== "object") return {};
  return value as SecretRecord;
}

export async function currentApiKey(): Promise<string | null> {
  const secret = await readSecret();
  if (typeof secret.plain === "string" && secret.plain) return secret.plain;
  if (!secret.cipher) return null;
  const bag = await chrome.storage.session.get(SESSION_KEY);
  return typeof bag[SESSION_KEY] === "string" ? bag[SESSION_KEY] : null;
}

export async function savePlainKey(apiKey: string): Promise<void> {
  await chrome.storage.local.set({ [SECRET_KEY]: { plain: apiKey } });
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function saveEncryptedKey(apiKey: string, passphrase: string): Promise<void> {
  const cipher = await encryptString(apiKey, passphrase);
  await chrome.storage.local.set({ [SECRET_KEY]: { cipher } });
  await chrome.storage.session.set({ [SESSION_KEY]: apiKey });
}

export async function unlockKey(passphrase: string): Promise<boolean> {
  const secret = await readSecret();
  if (!secret.cipher) return false;
  try {
    const apiKey = await decryptString(secret.cipher, passphrase);
    await chrome.storage.session.set({ [SESSION_KEY]: apiKey });
    return true;
  } catch {
    return false;
  }
}

export async function clearApiKey(): Promise<void> {
  await chrome.storage.local.remove(SECRET_KEY);
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function keyStatus(): Promise<"missing" | "plain" | "locked" | "unlocked"> {
  const secret = await readSecret();
  if (secret.cipher) return (await currentApiKey()) ? "unlocked" : "locked";
  if (secret.plain) return "plain";
  return "missing";
}
