import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "@/lib/bff";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

afterEach(() => vi.unstubAllEnvs());

describe("clientIp (chaîne edge -> Traefik cluster -> BFF)", () => {
  it("prend l'IP ajoutée par l'edge, pas la première entrée forgeable", () => {
    // Le client envoie XFF: 6.6.6.6 ; l'edge écrase puis le Traefik du cluster ajoute l'IP de l'edge.
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.20.20.10" }))).toBe("203.0.113.7");
    // Un XFF forgé qui survivrait en tête ne change pas le résultat.
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.20.20.10" }))).toBe("203.0.113.7");
  });

  it("respecte PAD_TRUSTED_PROXY_HOPS", () => {
    vi.stubEnv("PAD_TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.20.20.9, 10.20.20.10" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.20.20.10" }), 0)).toBe("10.20.20.10");
  });

  it("valeurs non IP ou absentes : unknown (pas de clé de limiteur arbitraire)", () => {
    expect(clientIp(req({ "x-forwarded-for": "pas-une-ip, 10.20.20.10" }))).toBe("unknown");
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });
});
