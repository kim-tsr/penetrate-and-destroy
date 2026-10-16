import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNode } from "@/instrumentation-node";

afterEach(() => vi.unstubAllEnvs());

function trapExit() {
  return vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
  }) as never);
}

describe("démarrage du serveur (instrumentation)", () => {
  it("refuse de démarrer avec PAD_MOCK=1 et NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAD_MOCK", "1");
    const exit = trapExit();
    await expect(registerNode()).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuse de démarrer en production avec une configuration invalide", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "trop-court");
    const exit = trapExit();
    await expect(registerNode()).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("accepte PAD_MOCK=1 hors production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PAD_MOCK", "1");
    const exit = trapExit();
    await expect(registerNode()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it("ne valide rien pendant `next build`", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("AUTH_SECRET", "");
    const exit = trapExit();
    await expect(registerNode()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });
});
