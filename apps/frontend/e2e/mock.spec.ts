import { expect, test } from "@playwright/test";
import { challengeZip, login, uniqueName } from "./helpers";

test.describe("authentification et rôles", () => {
  test("redirige vers /login, connecte un joueur et masque le portail manager", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    await login(page, uniqueName("joueur"));
    await expect(page.getByRole("link", { name: "Import ZIP" })).toHaveCount(0);
    const res = await page.goto("/manage");
    expect(res?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
  });

  test("déconnexion", async ({ page }) => {
    await login(page, uniqueName("sortie"));
    await page.getByRole("button", { name: "Déconnexion" }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("pages publiques accessibles sans session", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Destroy");
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Règles de l'opération" })).toBeVisible();
  });
});

test.describe("flags", () => {
  test("flag incorrect puis correct, progression mise à jour", async ({ page }) => {
    await login(page, uniqueName("flag"));
    await page.getByRole("link", { name: /Challenges/ }).first().click();
    await expect(page.getByTestId("progress")).toContainText("0 / 5");
    await page.getByRole("link", { name: /Hello Operator/ }).click();

    await page.getByLabel("Flag").fill("PAD{mauvais}");
    await page.getByRole("button", { name: "Soumettre" }).click();
    await expect(page.getByTestId("flag-result")).toContainText("Incorrect");

    await page.getByLabel("Flag").fill("PAD{hello_operator}");
    await page.getByRole("button", { name: "Soumettre" }).click();
    await expect(page.getByTestId("solved-banner")).toBeVisible();

    await page.goto("/challenges");
    await expect(page.getByTestId("progress")).toContainText("1 / 5");
  });

  test("le first blood de chaque challenge est affiché dans la grille et le détail", async ({ page }) => {
    await login(page, uniqueName("fb"));
    await page.goto("/challenges");
    const hello = page.getByRole("link", { name: /Hello Operator/ });
    await expect(hello.getByTestId("first-blood")).toContainText("Red Pandas");
    await expect(page.getByRole("link", { name: /ret2win/ }).getByTestId("first-blood")).toHaveCount(0);
    await hello.click();
    await expect(page).toHaveURL(/\/challenges\/\d+$/);
    await expect(page.getByTestId("first-blood")).toContainText("Red Pandas");
    await expect(page.getByTestId("first-blood")).toContainText("ada");
  });

  test("un joueur voit l'état de l'événement modifié par un manager (pad/event)", async ({ page, browser }) => {
    await login(page, uniqueName("spectateur"));
    await expect(page.getByText("En cours").first()).toBeVisible();
    const mgrCtx = await browser.newContext();
    const mgr = await mgrCtx.newPage();
    try {
      await login(mgr, uniqueName("mgr"), "manager");
      await mgr.goto("/manage/event");
      await mgr.getByRole("button", { name: "Mettre en pause" }).click();
      await expect(mgr.getByTestId("event-state")).toContainText("En pause");
      await page.reload();
      await expect(page.getByText("En pause").first()).toBeVisible();
    } finally {
      await mgr.goto("/manage/event");
      const resume = mgr.getByRole("button", { name: "Reprendre l'événement" });
      if (await resume.count()) await resume.click();
      await mgrCtx.close();
    }
  });

  test("la validation zod refuse un flag vide côté API", async ({ page, request }) => {
    await login(page, uniqueName("zod"));
    const cookies = await page.context().cookies();
    const res = await request.post("/api/challenges/1/attempt", {
      data: { submission: "" },
      headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "), Origin: "http://localhost:3100" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("scoreboard", () => {
  test("scoreboard public sans connexion", async ({ page }) => {
    await page.goto("/scoreboard");
    await expect(page.getByRole("heading", { name: "Scoreboard" })).toBeVisible();
    await expect(page.getByTestId("scoreboard-row").filter({ hasText: "Red Pandas" })).toBeVisible();
    await expect(page.getByTestId("scoreboard-status")).toContainText("direct");
  });

  test("le classement se met à jour en direct après une résolution", async ({ page }) => {
    const name = uniqueName("live");
    await login(page, name);
    await page.goto("/ranking");
    await expect(page.getByTestId("scoreboard-status")).toContainText("direct");
    await expect(page.getByTestId("scoreboard-row").filter({ hasText: name })).toHaveCount(0);

    // Résolution via le BFF dans le même contexte, la page /ranking reste ouverte.
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/challenges/1/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission: "PAD{hello_operator}" }),
      });
      return res.status;
    });
    expect(status).toBe(200);
    await expect(page.getByTestId("scoreboard-row").filter({ hasText: name })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("instances", () => {
  test("une équipe lance, prolonge puis arrête son instance", async ({ page }) => {
    const name = uniqueName("team");
    await login(page, name);
    await page.goto("/team");
    await page.locator("#create-name").fill(`Equipe ${name}`);
    await page.locator("#create-password").fill("motdepasse-equipe");
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Equipe ${name}` })).toBeVisible();

    await page.goto("/challenges/3");
    await page.getByRole("button", { name: "Lancer l'instance" }).click();
    await expect(page.getByTestId("connection-info")).toContainText("10.20.70.");
    await expect(page.getByText(/connecté à NetBird/)).toBeVisible();
    await page.getByRole("button", { name: "Prolonger" }).click();
    await expect(page.getByText("Prolongations : 1 / 3")).toBeVisible();
    await page.getByRole("button", { name: "Arrêter" }).click();
    await expect(page.getByRole("button", { name: "Lancer l'instance" })).toBeVisible();
  });
});

test.describe("portail manager", () => {
  const YAML = (name: string) => `name: ${name}
author: orgas
category: web
description: |
  Challenge créé par le test e2e.
value: 123
flags:
  - PAD{e2e_${name.replace(/\W/g, "_")}}
files:
  - notes.txt
tags: [e2e]
state: visible
`;

  test("import d'un ZIP valide : aperçu, import, présence dans la liste", async ({ page }) => {
    const name = uniqueName("Import");
    await login(page, uniqueName("mgr"), "manager");
    await page.getByRole("link", { name: "Import ZIP" }).first().click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "challenge.zip",
      mimeType: "application/zip",
      buffer: await challengeZip(YAML(name), { "notes.txt": "hello" }),
    });
    await expect(page.getByTestId("import-preview")).toContainText("valide");
    await expect(page.getByTestId("import-preview")).toContainText(name);
    await page.getByRole("button", { name: "Importer dans CTFd" }).click();
    await expect(page.getByTestId("import-success")).toContainText("Challenge créé");

    await page.goto("/manage/challenges");
    await expect(page.getByRole("link", { name })).toBeVisible();
  });

  test("un ZIP invalide est refusé avec le détail des erreurs", async ({ page }) => {
    await login(page, uniqueName("mgr"), "manager");
    await page.goto("/manage/import");
    await page.locator('input[type="file"]').setInputFiles({
      name: "bad.zip",
      mimeType: "application/zip",
      buffer: await challengeZip("name: Sans flag\ncategory: web\ndescription: x\nvalue: 10\nflags: []\n"),
    });
    await expect(page.getByTestId("import-preview")).toContainText("invalide");
    await expect(page.getByTestId("import-preview")).toContainText("au moins un flag");
    await expect(page.getByRole("button", { name: "Importer dans CTFd" })).toBeDisabled();
  });

  test("un manager gère l'événement (pause)", async ({ page }) => {
    await login(page, uniqueName("mgr"), "manager");
    await page.goto("/manage/event");
    await expect(page.getByTestId("event-state")).toContainText("En cours");
    await page.getByRole("button", { name: "Mettre en pause" }).click();
    await expect(page.getByTestId("event-state")).toContainText("En pause");
    await page.getByRole("button", { name: "Reprendre l'événement" }).click();
    await expect(page.getByTestId("event-state")).toContainText("En cours");
  });

  test("modération par un manager (sans droits admin) : bannir puis débannir un joueur", async ({ page, browser }) => {
    const victim = uniqueName("cible");
    const playerCtx = await browser.newContext();
    const playerPage = await playerCtx.newPage();
    await login(playerPage, victim);

    await login(page, uniqueName("mgr"), "manager");
    await page.goto(`/manage/moderation?q=${victim}`);
    const row = page.getByRole("row", { name: new RegExp(victim) });
    await expect(row).toContainText("actif");
    await row.getByRole("button", { name: "Bannir" }).click();
    await expect(row).toContainText("banni");
    await row.getByRole("button", { name: "Débannir" }).click();
    await expect(row).toContainText("actif");
    await playerCtx.close();
  });

  test("invalidation d'un solve depuis la modération", async ({ page }) => {
    await login(page, uniqueName("mgr"), "manager");
    await page.goto("/manage/moderation");
    const solves = page.getByRole("table", { name: "Résolutions récentes" });
    const rows = solves.getByRole("row");
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);
    page.once("dialog", (d) => void d.accept());
    await rows.first().getByRole("button", { name: "Invalider" }).click();
    await expect(rows).toHaveCount(before - 1);
  });

  test("statistiques d'un challenge", async ({ page }) => {
    await login(page, uniqueName("mgr"), "manager");
    await page.goto("/manage/challenges");
    await page.getByRole("link", { name: "Hello Operator" }).click();
    await expect(page.getByRole("heading", { name: "Hello Operator" })).toBeVisible();
    await expect(page.getByText("First blood").first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Résolutions cumulées/ })).toBeVisible();
  });
});

test.describe("sondes", () => {
  test("/api/health et /api/metrics (pad_frontend_active_sessions)", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    expect((await health.json()).status).toBe("ok");
    const metrics = await request.get("/api/metrics");
    expect(metrics.status()).toBe(200);
    expect(await metrics.text()).toContain("pad_frontend_active_sessions");
  });

  test("en-têtes de sécurité et CSP à nonce", async ({ request }) => {
    const res = await request.get("/login");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });
});
