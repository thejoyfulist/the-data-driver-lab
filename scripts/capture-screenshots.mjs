// Capture README screenshots from a running Lab: node scripts/capture-screenshots.mjs http://127.0.0.1:3000 docs/screenshots lab
import { chromium } from "@playwright/test";
const [base, out, label] = process.argv.slice(2);
const browser = await chromium.launch();
const errors = [];
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: name === "mobile" ? 2 : 1 });
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
  const res = await page.goto(base + "/", { waitUntil: "networkidle", timeout: 90_000 });
  await page.locator("[data-lab-hydrated=true]").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${label}-${name}-hero.png` });
  if (name === "desktop") {
    await page.screenshot({ path: `${out}/${label}-${name}-full.png`, fullPage: true });
    // Keep the sticky header out of element captures.
    await page.addStyleTag({ content: "body > header { position: static !important; }" });
    for (const view of ["lab-pace", "lab-championship", "lab-strategy"]) {
      const section = page.locator(`#${view}`).first();
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
      await section.screenshot({ path: `${out}/${label}-${view}.png` });
    }
    const text = await page.locator("main").innerText();
    console.log("status", res?.status(), "chars", text.length, "csp-violations", errors.filter(e=>/Content Security Policy/i.test(e)).length);
  }
  await page.close();
}
console.log(errors.length ? errors.join("\n") : "no page errors");
await browser.close();
