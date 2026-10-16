import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signSso, signingString, ssoHeaders, verifySso } from "@/lib/ctfd/sso";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-10-16T12:00:00Z");

describe("signature sso_bridge (apps/ctfd/API.md, section 2)", () => {
  it("signe <ts>\\n<nonce>\\n<METHOD>\\n<path>\\n<sha256 du corps> comme documenté", () => {
    const body = JSON.stringify({ sub: "u1", email: "a@example.org", groups: ["ctf-players"] });
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const nonce = "0123456789abcdef0123456789abcdef";
    // Recalcul indépendant, mot pour mot comme l'exemple Node de la doc.
    const msg = [ts, nonce, "POST", "/api/v1/sso/session", createHash("sha256").update(body).digest("hex")].join("\n");
    const expected = createHmac("sha256", SECRET).update(msg).digest("hex");
    const h = ssoHeaders(SECRET, { method: "post", path: "/api/v1/sso/session", body }, NOW, nonce);
    expect(h["X-PAD-Timestamp"]).toBe(ts);
    expect(h["X-PAD-Nonce"]).toBe(nonce);
    expect(h["X-PAD-Signature"]).toBe(expected);
  });

  it("le corps vide a pour hash le sha256 de la chaîne vide", () => {
    const s = signingString({ timestamp: "1", nonce: "n".repeat(16), method: "GET", path: "/p", body: "" });
    expect(s.endsWith("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(true);
  });

  it("génère un nonce différent à chaque appel (16 à 128 caractères)", () => {
    const a = ssoHeaders(SECRET, { method: "POST", path: "/x", body: "{}" }, NOW)["X-PAD-Nonce"]!;
    const b = ssoHeaders(SECRET, { method: "POST", path: "/x", body: "{}" }, NOW)["X-PAD-Nonce"]!;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a.length).toBeLessThanOrEqual(128);
  });

  const req = { method: "POST", path: "/api/v1/sso/session", body: "{}" };
  const headers = () => {
    const h = ssoHeaders(SECRET, req, NOW);
    return { timestamp: h["X-PAD-Timestamp"]!, nonce: h["X-PAD-Nonce"]!, signature: h["X-PAD-Signature"]! };
  };

  it("vérifie une signature valide", () => {
    expect(verifySso(SECRET, headers(), req, NOW)).toBe(true);
  });
  it("refuse un mauvais secret, un corps modifié ou un autre chemin", () => {
    expect(verifySso("x".repeat(40), headers(), req, NOW)).toBe(false);
    expect(verifySso(SECRET, headers(), { ...req, body: '{"a":1}' }, NOW)).toBe(false);
    expect(verifySso(SECRET, headers(), { ...req, path: "/autre" }, NOW)).toBe(false);
  });
  it("refuse une signature hors fenêtre de 60 s", () => {
    expect(verifySso(SECRET, headers(), req, new Date(NOW.getTime() + 61_000))).toBe(false);
    expect(verifySso(SECRET, headers(), req, new Date(NOW.getTime() + 59_000))).toBe(true);
  });
  it("refuse les en-têtes absents ou mal formés", () => {
    const h = headers();
    expect(verifySso(SECRET, { ...h, nonce: null }, req, NOW)).toBe(false);
    expect(verifySso(SECRET, { ...h, nonce: "court" }, req, NOW)).toBe(false);
    expect(verifySso(SECRET, { ...h, signature: "zz" }, req, NOW)).toBe(false);
  });
  it("signSso est déterministe", () => {
    const p = { timestamp: "1", nonce: "n".repeat(16), method: "POST", path: "/p", body: "{}" };
    expect(signSso(SECRET, p)).toBe(signSso(SECRET, p));
  });
});
