import { expect, test } from "@playwright/test";

test("both mission planners remain usable at a normal desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await expect(page.getByText("React dashboard · v0.4.1", { exact: false })).toBeVisible();
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

test("Mission Control gives transfer-window cards the full panel body", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/");
  await page.getByTitle("Dashboard developer controls").click();
  await page.getByLabel("Telemetry fixture").getByRole("button", { name: "inactive" }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();

  const panel = page.locator(".overview-transfer-windows");
  const header = panel.locator(".overview-section-head");
  const body = panel.locator(".transfer-window-body");
  const grid = panel.locator(".overview-transfer-grid");
  await expect(header.getByRole("button", { name: "Refresh windows" })).toBeVisible();
  await expect(panel.locator(".transfer-window-toolbar")).toHaveCount(0);

  const layout = await panel.evaluate((element) => {
    const panelHeader = element.querySelector<HTMLElement>(".overview-section-head")!;
    const panelBody = element.querySelector<HTMLElement>(".transfer-window-body")!;
    const cardGrid = element.querySelector<HTMLElement>(".overview-transfer-grid")!;
    return {
      panelClientWidth: element.clientWidth,
      panelScrollWidth: element.scrollWidth,
      headerClientWidth: panelHeader.clientWidth,
      headerScrollWidth: panelHeader.scrollWidth,
      bodyWidth: panelBody.getBoundingClientRect().width,
      gridWidth: cardGrid.getBoundingClientRect().width,
    };
  });
  expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth + 1);
  expect(layout.headerScrollWidth).toBeLessThanOrEqual(layout.headerClientWidth + 1);
  expect(Math.abs(layout.bodyWidth - layout.gridWidth)).toBeLessThanOrEqual(1);
  await expect(body).toBeVisible();
  await expect(grid).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowHeader = await header.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(narrowHeader.scrollWidth).toBeLessThanOrEqual(narrowHeader.clientWidth + 1);
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
