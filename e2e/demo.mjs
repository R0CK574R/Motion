// End-to-end test: drives a real browser against the real stack.
//
// It expects the frontend on APP_URL (default http://localhost:5173) with the
// API, Postgres and the risk engine running behind it. CI starts all of them;
// see .github/workflows/ci.yml. Exits non-zero on the first failed step.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const TIMEOUT = 60_000;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// The logo intro plays once per session; mark it seen so the test starts on the app.
await context.addInitScript(() => {
  try { sessionStorage.setItem("motion:intro-seen", "1"); } catch { /* storage unavailable */ }
});
const page = await context.newPage();
page.setDefaultTimeout(TIMEOUT);

const problems = [];
page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
page.on("console", (msg) => {
  // Expected: the 401 from the first session check, and the 422 this test provokes on purpose.
  if (msg.type() === "error" && !/status of (401|422)/.test(msg.text())) {
    problems.push(`console error: ${msg.text()}`);
  }
});

let stepNumber = 0;
async function step(name, fn) {
  stepNumber += 1;
  process.stdout.write(`${stepNumber}. ${name} ... `);
  await fn();
  console.log("ok");
}

const cash = () => page.getByTestId("cash-balance");
const expectCash = (text) => cash().filter({ hasText: text }).waitFor();
const position = (ticker) => page.getByTestId(`position-${ticker}`);

async function record(type, fields) {
  await page.getByRole("button", { name: type, exact: true }).click();
  for (const [label, value] of Object.entries(fields)) {
    await page.getByLabel(label, { exact: true }).fill(String(value));
  }
  await page.getByRole("button", { name: `Record ${type.toLowerCase()}` }).click();
}

try {
  await step("open the app and start the demo", async () => {
    await page.goto(APP_URL);
    await page.getByText("View demo — no signup").click();
    await page.getByText("You're viewing a demo portfolio").waitFor();
  });

  await step("demo portfolio is seeded through the ledger", async () => {
    await expectCash("$6,500.00");
    for (const ticker of ["VOO", "MSFT", "AAPL", "COST", "AMZN", "NVDA", "JNJ"]) {
      await position(ticker).waitFor();
    }
    await page.getByText("$69,065").first().waitFor();
    await page.getByText("Books balance").waitFor();
  });

  await step("risk section is served by the C++ engine", async () => {
    await page.getByText("Where the risk comes from").waitFor();
    await page.getByText("2008 financial crisis").waitFor();
  });

  await step("deposit cash", async () => {
    await record("Deposit", { Amount: 1000 });
    await expectCash("$7,500.00");
  });

  await step("buy shares", async () => {
    await record("Buy", { Ticker: "jpm", Shares: 2, Price: 250 });
    await expectCash("$7,000.00");
    await position("JPM").waitFor();
    await page.getByText("Bought 2 JPM at $250.00").first().waitFor();
  });

  await step("the journal shows the debit and credit entries", async () => {
    await page.getByLabel("Show entries for Bought 2 JPM at $250.00").click();
    await page.getByText("Securities · JPM").waitFor();
    await page.getByText("Books balance").waitFor();
  });

  await step("selling more than is held is refused", async () => {
    await record("Sell", { Ticker: "JPM", Shares: 5, Price: 250 });
    await page.getByRole("alert").filter({ hasText: "fewer than this sale" }).waitFor();
    await expectCash("$7,000.00");
  });

  await step("reverse the buy", async () => {
    await page.getByLabel("Reverse: Bought 2 JPM at $250.00").click();
    await expectCash("$7,500.00");
    await position("JPM").waitFor({ state: "detached" });
    await page.getByText("reversed").first().waitFor();
  });

  await step("update a price", async () => {
    const price = page.getByLabel("Current price of NVDA");
    await price.fill("150");
    await price.blur();
    // 69,065 + 1,000 deposited + 40 NVDA shares x $12 more each.
    await page.getByText("$70,545").first().waitFor();
  });

  await step("the session survives a page reload", async () => {
    await page.reload();
    await expectCash("$7,500.00");
    await page.getByText("$70,545").first().waitFor();
  });

  if (problems.length) {
    throw new Error(`browser reported problems:\n  ${problems.join("\n  ")}`);
  }
  console.log("\nAll steps passed.");
} catch (err) {
  console.log("FAILED");
  console.error(`\n${err.stack || err}`);
  if (problems.length) console.error(`\nBrowser problems:\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} finally {
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/dashboard.png", fullPage: true }).catch(() => {});
  await browser.close();
}
