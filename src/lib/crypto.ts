export interface CipherBlob {
  salt: string;
  iv: string;
  ct: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encryptString(plaintext: string, passphrase: string): Promise<CipherBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBytes(iv) }, key, asBytes(textEncoder.encode(plaintext)));
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(cipher)) };
}

export async function decryptString(blob: CipherBlob, passphrase: string): Promise<string> {
  const salt = fromB64(blob.salt);
  const iv = fromB64(blob.iv);
  const key = await deriveKey(passphrase, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asBytes(iv) }, key, asBytes(fromB64(blob.ct)));
  return textDecoder.decode(plain);
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", textEncoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asBytes(salt), iterations: 120_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function asBytes(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
