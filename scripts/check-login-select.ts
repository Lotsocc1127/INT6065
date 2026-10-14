/** 临时复现脚本：登录页 Select 鼠标点击是否能打开下拉 */
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000); // 等 dev 编译与 hydration

  // 鼠标点击触发
  await page.click('[role="combobox"]');
  await page.waitForTimeout(600);
  const openAfterClick = await page.evaluate(() => Boolean(document.querySelector('[role="listbox"]')));
  console.log("鼠标点击后下拉是否打开:", openAfterClick);

  if (!openAfterClick) {
    // 再点一次看状态
    await page.click('[role="combobox"]');
    await page.waitForTimeout(600);
    console.log("第二次点击后下拉是否打开:", await page.evaluate(() => Boolean(document.querySelector('[role="listbox"]'))));
    // 键盘打开对比
    await page.keyboard.press("Escape");
    await page.click("body", { position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);
    await page.focus('[role="combobox"]');
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    console.log("键盘 Enter 后下拉是否打开:", await page.evaluate(() => Boolean(document.querySelector('[role="listbox"]'))));
  }

  if (!openAfterClick) process.exitCode = 1;
  await browser.close();
}

main().catch((e) => {
  console.error("复现失败:", e);
  process.exit(1);
});
