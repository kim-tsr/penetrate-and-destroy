import { test } from "@playwright/test";
import { login, uniqueName } from "./helpers";

/**
 * Captures de revue visuelle (pnpm screenshots) : écrites dans test-results/screens, ignorées par Git.
 * Désactivé par défaut dans `pnpm e2e` (variable SCREENSHOTS=1 requise).
 */
test.skip(!process.env.SCREENSHOTS, "SCREENSHOTS=1 requis");
test.use({ viewport: { width: 1360, height: 900 } });

const out = (name: string) => `test-results/screens/${name}.png`;

test("captures", async ({ page }) => {
  await page.goto("/");
  await page.screenshot({ path: out("01-landing"), fullPage: true });
  await page.goto("/login");
  await page.screenshot({ path: out("02-login") });
  await page.goto("/scoreboard");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("03-scoreboard-public"), fullPage: true });

  await login(page, uniqueName("shot"), "manager");
  await page.screenshot({ path: out("04-dashboard"), fullPage: true });
  await page.goto("/challenges");
  await page.screenshot({ path: out("05-challenges"), fullPage: true });
  await page.goto("/challenges/3");
  await page.screenshot({ path: out("06-challenge"), fullPage: true });
  await page.goto("/ranking");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out("07-ranking"), fullPage: true });
  await page.goto("/manage");
  await page.screenshot({ path: out("08-manage"), fullPage: true });
  await page.goto("/manage/import");
  await page.screenshot({ path: out("09-import"), fullPage: true });
  await page.goto("/manage/challenges/1");
  await page.screenshot({ path: out("10-stats"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/challenges");
  await page.screenshot({ path: out("11-mobile-challenges"), fullPage: true });
});
