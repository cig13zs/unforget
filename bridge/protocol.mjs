export function encodeFrame(message) {
  const json = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset);
    if (length < 0 || length > 1024 * 1024) {
      throw new Error("Native message is larger than 1MB.");
    }
    if (buffer.length - offset < 4 + length) break;
    const json = buffer.subarray(offset + 4, offset + 4 + length).toString("utf8");
    messages.push(JSON.parse(json));
    offset += 4 + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}
