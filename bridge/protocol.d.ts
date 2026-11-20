export function encodeFrame(message: unknown): Buffer;
export function decodeFrames(buffer: Buffer): { messages: unknown[]; rest: Buffer };
