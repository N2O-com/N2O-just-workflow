import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://localhost:4001/activity", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  // Screenshot 1: Initial state (should be scrolled to bottom / latest)
  await page.screenshot({ path: "/tmp/activity-1-initial.png", fullPage: false });
  console.log("Saved: /tmp/activity-1-initial.png");

  // Scroll to top to see collapsed overview
  const feed = page.locator("#activity-feed");
  await feed.evaluate((el) => el.scrollTop = 0);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/activity-2-top.png", fullPage: false });
  console.log("Saved: /tmp/activity-2-top.png");

  // Try expand all
  const expandBtn = page.getByText("expand all");
  if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/tmp/activity-3-expanded.png", fullPage: false });
    console.log("Saved: /tmp/activity-3-expanded.png");

    // Scroll to bottom to see newest sessions
    await feed.evaluate((el) => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "/tmp/activity-4-bottom.png", fullPage: false });
    console.log("Saved: /tmp/activity-4-bottom.png");
  } else {
    console.log("No expand button found — page may be empty or loading");
  }

  // Click "latest" button if it exists
  const latestBtn = page.getByText("latest", { exact: true });
  if (await latestBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    // First collapse all
    const collapseBtn = page.getByText("collapse all");
    if (await collapseBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await collapseBtn.click();
      await page.waitForTimeout(500);
    }
    await latestBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "/tmp/activity-5-latest.png", fullPage: false });
    console.log("Saved: /tmp/activity-5-latest.png");
  }

  // Metrics
  const text = await page.textContent("body") || "";
  console.log("\n--- Analysis ---");
  console.log("Has 'No sessions':", text.includes("No sessions"));
  console.log("Has 'YOU':", text.includes("YOU"));
  console.log("Has 'CLAUDE':", text.includes("CLAUDE"));
  console.log("Session count text:", text.match(/\d+ sessions?/)?.[0] || "none");
  console.log("Date headers:", (text.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \w+ \d+/g) || []).join(" | "));

  await browser.close();
}

main().catch(console.error);
