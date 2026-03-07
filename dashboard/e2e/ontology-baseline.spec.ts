import { test, expect } from "@playwright/test";

const SCREENSHOT_DIR = "e2e/screenshots/ontology-baseline";

test.describe("Ontology page baseline screenshots", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to ontology and wait for schema to load
    await page.goto("/ontology");
    // Wait for the "Ontology Explorer" header to confirm page rendered
    await page.locator("h1:has-text('Ontology Explorer')").waitFor({ timeout: 15000 });
    // Wait for nodes to appear (schema loaded) — the type count badge
    await page.locator("text=/\\d+ types/").waitFor({ timeout: 15000 });
  });

  test("graph view (default)", async ({ page }) => {
    // Default view is graph — wait for canvas to be present
    await page.locator("canvas").waitFor({ timeout: 10000 });
    // Small delay for force layout to stabilize
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/01-graph-view.png`,
      fullPage: true,
    });
  });

  test("list view", async ({ page }) => {
    // Click the list view toggle (LayoutGrid icon button)
    await page.locator("button[title='List view']").click();
    // Wait for card grid to appear
    await page.locator(".grid").waitFor({ timeout: 5000 });
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/02-list-view.png`,
      fullPage: true,
    });
  });

  test("detail panel open", async ({ page }) => {
    // In graph view, we need to click a node — use the sidebar type list instead
    // Click first type in the sidebar to open detail panel
    const firstType = page.locator("[class*='sidebar'] >> text=Task").first();
    // Fallback: click any type name in the left sidebar's type list
    const sidebarType = page.locator("div.ml-5 div[class*='cursor-pointer']").first();
    if (await firstType.isVisible()) {
      await firstType.click();
    } else {
      await sidebarType.click();
    }
    // Wait for detail panel header to appear
    await page.locator("h2").waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/03-detail-panel.png`,
      fullPage: true,
    });
  });

  test("category filter active", async ({ page }) => {
    // Click a category header in the left sidebar (e.g., "Core")
    const coreCategory = page.locator("text=Core").first();
    await coreCategory.click();
    // Wait for filter badge to appear in header bar
    await page.locator("button:has-text('Core')").waitFor({ timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/04-category-filter.png`,
      fullPage: true,
    });
  });
});
