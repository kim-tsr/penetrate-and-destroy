import JSZip from "jszip";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { challengeYmlSchema, formatIssues, type ChallengeYml, type YmlIssue } from "./schema";

export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
/** Mêmes plafonds que le plugin manager_api (PAD_IMPORT_MAX_ENTRIES / PAD_IMPORT_MAX_YAML_BYTES). */
export const MAX_ENTRIES = 200;
export const MAX_YAML_BYTES = 256 * 1024;
const MANIFEST_NAMES = ["challenge.yml", "challenge.yaml"];

export interface ZipPreview {
  ok: boolean;
  manifestPath: string | null;
  challenge: ChallengeYml | null;
  issues: YmlIssue[];
  /** Fichiers déclarés dans `files:` absents de l'archive. */
  missingFiles: string[];
  entries: string[];
}

function fail(issues: YmlIssue[], entries: string[] = [], manifestPath: string | null = null): ZipPreview {
  return { ok: false, manifestPath, challenge: null, issues, missingFiles: [], entries };
}

/**
 * Analyse un ZIP de challenge (navigateur ou serveur) : trouve le manifeste à la racine ou dans
 * un unique dossier de premier niveau, le parse et le valide, vérifie la présence des fichiers.
 */
export async function inspectChallengeZip(data: ArrayBuffer | Uint8Array | Blob): Promise<ZipPreview> {
  const size = data instanceof Blob ? data.size : data.byteLength;
  if (size > MAX_ZIP_BYTES) return fail([{ path: "(archive)", message: "archive trop volumineuse (50 Mo max)" }]);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return fail([{ path: "(archive)", message: "le fichier n'est pas un ZIP valide" }]);
  }

  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith("__MACOSX/"))
    .map((f) => f.name);

  if (entries.length > MAX_ENTRIES) {
    return fail([{ path: "(archive)", message: `trop d'entrées (${MAX_ENTRIES} maximum)` }], entries.slice(0, 20));
  }

  const unsafe = entries.find((n) => n.startsWith("/") || n.includes("\\") || /^[A-Za-z]:/.test(n) || n.split("/").includes(".."));
  if (unsafe) return fail([{ path: "(archive)", message: `chemin interdit dans l'archive : ${unsafe}` }], entries);

  const manifestPath =
    entries.find((n) => MANIFEST_NAMES.includes(n)) ??
    entries.find((n) => {
      const parts = n.split("/");
      return parts.length === 2 && MANIFEST_NAMES.includes(parts[1] ?? "");
    }) ??
    null;
  if (!manifestPath) {
    return fail([{ path: "(archive)", message: "challenge.yml introuvable à la racine de l'archive" }], entries);
  }
  const root = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1) : "";

  const manifest = zip.file(manifestPath)!;
  // Taille décompressée déclarée dans l'en-tête ZIP (champ interne de JSZip) : refuse avant de décompresser.
  const declared = (manifest as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (declared !== undefined && declared > MAX_YAML_BYTES) {
    return fail([{ path: manifestPath, message: "challenge.yml trop volumineux (256 Kio max)" }], entries, manifestPath);
  }
  const text = await manifest.async("string");
  if (text.length > MAX_YAML_BYTES) {
    return fail([{ path: manifestPath, message: "challenge.yml trop volumineux (256 Kio max)" }], entries, manifestPath);
  }
  let doc: unknown;
  try {
    doc = parseYaml(text, { maxAliasCount: 50 });
  } catch (err) {
    const msg = err instanceof YAMLParseError ? err.message.split("\n")[0]! : "YAML illisible";
    return fail([{ path: manifestPath, message: msg }], entries, manifestPath);
  }

  const res = challengeYmlSchema.safeParse(doc);
  if (!res.success) return fail(formatIssues(res.error), entries, manifestPath);

  const present = new Set(entries);
  const missingFiles = res.data.files.filter((f) => !present.has(root + f.replace(/^\.\//, "")));
  const issues = missingFiles.map((f) => ({ path: "files", message: `fichier absent de l'archive : ${f}` }));

  return { ok: issues.length === 0, manifestPath, challenge: res.data, issues, missingFiles, entries };
}
