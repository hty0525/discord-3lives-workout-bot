function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("16진수 문자열 길이가 올바르지 않습니다.");
  }

  const bytes = new Uint8Array(hex.length / 2) as Uint8Array<ArrayBuffer>;

  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(value)) {
      throw new Error("16진수 문자열 형식이 올바르지 않습니다.");
    }
    bytes[index] = value;
  }

  return bytes;
}

export async function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!signatureHex || !timestamp || !publicKeyHex) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const data = new TextEncoder().encode(timestamp + rawBody);

    return await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      hexToBytes(signatureHex),
      data,
    );
  } catch {
    return false;
  }
}
