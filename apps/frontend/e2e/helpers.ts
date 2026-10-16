import { expect, type Page } from "@playwright/test";
import JSZip from "jszip";

let counter = 0;
/** Pseudo unique par exécution : le CTFd simulé garde son état tant que le serveur tourne. */
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`.slice(0, 30);
}

export async function login(page: Page, username: string, role: "player" | "manager" | "admin" = "player") {
  if (!page.url().includes("/login")) await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Pseudo").fill(username);
  await page.getByLabel("Rôle").selectOption(role);
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
}

export async function challengeZip(yml: string, files: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("challenge.yml", yml);
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}
