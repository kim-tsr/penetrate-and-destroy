import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signature des appels au plugin `sso_bridge` (apps/ctfd/API.md, section 2) :
 *
 *   X-PAD-Timestamp: epoch en secondes
 *   X-PAD-Nonce:     16 à 128 caractères ASCII, à usage unique
 *   X-PAD-Signature: hex(HMAC-SHA256(secret, "<ts>\n<nonce>\n<METHOD>\n<path>\n<sha256 hex du corps brut>"))
 *
 * Le hash porte sur les octets exacts envoyés : le corps est sérialisé une seule fois.
 */
export const SSO_TIMESTAMP_HEADER = "X-PAD-Timestamp";
export const SSO_NONCE_HEADER = "X-PAD-Nonce";
export const SSO_SIGNATURE_HEADER = "X-PAD-Signature";
/** Fenêtre de validité côté plugin (`PAD_SSO_MAX_SKEW_SECONDS`). */
export const SSO_MAX_SKEW_SECONDS = 60;

export function bodySha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function signingString(parts: {
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  body: string;
}): string {
  return [parts.timestamp, parts.nonce, parts.method.toUpperCase(), parts.path, bodySha256(parts.body)].join("\n");
}

export function signSso(
  secret: string,
  parts: { timestamp: string; nonce: string; method: string; path: string; body: string },
): string {
  return createHmac("sha256", secret).update(signingString(parts), "utf8").digest("hex");
}

export function newNonce(): string {
  return randomBytes(16).toString("hex"); // 32 caractères hexadécimaux
}

export function ssoHeaders(
  secret: string,
  req: { method: string; path: string; body: string },
  now: Date = new Date(),
  nonce: string = newNonce(),
): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    [SSO_TIMESTAMP_HEADER]: timestamp,
    [SSO_NONCE_HEADER]: nonce,
    [SSO_SIGNATURE_HEADER]: signSso(secret, { timestamp, nonce, ...req }),
  };
}

/** Vérification (mocks et tests) ; le plugin réel fait l'équivalent en Python. Les nonces rejoués sont refusés par l'appelant. */
export function verifySso(
  secret: string,
  headers: { timestamp: string | null; nonce: string | null; signature: string | null },
  req: { method: string; path: string; body: string },
  now: Date = new Date(),
): boolean {
  const { timestamp, nonce, signature } = headers;
  if (!timestamp || !nonce || !signature) return false;
  if (!/^\d+$/.test(timestamp) || !/^[\x21-\x7e]{16,128}$/.test(nonce) || !/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (skew > SSO_MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(signSso(secret, { timestamp, nonce, ...req }), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
