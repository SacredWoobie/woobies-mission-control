import { expect, test } from "@playwright/test";

test("both mission planners remain usable at a normal desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await expect(page.getByText("React dashboard · v0.4.0", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Resonant orbit planner" }).click();
  const resonantDrawer = page.getByRole("dialog", { name: "Resonant orbit planner" });
  await expect(resonantDrawer).toBeVisible();
  await expect(resonantDrawer.getByText("Resonant Orbit Plan")).toBeVisible();
  await resonantDrawer.getByRole("button", { name: "Close resonant orbit planner" }).click();

  await page.getByRole("button", { name: "Delta-v planner" }).click();
  const deltaVDrawer = page.getByRole("dialog", { name: "Delta-v planner" });
  await expect(deltaVDrawer).toBeVisible();
  await expect(deltaVDrawer.getByText("Delta-V Mission Planner")).toBeVisible();
  await expect(deltaVDrawer.getByRole("button", { name: /Add next stop/ })).toBeVisible();
});

test("planner drawers do not force horizontal overflow near the landscape breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 650 });
  await page.goto("/");
  await page.getByRole("button", { name: "Resonant orbit planner" }).click();

  const dimensions = await page.getByRole("dialog", { name: "Resonant orbit planner" }).evaluate(
    (element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }),
  );
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("native controls opt into the dark system color scheme", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("the wide Flight context header remains one compact row", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/");

  const layout = await page.locator(".status-strip").evaluate((element) => {
    const cells = Array.from(element.querySelectorAll(".flight-context-identity, .clockcell, .cs-cell"));
    const tops = cells.map((cell) => cell.getBoundingClientRect().top);
    return {
      height: element.getBoundingClientRect().height,
      maxTopDifference: Math.max(...tops) - Math.min(...tops),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });

  expect(layout.height).toBeLessThan(100);
  expect(layout.maxTopDifference).toBeLessThanOrEqual(1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
});

test("Flight staging presents both conditions without a mode toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const panel = page.locator("#stage");
  await expect(panel.getByText("Total Δv · vacuum")).toBeVisible();
  await expect(panel.getByText("Δv current")).toBeVisible();
  await expect(panel.getByText("Δv vac")).toBeVisible();
  await expect(panel.getByRole("button", { name: "CURRENT" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "VACUUM" })).toHaveCount(0);
  await expect(panel.getByText("1 unpowered stage hidden")).toBeVisible();

  const dimensions = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
