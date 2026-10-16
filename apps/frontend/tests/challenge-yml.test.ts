import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { inspectChallengeZip } from "@/lib/challenge-yml/parse-zip";
import { challengeYmlSchema, describeScoring, ttlSchema } from "@/lib/challenge-yml/schema";

const CHALLENGES = path.resolve(import.meta.dirname, "../../../challenges");

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

const OK = "name: Test\ncategory: web\ndescription: d\nvalue: 10\nflags:\n  - PAD{x}\n";

describe("schéma challenge.yml", () => {
  it("accepte les 3 challenges d'exemple du dépôt", () => {
    const dirs = readdirSync(CHALLENGES, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "schema");
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    for (const d of dirs) {
      const doc = parse(readFileSync(path.join(CHALLENGES, d.name, "challenge.yml"), "utf8"));
      const res = challengeYmlSchema.safeParse(doc);
      expect(res.success, `${d.name} : ${res.success ? "" : JSON.stringify(res.error.issues)}`).toBe(true);
    }
  });
  it("convertit les durées de TTL", () => {
    expect(ttlSchema.parse("30m")).toBe(1800);
    expect(ttlSchema.parse("2h")).toBe(7200);
    expect(ttlSchema.parse("90s")).toBe(90);
    expect(ttlSchema.parse(3600)).toBe(3600);
    expect(ttlSchema.safeParse("10s").success).toBe(false);
    expect(ttlSchema.safeParse("7h").success).toBe(false);
    expect(ttlSchema.safeParse("demain").success).toBe(false);
  });
  it("exige value, ou extra pour le scoring dynamique", () => {
    expect(challengeYmlSchema.safeParse({ name: "a", category: "c", description: "d", flags: ["f"] }).success).toBe(false);
    const dyn = challengeYmlSchema.safeParse({ name: "a", category: "c", description: "d", flags: ["f"], type: "dynamic", extra: { initial: 500, decay: 20, minimum: 100 } });
    expect(dyn.success).toBe(true);
    if (dyn.success) expect(describeScoring(dyn.data)).toContain("500 → 100");
    expect(challengeYmlSchema.safeParse({ name: "a", category: "c", description: "d", flags: ["f"], type: "dynamic" }).success).toBe(false);
  });
  it("refuse une image sans registry, un bloc instance inconnu et zéro flag", () => {
    const base = { name: "a", category: "c", description: "d", value: 1, flags: ["f"] };
    expect(challengeYmlSchema.safeParse({ ...base, instance: { image: "nginx", ports: [80] } }).success).toBe(false);
    expect(challengeYmlSchema.safeParse({ ...base, instance: { image: "registry.example.test/a/b:1", ports: [80], privileged: true } }).success).toBe(false);
    expect(challengeYmlSchema.safeParse({ ...base, flags: [] }).success).toBe(false);
  });
});

describe("analyse de l'archive", () => {
  it("accepte un manifeste à la racine ou dans un dossier unique", async () => {
    expect((await inspectChallengeZip(await zipOf({ "challenge.yml": OK }))).ok).toBe(true);
    const nested = await inspectChallengeZip(await zipOf({ "chal/challenge.yml": OK + "files:\n  - a.txt\n", "chal/a.txt": "x" }));
    expect(nested.ok).toBe(true);
    expect(nested.challenge?.name).toBe("Test");
  });
  it("signale un fichier déclaré absent", async () => {
    const r = await inspectChallengeZip(await zipOf({ "challenge.yml": OK + "files:\n  - manquant.bin\n" }));
    expect(r.ok).toBe(false);
    expect(r.missingFiles).toEqual(["manquant.bin"]);
  });
  it("refuse un ZIP sans manifeste, illisible ou au YAML invalide", async () => {
    expect((await inspectChallengeZip(await zipOf({ "a.txt": "x" }))).issues[0]?.message).toMatch(/introuvable/);
    expect((await inspectChallengeZip(new TextEncoder().encode("pas un zip"))).issues[0]?.message).toMatch(/pas un ZIP/);
    expect((await inspectChallengeZip(await zipOf({ "challenge.yml": "a: [unclosed" }))).ok).toBe(false);
  });
  it("ne laisse passer aucun chemin d'évasion (zip-slip)", async () => {
    // JSZip neutralise déjà `../` au chargement ; chemin absolu, antislash et lecteur sont refusés par notre garde.
    const safe = (e: string) => !e.startsWith("/") && !e.split("/").includes("..");
    const slip = await inspectChallengeZip(await zipOf({ "challenge.yml": OK, "../evil.txt": "x" }));
    expect(slip.ok === false || slip.entries.every(safe)).toBe(true);
    for (const bad of ["/etc/passwd", "a\\b.txt", "C:evil.txt"]) {
      const r = await inspectChallengeZip(await zipOf({ "challenge.yml": OK, [bad]: "x" }));
      expect(r.ok, bad).toBe(false);
      expect(r.issues[0]?.message).toMatch(/chemin interdit/);
    }
  });
  it("refuse un trop grand nombre d'entrées et un manifeste démesuré", async () => {
    const many: Record<string, string> = { "challenge.yml": OK };
    for (let i = 0; i < 201; i++) many[`f${i}.txt`] = "x";
    expect((await inspectChallengeZip(await zipOf(many))).issues[0]?.message).toMatch(/trop d'entrées/);
    const huge = await inspectChallengeZip(await zipOf({ "challenge.yml": OK + "# " + "a".repeat(300 * 1024) }));
    expect(huge.ok).toBe(false);
    expect(huge.issues[0]?.message).toMatch(/trop volumineux/);
  });
  it("liste les erreurs de schéma avec leur chemin", async () => {
    const r = await inspectChallengeZip(await zipOf({ "challenge.yml": "name: X\ncategory: web\ndescription: d\nvalue: 1\nflags: []\n" }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "flags")).toBe(true);
  });
});
