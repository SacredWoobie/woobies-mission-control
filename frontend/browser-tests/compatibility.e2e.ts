import { expect, test, type Locator } from "@playwright/test";

async function expectVisibleFontFloor(
  locator: Locator,
  minimum: number,
  label: string,
) {
  const result = await locator.evaluateAll((elements, floor) => {
    const visible = elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    });
    return {
      checked: visible.length,
      violations: visible
        .map((element) => ({
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
        }))
        .filter((entry) => entry.fontSize < floor),
    };
  }, minimum);

  expect(result.checked, `${label} should render at least one element`).toBeGreaterThan(0);
  expect(result.violations, `${label} should render at ${minimum}px or larger`).toEqual([]);
}

test("developer controls stay out of screenshots until the corner is engaged", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.mouse.move(640, 400);

  const tab = page.getByRole("button", { name: "DEV", exact: true });
  await expect(tab).toHaveCSS("opacity", "0");

  await page.mouse.move(4, 4);
  await expect(tab).toHaveCSS("opacity", "1");
  await page.mouse.move(640, 400);
  await expect(tab).toHaveCSS("opacity", "0");

  await tab.focus();
  await expect(tab).toHaveCSS("opacity", "1");
  await tab.click();
  await expect(page.getByRole("complementary", { name: "Dashboard developer controls" })).toBeVisible();
  await expect(tab).toHaveCSS("opacity", "1");
});

test("Settings remains the last usable Tool without horizontal overflow across the acceptance viewports", async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 889 },
    { width: 1280, height: 800 },
    { width: 1080, height: 1920 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const tools = page.getByRole("group", { name: "Tools" });
    const opener = page.getByRole("button", { name: "Settings", exact: true });
    await expect(opener).toBeVisible();
    expect(await tools.evaluate((group) => group.lastElementChild?.getAttribute("aria-label"))).toBe("Settings");

    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Mission Control Settings" });
    const navigation = drawer.getByRole("navigation", { name: "Settings sections" });
    await expect(drawer).toBeVisible();
    await expect(navigation.getByRole("button", { name: "Preferences" })).toHaveAttribute("aria-current", "page");

    for (const [section, heading] of [
      ["Features & Mods", "Features & Mods"],
      ["Help", "Help"],
      ["About", "About"],
      ["Preferences", "Preferences"],
    ]) {
      await navigation.getByRole("button", { name: section, exact: true }).click();
      await expect(drawer.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    const layout = await drawer.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(".settings-drawer-body")!;
      const navigationElement = element.querySelector<HTMLElement>(".settings-section-nav")!;
      const section = element.querySelector<HTMLElement>(".settings-section")!;
      return {
        bodyClientWidth: body.clientWidth,
        bodyOverflowX: getComputedStyle(body).overflowX,
        bodyScrollWidth: body.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        drawerClientWidth: element.clientWidth,
        drawerScrollWidth: element.scrollWidth,
        navigationOverflowX: getComputedStyle(navigationElement).overflowX,
        sectionClientWidth: section.clientWidth,
        sectionScrollWidth: section.scrollWidth,
      };
    });
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
    expect(layout.drawerScrollWidth).toBeLessThanOrEqual(layout.drawerClientWidth + 1);
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyClientWidth + 1);
    expect(layout.bodyOverflowX).toBe("hidden");
    expect(layout.sectionScrollWidth).toBeLessThanOrEqual(layout.sectionClientWidth + 1);
    if (viewport.width === 390) expect(layout.navigationOverflowX).toBe("auto");

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  }
});

test("Settings applies and persists every dashboard color theme", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Mission Control Settings" });

  for (const theme of [
    { id: "daylight-console", label: "Daylight Console", scheme: "light" },
    { id: "warm-crt", label: "Warm CRT", scheme: "dark" },
    { id: "green-phosphor", label: "Green Phosphor", scheme: "dark" },
    { id: "mission-control-dark", label: "Mission Control Dark", scheme: "dark" },
  ]) {
    const option = drawer.getByRole("radio", { name: new RegExp(theme.label) });
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
    expect(await page.locator("html").getAttribute("data-theme")).toBe(theme.id);
    expect(await page.locator("html").evaluate((root) => getComputedStyle(root).colorScheme)).toBe(theme.scheme);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("wmc-theme-v1") ?? "null"))).toBe(theme.id);
  }

  await page.reload();
  expect(await page.locator("html").getAttribute("data-theme")).toBe("mission-control-dark");
});

test("Daylight Flight chrome keeps inactive hardware quiet and exposes light Plan state roles", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");

  const litIndicator = page.locator(".annunciator-indicator.new").first();
  const darkLitFace = await litIndicator.evaluate((element) => getComputedStyle(element).backgroundImage);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Mission Control Settings" });
  await drawer.getByRole("radio", { name: /Daylight Console/ }).click();
  await page.keyboard.press("Escape");

  const inactiveIndicator = page.locator(".annunciator-indicator:not(.new):not(.acknowledged)").first();
  const flightChrome = await inactiveIndicator.evaluate((element) => {
    const root = getComputedStyle(document.documentElement);
    const inactive = getComputedStyle(element);
    const identity = getComputedStyle(document.querySelector<HTMLElement>(".flight-context-identity strong")!);
    const clock = getComputedStyle(document.querySelector<HTMLElement>(".clockcell .big")!);
    return {
      clockShadow: clock.textShadow,
      identityShadow: identity.textShadow,
      inactiveBackground: inactive.backgroundImage,
      inactiveBorder: inactive.borderColor,
      inactiveText: inactive.color,
      planGround: root.getPropertyValue("--plan-panel-ground").trim(),
      planStep: root.getPropertyValue("--plan-step-face").trim(),
      stateCyan: root.getPropertyValue("--state-wash-cyan").trim(),
    };
  });
  expect(flightChrome.clockShadow).toBe("none");
  expect(flightChrome.identityShadow).toBe("none");
  expect(flightChrome.inactiveBackground).toContain("rgb(233, 238, 243)");
  expect(flightChrome.inactiveBorder).toBe("rgb(167, 179, 192)");
  expect(flightChrome.inactiveText).toBe("rgb(102, 116, 130)");
  expect(flightChrome.planGround).toBe("#ffffff");
  expect(flightChrome.planStep).toContain("#f1f5f9");
  expect(flightChrome.stateCyan).toContain("rgba(255,255,255,.9)");
  expect(await litIndicator.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe(darkLitFace);

  await page.getByRole("button", { name: "Delta-v planner" }).click();
  const planner = page.getByRole("dialog", { name: "Delta-v planner" });
  const profile = planner.getByRole("button", { name: /SYSTEM PROFILE & MISSION SETUP/ });
  if (await profile.getAttribute("aria-expanded") === "false") await profile.click();
  if (await planner.getByRole("combobox", { name: "Start" }).count()) {
    await planner.getByRole("button", { name: /Add next stop/ }).click();
  }
  await planner.getByRole("combobox", { name: "Next stop" }).selectOption("Duna");
  await planner.getByRole("button", { name: /Add next stop/ }).click();
  await planner.getByRole("textbox", { name: "Delta-v plan name" }).fill("Daylight state review");
  await planner.getByRole("button", { name: "Save plan", exact: true }).click();
  await planner.getByRole("button", { name: "Load saved plans" }).click();
  const savedPlans = page.getByRole("dialog", { name: "Saved Delta-v plans" });
  await savedPlans.getByRole("button", { name: "Pin to active vessel" }).click();
  await savedPlans.getByRole("button", { name: "Close saved plans" }).click();
  await planner.getByRole("button", { name: "Close delta-v planner" }).click();
  await page.getByRole("tab", { name: "PLAN", exact: true }).click();
  await expect(page.locator('.flight-workspace-selector[data-active-view="plan"]')).toBeVisible();

  const comparison = page.locator(".delta-v-pinned-comparison");
  const launchSuggestion = page.locator(".delta-v-progress-suggestion");
  await expect(comparison).toBeVisible();
  await expect(launchSuggestion).toBeVisible();
  const planState = await comparison.evaluate((element) => ({
    background: getComputedStyle(element).backgroundImage,
    body: getComputedStyle(element.querySelector("p")!).color,
    shortfall: getComputedStyle(element.querySelector("header strong")!).color,
    suggestion: getComputedStyle(document.querySelector<HTMLElement>(".delta-v-progress-suggestion span")!).color,
  }));
  expect(planState.background).toContain("rgba(255, 255, 255, 0.9)");
  expect(planState.body).toBe("rgb(43, 56, 70)");
  expect(planState.shortfall).toBe("rgb(143, 41, 34)");
  expect(planState.suggestion).toBe("rgb(78, 92, 108)");
});

test("Settings provides 44px targets on a coarse 390px mobile viewport", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Settings", exact: true });
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Mission Control Settings" });
    await expect(drawer).toBeVisible();

    const targets = await drawer.evaluate((element) => {
      const controls = [
        ...element.querySelectorAll<HTMLElement>(".settings-section-nav button"),
        ...element.querySelectorAll<HTMLElement>(".settings-theme-option"),
        element.querySelector<HTMLElement>("header > button")!,
      ];
      return {
        coarsePointer: matchMedia("(pointer: coarse)").matches,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        drawerClientWidth: element.clientWidth,
        drawerScrollWidth: element.scrollWidth,
        openerHeight: document.querySelector<HTMLElement>(".settings-rail-tab")?.getBoundingClientRect().height,
        openerWidth: document.querySelector<HTMLElement>(".settings-rail-tab")?.getBoundingClientRect().width,
        controls: controls.map((control) => {
          const bounds = control.getBoundingClientRect();
          return { height: bounds.height, width: bounds.width };
        }),
      };
    });
    expect(targets.coarsePointer).toBe(true);
    expect(targets.documentScrollWidth).toBeLessThanOrEqual(targets.documentClientWidth);
    expect(targets.drawerScrollWidth).toBeLessThanOrEqual(targets.drawerClientWidth + 1);
    expect(targets.openerWidth).toBeGreaterThanOrEqual(44);
    expect(targets.openerHeight).toBeGreaterThanOrEqual(44);
    expect(targets.controls.every((control) => control.width >= 44 && control.height >= 44)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  } finally {
    await context.close();
  }
});

test("both mission planners remain usable at a normal desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await expect(page.getByText("React dashboard · v0.7.1", { exact: false })).toBeVisible();
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

test("saved Delta-v plan feedback reserves visible header space", async ({ page }) => {
  await page.setViewportSize({ width: 1176, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Delta-v planner" }).click();
  const drawer = page.getByRole("dialog", { name: "Delta-v planner" });
  const profile = drawer.getByRole("button", { name: /SYSTEM PROFILE & MISSION SETUP/ });
  if (await profile.getAttribute("aria-expanded") === "false") await profile.click();
  if (await drawer.getByRole("combobox", { name: "Start" }).count()) {
    await drawer.getByRole("button", { name: /Add next stop/ }).click();
  }
  await drawer.getByRole("combobox", { name: "Next stop" }).selectOption("Duna");
  await drawer.getByRole("button", { name: /Add next stop/ }).click();
  await drawer.getByRole("textbox", { name: "Delta-v plan name" }).fill("Duna layout check");
  await drawer.getByRole("button", { name: "Save plan", exact: true }).click();
  await drawer.getByRole("button", { name: "Update plan", exact: true }).click();

  const feedback = drawer.getByRole("status");
  await expect(feedback).toHaveText("Updated Duna layout check");
  const layout = await drawer.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(":scope > header")!.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>(":scope > .delta-v-drawer-body")!.getBoundingClientRect();
    const message = element.querySelector<HTMLElement>(".delta-v-save-feedback")!.getBoundingClientRect();
    const nameHeading = element.querySelector<HTMLElement>(".delta-v-save-heading > span")!.getBoundingClientRect();
    const nameInput = element.querySelector<HTMLElement>(".delta-v-save-bar input")!.getBoundingClientRect();
    const saveActions = Array.from(element.querySelectorAll<HTMLElement>(".delta-v-save-actions button")).map((button) => button.getBoundingClientRect());
    const planTools = element.querySelector<HTMLElement>(".delta-v-header-actions")!.getBoundingClientRect();
    return {
      containedByHeader: message.top >= header.top && message.bottom <= header.bottom + 1,
      clearOfBody: message.bottom <= body.top + 1,
      headerHeight: header.height,
      nameHeadingHeight: nameHeading.height,
      nameHeadingWidth: nameHeading.width,
      nameInputWidth: nameInput.width,
      planToolsSeparated: saveActions.at(-1)!.right < planTools.left,
      saveControlsSeparated: nameInput.right <= saveActions[0].left
        && saveActions.every((button, index) => index === 0 || saveActions[index - 1].right <= button.left),
      visibleHeight: message.height,
      drawerClientWidth: element.clientWidth,
      drawerScrollWidth: element.scrollWidth,
    };
  });
  expect(layout.containedByHeader).toBe(true);
  expect(layout.clearOfBody).toBe(true);
  expect(layout.headerHeight).toBeLessThanOrEqual(65);
  expect(layout.nameHeadingHeight).toBeLessThanOrEqual(16);
  expect(layout.nameHeadingWidth).toBeGreaterThanOrEqual(65);
  expect(layout.nameInputWidth).toBeGreaterThanOrEqual(240);
  expect(layout.planToolsSeparated).toBe(true);
  expect(layout.saveControlsSeparated).toBe(true);
  expect(layout.visibleHeight).toBeGreaterThanOrEqual(10);
  expect(layout.drawerScrollWidth).toBeLessThanOrEqual(layout.drawerClientWidth + 1);
  await expect(drawer.getByRole("heading", { name: "Delta-V Mission Planner" })).toBeVisible();
  await expect(drawer.getByText("MISSION PLANNING · DELTA-V", { exact: true })).toHaveCount(0);
});

test("saved Delta-v plans inherit the active dashboard theme", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Delta-v planner" }).click();
  const planner = page.getByRole("dialog", { name: "Delta-v planner" });
  const profile = planner.getByRole("button", { name: /SYSTEM PROFILE & MISSION SETUP/ });
  if (await profile.getAttribute("aria-expanded") === "false") await profile.click();
  if (await planner.getByRole("combobox", { name: "Start" }).count()) {
    await planner.getByRole("button", { name: /Add next stop/ }).click();
  }
  await planner.getByRole("combobox", { name: "Next stop" }).selectOption("Duna");
  await planner.getByRole("button", { name: /Add next stop/ }).click();
  await planner.getByRole("textbox", { name: "Delta-v plan name" }).fill("Theme inheritance check");
  await planner.getByRole("button", { name: "Save plan", exact: true }).click();
  await planner.getByRole("button", { name: "Load saved plans" }).click();

  const library = planner.getByRole("dialog", { name: "Saved Delta-V plans" });
  const readSurfaces = () => library.evaluate((element) => ({
    card: getComputedStyle(element.querySelector<HTMLElement>(".delta-v-plan-library-list article")!).backgroundColor,
    header: getComputedStyle(element.querySelector<HTMLElement>(":scope > header")!).backgroundImage,
    modal: getComputedStyle(element).backgroundImage,
  }));
  const darkSurfaces = await readSurfaces();
  await library.getByRole("button", { name: "Close saved plans" }).click();
  await planner.getByRole("button", { name: "Close delta-v planner" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Mission Control Settings" });
  await settings.getByRole("radio", { name: /Daylight Console/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delta-v planner" }).click();
  const daylightPlanner = page.getByRole("dialog", { name: "Delta-v planner" });
  await daylightPlanner.getByRole("button", { name: "Load saved plans" }).click();
  const daylightLibrary = daylightPlanner.getByRole("dialog", { name: "Saved Delta-V plans" });
  const daylightSurfaces = await daylightLibrary.evaluate((element) => ({
    card: getComputedStyle(element.querySelector<HTMLElement>(".delta-v-plan-library-list article")!).backgroundColor,
    header: getComputedStyle(element.querySelector<HTMLElement>(":scope > header")!).backgroundImage,
    modal: getComputedStyle(element).backgroundImage,
  }));

  expect(await page.locator("html").getAttribute("data-theme")).toBe("daylight-console");
  expect(daylightSurfaces.modal).not.toBe(darkSurfaces.modal);
  expect(daylightSurfaces.header).not.toBe(darkSurfaces.header);
  expect(daylightSurfaces.card).not.toBe(darkSurfaces.card);
});

test("Delta-v density keeps the route primary on fine and coarse pointers", async ({ page, browser, baseURL }) => {
  async function buildDunaRoute(target: typeof page) {
    await target.getByRole("button", { name: "Delta-v planner" }).click();
    const profile = target.getByRole("button", { name: /SYSTEM PROFILE & MISSION SETUP/ });
    if (await profile.getAttribute("aria-expanded") === "false") await profile.click();
    if (await target.getByRole("combobox", { name: "Start" }).count()) {
      await target.getByRole("button", { name: /Add next stop/ }).click();
    }
    await target.getByRole("combobox", { name: "Next stop" }).selectOption("Duna");
    await target.getByRole("button", { name: /Add next stop/ }).click();
  }

  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");
  await buildDunaRoute(page);

  const desktop = await page.getByRole("dialog", { name: "Delta-v planner" }).evaluate((drawer) => {
    const bounds = (selector: string) => drawer.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const controls = Array.from(drawer.querySelectorAll<HTMLElement>(":scope > header input, :scope > header button"));
    const overlaps: string[][] = [];
    for (let left = 0; left < controls.length; left += 1) {
      for (let right = left + 1; right < controls.length; right += 1) {
        const a = controls[left].getBoundingClientRect();
        const b = controls[right].getBoundingClientRect();
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          overlaps.push([
            controls[left].getAttribute("aria-label") ?? controls[left].textContent?.trim() ?? "",
            controls[right].getAttribute("aria-label") ?? controls[right].textContent?.trim() ?? "",
          ]);
        }
      }
    }
    return {
      configurationHeight: bounds(".delta-v-configuration").height,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      drawerClientWidth: drawer.clientWidth,
      drawerScrollWidth: drawer.scrollWidth,
      footerHeight: bounds(".delta-v-footer").height,
      headerHeight: bounds(":scope > header").height,
      legHeights: Array.from(drawer.querySelectorAll<HTMLElement>(".delta-v-leg")).map((leg) => leg.getBoundingClientRect().height),
      marginControlHeights: Array.from(drawer.querySelectorAll<HTMLElement>(".delta-v-margin-controls button, .delta-v-margin-controls input")).map((control) => control.getBoundingClientRect().height),
      marginPresetColors: Array.from(drawer.querySelectorAll<HTMLElement>(".delta-v-margin-preset")).map((control) => getComputedStyle(control).color),
      overlaps,
      routeRailOffsets: Array.from(drawer.querySelectorAll<HTMLElement>(".delta-v-add-step button")).map((button, index) => {
        const marker = drawer.querySelectorAll<HTMLElement>(".delta-v-leg-marker span")[index];
        const nextMarker = drawer.querySelectorAll<HTMLElement>(".delta-v-leg-marker span")[index + 1];
        const buttonBounds = button.getBoundingClientRect();
        const markerBounds = marker.getBoundingClientRect();
        const nextMarkerBounds = nextMarker?.getBoundingClientRect();
        return {
          x: (buttonBounds.left + buttonBounds.width / 2) - (markerBounds.left + markerBounds.width / 2),
          y: nextMarkerBounds
            ? (buttonBounds.top + buttonBounds.height / 2) - ((markerBounds.top + markerBounds.height / 2 + nextMarkerBounds.top + nextMarkerBounds.height / 2) / 2)
            : 0,
        };
      }),
      routeHeaderHeight: bounds(".delta-v-route > header").height,
      routeListHeight: bounds(".delta-v-route-list").height,
      summaryHeight: bounds(".delta-v-summary").height,
      transferModeInMissionSummary: Boolean(drawer.querySelector(".delta-v-summary .delta-v-transfer-mode"))
        && !drawer.querySelector(".delta-v-controls .delta-v-transfer-mode"),
    };
  });

  expect(desktop.headerHeight).toBeLessThanOrEqual(65);
  expect(desktop.configurationHeight).toBeLessThanOrEqual(115);
  expect(desktop.summaryHeight).toBeLessThanOrEqual(122);
  expect(desktop.transferModeInMissionSummary).toBe(true);
  expect(desktop.routeHeaderHeight).toBeLessThanOrEqual(36);
  expect(desktop.routeListHeight).toBeGreaterThanOrEqual(500);
  expect(desktop.footerHeight).toBeLessThanOrEqual(27);
  expect(desktop.legHeights.slice(0, 3).every((height) => height <= 67)).toBe(true);
  expect(desktop.marginControlHeights).toEqual([22, 22, 22, 22, 22, 22]);
  expect(desktop.marginPresetColors).toEqual(["rgb(255, 143, 128)", "rgb(255, 180, 84)", "rgb(126, 231, 135)"]);
  expect(desktop.routeRailOffsets.slice(0, 2).every((offset) => Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1)).toBe(true);
  expect(desktop.overlaps).toEqual([]);
  expect(desktop.drawerScrollWidth).toBeLessThanOrEqual(desktop.drawerClientWidth + 1);
  expect(desktop.documentScrollWidth).toBeLessThanOrEqual(desktop.documentClientWidth);

  const margin = page.getByRole("spinbutton", { name: "Planning margin percent" });
  const lowMargin = page.getByRole("button", { name: "Set planning margin to 10 percent (low)" });
  await lowMargin.click();
  await expect(margin).toHaveValue("10");
  await expect(lowMargin).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Increase margin by 1 percent" }).click();
  await expect(margin).toHaveValue("11");
  await expect(lowMargin).toHaveAttribute("aria-pressed", "false");

  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.getByRole("combobox", { name: "Next stop" }).selectOption("Duna");
  await page.getByRole("radio", { name: "Parking orbit" }).check({ force: true });
  await expect(page.getByRole("spinbutton", { name: "Planned altitude" })).toBeVisible();
  await expect(page.getByText(/ATMO Ends at 50.0/)).toBeVisible();
  await expect(page.getByText("Ideal dates")).toBeVisible();
  await expect(page.getByText("Per-leg porkchops")).toHaveCount(0);
  const portraitMargin = await page.getByRole("dialog", { name: "Delta-v planner" }).evaluate((drawer) => {
    const card = drawer.querySelector<HTMLElement>(".delta-v-margin-card")!.getBoundingClientRect();
    const controls = drawer.querySelector<HTMLElement>(".delta-v-margin-controls")!.getBoundingClientRect();
    return {
      contained: controls.left >= card.left - 1 && controls.right <= card.right + 1,
      controlsWidth: controls.width,
      drawerOverflow: drawer.scrollWidth - drawer.clientWidth,
    };
  });
  expect(portraitMargin.contained).toBe(true);
  expect(portraitMargin.controlsWidth).toBeGreaterThanOrEqual(190);
  expect(portraitMargin.drawerOverflow).toBeLessThanOrEqual(1);

  for (const viewport of [{ width: 760, height: 900 }, { width: 390, height: 844 }]) {
    const touchContext = await browser.newContext({ baseURL, hasTouch: true, viewport });
    const touchPage = await touchContext.newPage();
    await touchPage.goto("/");
    await buildDunaRoute(touchPage);
    const touch = await touchPage.getByRole("dialog", { name: "Delta-v planner" }).evaluate((drawer) => {
      const marginCard = drawer.querySelector<HTMLElement>(".delta-v-margin-card")!.getBoundingClientRect();
      const marginControls = Array.from(drawer.querySelectorAll<HTMLElement>(".delta-v-margin-controls button, .delta-v-margin-controls input"));
      const routeList = drawer.querySelector<HTMLElement>(".delta-v-route-list")!;
      const summary = drawer.querySelector<HTMLElement>(".delta-v-summary")!;
      const iconControls = Array.from(drawer.querySelectorAll<HTMLElement>(".delta-v-assumptions-button, .delta-v-header-actions > button:last-child"));
      return {
        coarsePointer: matchMedia("(pointer: coarse)").matches,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        drawerClientWidth: drawer.clientWidth,
        drawerScrollWidth: drawer.scrollWidth,
        iconControlsMeetTarget: iconControls.every((control) => {
          const bounds = control.getBoundingClientRect();
          return bounds.width >= 44 && bounds.height >= 44;
        }),
        marginControlsContained: marginControls.every((control) => {
          const bounds = control.getBoundingClientRect();
          return bounds.left >= marginCard.left - 1
            && bounds.right <= marginCard.right + 1
            && bounds.top >= marginCard.top - 1
            && bounds.bottom <= marginCard.bottom + 1;
        }),
        marginControlsMeetTarget: marginControls.every((control) => control.getBoundingClientRect().height >= 44),
        routeListHeight: routeList.clientHeight,
        routeListScrollHeight: routeList.scrollHeight,
        summaryClientHeight: summary.clientHeight,
        summaryScrollHeight: summary.scrollHeight,
      };
    });
    expect(touch.coarsePointer).toBe(true);
    expect(touch.marginControlsMeetTarget).toBe(true);
    expect(touch.marginControlsContained).toBe(true);
    expect(touch.iconControlsMeetTarget).toBe(true);
    expect(touch.routeListHeight).toBeGreaterThanOrEqual(64);
    expect(touch.routeListScrollHeight).toBeGreaterThan(touch.routeListHeight);
    expect(touch.summaryScrollHeight).toBeGreaterThan(touch.summaryClientHeight);
    expect(touch.drawerScrollWidth).toBeLessThanOrEqual(touch.drawerClientWidth + 1);
    expect(touch.documentScrollWidth).toBeLessThanOrEqual(touch.documentClientWidth);
    await touchContext.close();
  }
});

test("native controls opt into the dark system color scheme", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("operational typography keeps its semantic floor across scenes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");

  await expectVisibleFontFloor(page.locator([
    ".annunciator-indicator",
    ".flight-stage-group button",
    ".target-clear-button",
    ".heat-loop-control",
    ".sci-research-toggle",
    ".sci-transmit-science",
    ".sci-alarm-controls button",
  ].join(",")), 10, "Flight operational controls");
  await expectVisibleFontFloor(page.locator([
    ".flight-stage-total > span",
    ".flight-stage-conditions > span",
    ".flight-workspace-label",
    ".attitude-strip .label",
    ".ec-label",
    ".sci-label",
  ].join(",")), 9, "Flight compact operational labels");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectVisibleFontFloor(page.locator(".meter .cap"), 9, "compact consumable values");
  await expectVisibleFontFloor(
    page.locator(".heat-temperature-value, .heat-net-flux, .heat-ratio-value"),
    9,
    "compact heat values",
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "DEV", exact: true }).click();
  await page.getByRole("button", { name: "editor", exact: true }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();
  await expectVisibleFontFloor(page.locator([
    ".editor-sim-title",
    ".editor-sim-control",
    ".editor-altitude-presets button",
    ".editor-recalculate",
    ".editor-sim-feedback .editor-state",
  ].join(",")), 10, "Editor simulation controls");

  await page.setViewportSize({ width: 800, height: 1280 });
  const editorPortraitOverflow = await page.locator(".editor-workspace").evaluate((element) => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    workspaceClientWidth: element.clientWidth,
    workspaceScrollWidth: element.scrollWidth,
  }));
  expect(editorPortraitOverflow.documentScrollWidth).toBeLessThanOrEqual(editorPortraitOverflow.documentClientWidth);
  expect(editorPortraitOverflow.workspaceScrollWidth).toBeLessThanOrEqual(editorPortraitOverflow.workspaceClientWidth + 1);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Delta-v planner" }).click();
  const planner = page.getByRole("dialog", { name: "Delta-v planner" });
  await expectVisibleFontFloor(planner.locator([
    ".delta-v-configuration-toggle b",
    ".delta-v-configuration-toggle > strong",
    ".delta-v-add-stop-row button",
    ".delta-v-route-timing span",
    ".delta-v-route-window-actions button",
    ":scope > header .delta-v-reset-button",
    ":scope > header .delta-v-saved-plans-button",
    ":scope > header .delta-v-assumptions-button",
  ].join(",")), 10, "planner controls and operational timing");
  await planner.getByRole("button", { name: "Close delta-v planner" }).click();

  await page.getByRole("button", { name: "DEV", exact: true }).click();
  await page.getByRole("button", { name: "inactive", exact: true }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();
  await expectVisibleFontFloor(page.locator([
    ".overview-vessel-actions button",
    ".overview-source",
    ".overview-alarm-type",
    ".transfer-window-status",
  ].join(",")), 10, "Mission Control actions and statuses");
  await expectVisibleFontFloor(page.locator([
    ".overview-roster-summary-chip > span",
    ".overview-contract-focus-overview > div > span",
  ].join(",")), 9, "Mission Control compact operational labels");
});

test("Editor electricity planning keeps a readable bounded instrument hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");
  await page.getByRole("button", { name: "DEV", exact: true }).click();
  await page.getByRole("button", { name: "editor", exact: true }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();

  const panel = page.locator("#editorElectricity");
  await expect(panel).toBeVisible();
  await expect(panel.locator("details")).toHaveCount(0);

  const generatedLedger = panel.locator("section.editor-electricity-ledger", { has: page.getByRole("heading", { name: "Power generated" }) });
  const consumedLedger = panel.locator("section.editor-electricity-ledger", { has: page.getByRole("heading", { name: "Power consumed" }) });
  await expect(panel.locator("section.editor-electricity-ledger")).toHaveCount(2);
  await expect(generatedLedger).toBeVisible();
  await expect(consumedLedger).toBeVisible();
  await expect(panel.getByRole("meter", { name: /Battery charge/ })).toBeVisible();
  await expect(generatedLedger.getByRole("group", { name: "Power generated inclusion controls" }).getByRole("button", { name: "All", exact: true })).toBeVisible();
  await expect(generatedLedger.getByRole("group", { name: "Power generated inclusion controls" }).getByRole("button", { name: "None", exact: true })).toBeVisible();
  await expect(consumedLedger.getByRole("group", { name: "Power consumed inclusion controls" }).getByRole("button", { name: "All", exact: true })).toBeVisible();
  await expect(consumedLedger.getByRole("group", { name: "Power consumed inclusion controls" }).getByRole("button", { name: "None", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 1920, height: 889 },
    { width: 1280, height: 800 },
    { width: 1080, height: 1920 },
    { width: 800, height: 1280 },
  ]) {
    await page.setViewportSize(viewport);

    const layout = await panel.evaluate((element) => {
      const scenario = element.querySelector<HTMLElement>(".editor-electricity-scenario-rail");
      const scenarioChildren = scenario
        ? Array.from(scenario.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.getClientRects().length > 0)
        : [];
      let scenarioOverlaps = 0;
      for (let left = 0; left < scenarioChildren.length; left += 1) {
        for (let right = left + 1; right < scenarioChildren.length; right += 1) {
          const a = scenarioChildren[left].getBoundingClientRect();
          const b = scenarioChildren[right].getBoundingClientRect();
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) scenarioOverlaps += 1;
        }
      }
      const altitude = element.querySelector<HTMLElement>(".editor-electricity-input-unit");
      const altitudeInput = altitude?.querySelector<HTMLElement>("input");
      const altitudeUnit = altitude?.querySelector<HTMLElement>("small");
      const altitudeRect = altitude?.getBoundingClientRect();
      const inputRect = altitudeInput?.getBoundingClientRect();
      const unitRect = altitudeUnit?.getBoundingClientRect();
      const plannerZones = element.querySelector<HTMLElement>(".editor-electricity-planner-zones");
      const readout = element.querySelector<HTMLElement>(".editor-electricity-readout-well");
      const ledgers = Array.from(element.querySelectorAll<HTMLElement>(".editor-electricity-ledger"));
      const ledgerBodies = Array.from(element.querySelectorAll<HTMLElement>(".editor-electricity-ledger-body"));
      return {
        altitudeContained: Boolean(
          altitudeRect && inputRect && unitRect
          && inputRect.left >= altitudeRect.left - 1
          && unitRect.right <= altitudeRect.right + 1
          && inputRect.right <= unitRect.left + 1
        ),
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        ledgerHorizontalOverflow: [...ledgers, ...ledgerBodies]
          .filter((ledger) => ledger.scrollWidth > ledger.clientWidth + 1).length,
        panelClientWidth: element.clientWidth,
        panelScrollWidth: element.scrollWidth,
        plannerHierarchy: Boolean(plannerZones && scenario && readout
          && plannerZones.contains(scenario) && plannerZones.contains(readout)),
        scenarioOverlaps,
      };
    });

    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
    expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth + 1);
    expect(layout.ledgerHorizontalOverflow).toBe(0);
    expect(layout.plannerHierarchy).toBe(true);
    expect(layout.scenarioOverlaps).toBe(0);
    expect(layout.altitudeContained).toBe(true);
    await expectVisibleFontFloor(panel.locator([
      ".editor-electricity-scenario-rail h3",
      ".editor-electricity-body-control",
      ".editor-electricity-altitude-control",
      ".editor-electricity-input-unit small",
      ".editor-electricity-scenario-derived dt",
      ".editor-electricity-scenario-derived dd",
      ".editor-electricity-readout-well h3",
      ".editor-electricity-net-headline",
      ".editor-electricity-charge-copy",
      ".editor-electricity-rate-bar > span",
      ".editor-electricity-storage > span",
      ".editor-electricity-shadow-assessment h3",
      ".editor-electricity-shadow-assessment dt",
      ".editor-electricity-recurring-orbit",
      ".editor-electricity-ledger header h3",
      ".editor-electricity-ledger header small",
      ".editor-electricity-ledger-actions button",
      ".editor-electricity-component strong",
      ".editor-electricity-component output",
    ].join(",")), 10, `Editor electricity operational text at ${viewport.width}x${viewport.height}`);
    await expectVisibleFontFloor(
      panel.locator(".editor-electricity-component small"),
      9,
      `Editor electricity module metadata at ${viewport.width}x${viewport.height}`,
    );
  }
});

test("dense Editor analysis uses the empty planning width and reveals the active stage", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");
  await page.getByRole("button", { name: "DEV" }).click();
  await page.getByRole("button", { name: "editor", exact: true }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();

  await expect(page.getByRole("table", { name: "Editor stage performance" })).toBeVisible();
  await expect(page.getByRole("row", { name: "Current stage S9" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("2 non-propulsive stages omitted", { exact: true })).toBeVisible();

  const layout = await page.locator(".editor-workspace").evaluate((workspace) => {
    const bounds = (selector: string) => workspace.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const workspaceBounds = workspace.getBoundingClientRect();
    const content = bounds(".editor-workspace-content");
    const context = bounds("#editorContext");
    const analysis = bounds(".editor-analysis-pair");
    const electricity = bounds("#editorElectricity");
    const stage = bounds("#stage");
    const summary = bounds("#editorSummary");
    const stageHeader = bounds("#stage > h2");
    const stageTitle = bounds("#stage > h2 .panel-title");
    const stageTag = workspace.querySelector<HTMLElement>("#stage > h2 .tag")!;
    const stageTagBounds = stageTag.getBoundingClientRect();
    const stageTotals = bounds("#stage .editor-stage-total-dv");
    const scenarioBody = bounds(".editor-electricity-body-control");
    const scenarioAltitude = bounds(".editor-electricity-altitude-control");
    const scenarioDerived = bounds(".editor-electricity-scenario-derived");
    const derivedCells = Array.from(workspace.querySelectorAll<HTMLElement>(".editor-electricity-scenario-derived > div"))
      .map((cell) => cell.getBoundingClientRect());
    const inspectLedgerFlow = (selector: string, forcedRows = 0) => {
      const body = workspace.querySelector<HTMLElement>(`${selector} .editor-electricity-ledger-body`)!;
      const originals = Array.from(body.querySelectorAll<HTMLElement>(".editor-electricity-component"));
      const clones = Array.from({ length: forcedRows }, (_, index) => originals[index % originals.length].cloneNode(true) as HTMLElement);
      clones.forEach((clone) => body.append(clone));
      body.scrollTop = body.scrollHeight;
      const rows = Array.from(body.querySelectorAll<HTMLElement>(".editor-electricity-component"));
      const boundsByRow = rows.map((row) => row.getBoundingClientRect());
      const result = {
        clippedLabels: rows.filter((row) => {
          const rowBounds = row.getBoundingClientRect();
          const labelBounds = row.querySelector<HTMLElement>("label")!.getBoundingClientRect();
          return labelBounds.bottom > rowBounds.bottom + 1
            || labelBounds.left < rowBounds.left - 1
            || labelBounds.right > rowBounds.right + 1;
        }).length,
        scrolls: body.scrollHeight > body.clientHeight + 1,
        verticalOverlaps: boundsByRow.filter((rowBounds, index) => {
          const next = boundsByRow[index + 1];
          return next ? rowBounds.bottom > next.top + 1 : false;
        }).length,
      };
      clones.forEach((clone) => clone.remove());
      body.scrollTop = 0;
      return result;
    };
    const producerLedgerFlow = inspectLedgerFlow(".editor-electricity-ledger.is-producer", 3);
    const consumerLedgerFlow = inspectLedgerFlow(".editor-electricity-ledger.is-consumer");
    const table = workspace.querySelector<HTMLElement>(".stage-table.editor")!;
    const tableBounds = table.getBoundingClientRect();
    const activeBounds = workspace.querySelector<HTMLElement>('.stage-table.editor [aria-current="step"]')!.getBoundingClientRect();
    const ninthRow = table.querySelector<HTMLElement>('[role="row"][data-stage-ksp]')!.cloneNode(true) as HTMLElement;
    ninthRow.removeAttribute("aria-current");
    ninthRow.removeAttribute("aria-label");
    table.append(ninthRow);
    const ninthRowScrolls = table.scrollHeight > table.clientHeight + 1;
    ninthRow.remove();
    return {
      activeFullyVisible: activeBounds.top >= tableBounds.top - 1
        && activeBounds.bottom <= tableBounds.bottom + 1,
      contextContentGap: content.top - context.bottom,
      contextMatchesWorkspace: Math.abs(context.width - workspaceBounds.width),
      centeredSideDifference: Math.abs((analysis.left - content.left) - (content.right - electricity.right)),
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      electricityHeight: electricity.height,
      electricityWidth: electricity.width,
      analysisElectricityGap: electricity.left - analysis.right,
      analysisTopDifference: Math.abs(analysis.top - electricity.top),
      analysisWidth: analysis.width,
      componentRowsUseTwoLines: Array.from(workspace.querySelectorAll<HTMLElement>(".editor-electricity-component label"))
        .every((label) => {
          const name = label.querySelector<HTMLElement>("strong")!.getBoundingClientRect();
          const category = label.querySelector<HTMLElement>("small")!.getBoundingClientRect();
          const rate = label.querySelector<HTMLElement>("output")!.getBoundingClientRect();
          return category.top > name.top + 1 && rate.top > name.top + 1;
        }),
      derivedColumnGap: scenarioDerived.left - scenarioBody.right,
      derivedFirstColumnDifference: Math.abs(derivedCells[0].left - derivedCells[2].left),
      derivedRightColumnDifference: Math.abs(derivedCells[1].left - derivedCells[3].left),
      derivedTopRowDifference: Math.abs(derivedCells[0].top - derivedCells[1].top),
      derivedBottomRowDifference: Math.abs(derivedCells[2].top - derivedCells[3].top),
      ninthRowScrolls,
      overflowingElectricityRows: Array.from(workspace.querySelectorAll<HTMLElement>(".editor-electricity-component :is(strong,small,output)"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingHeaderValues: Array.from(workspace.querySelectorAll<HTMLElement>("#editorContext h1, #editorContext .editor-overview-metric strong, #editorContext .editor-overview-metric small"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      poweredRows: workspace.querySelectorAll('.stage-table.editor [role="row"][data-stage-ksp]').length,
      producerLedgerFlow,
      consumerLedgerFlow,
      secondaryChildren: workspace.querySelector(".editor-workspace-secondary")!.children.length,
      scenarioControlGap: scenarioAltitude.top - scenarioBody.bottom,
      scenarioControlLeftDifference: Math.abs(scenarioBody.left - scenarioAltitude.left),
      scenarioControlWidthDifference: Math.abs(scenarioBody.width - scenarioAltitude.width),
      stageHeaderTitle: workspace.querySelector<HTMLElement>("#stage > h2 .panel-title")!.textContent,
      stageTagOverflow: stageTag.scrollWidth - stageTag.clientWidth,
      stageTitleTotalsGap: stageTagBounds.left - stageTitle.right,
      stageTotalsContained: stageTotals.left >= stageTagBounds.left - 1
        && stageTotals.right <= stageHeader.right - 1,
      stageTotalValueOverflows: Array.from(workspace.querySelectorAll<HTMLElement>("#stage .editor-stage-total-value"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      stageSummaryGap: summary.top - stage.bottom,
      stageSummaryLeftDifference: Math.abs(stage.left - summary.left),
      stageSummaryRightDifference: Math.abs(stage.right - summary.right),
      tableClientHeight: table.clientHeight,
      tableScrollHeight: table.scrollHeight,
    };
  });

  expect(layout.secondaryChildren).toBe(0);
  expect(layout.contextMatchesWorkspace).toBeLessThanOrEqual(1);
  expect(layout.contextContentGap).toBeGreaterThanOrEqual(10);
  expect(layout.analysisWidth).toBeGreaterThanOrEqual(500);
  expect(layout.analysisWidth).toBeLessThanOrEqual(515);
  expect(layout.electricityWidth).toBeGreaterThanOrEqual(570);
  expect(layout.electricityWidth).toBeLessThanOrEqual(605);
  expect(layout.analysisElectricityGap).toBeGreaterThanOrEqual(10);
  expect(layout.analysisTopDifference).toBeLessThanOrEqual(1);
  expect(layout.centeredSideDifference).toBeLessThanOrEqual(1);
  expect(layout.stageSummaryGap).toBeGreaterThanOrEqual(10);
  expect(layout.stageSummaryLeftDifference).toBeLessThanOrEqual(1);
  expect(layout.stageSummaryRightDifference).toBeLessThanOrEqual(1);
  expect(layout.scenarioControlLeftDifference).toBeLessThanOrEqual(1);
  expect(layout.scenarioControlWidthDifference).toBeLessThanOrEqual(1);
  expect(layout.scenarioControlGap).toBeGreaterThanOrEqual(5);
  expect(layout.stageHeaderTitle).toBe("Staging analysis");
  expect(layout.stageTagOverflow).toBeLessThanOrEqual(1);
  expect(layout.stageTitleTotalsGap).toBeGreaterThanOrEqual(5);
  expect(layout.stageTotalsContained).toBe(true);
  expect(layout.stageTotalValueOverflows).toBe(0);
  expect(layout.derivedColumnGap).toBeGreaterThanOrEqual(5);
  expect(layout.derivedFirstColumnDifference).toBeLessThanOrEqual(1);
  expect(layout.derivedRightColumnDifference).toBeLessThanOrEqual(1);
  expect(layout.derivedTopRowDifference).toBeLessThanOrEqual(1);
  expect(layout.derivedBottomRowDifference).toBeLessThanOrEqual(1);
  expect(layout.componentRowsUseTwoLines).toBe(true);
  expect(layout.overflowingElectricityRows).toBe(0);
  expect(layout.producerLedgerFlow.scrolls).toBe(true);
  expect(layout.producerLedgerFlow.verticalOverlaps).toBe(0);
  expect(layout.producerLedgerFlow.clippedLabels).toBe(0);
  expect(layout.consumerLedgerFlow.scrolls).toBe(true);
  expect(layout.consumerLedgerFlow.verticalOverlaps).toBe(0);
  expect(layout.consumerLedgerFlow.clippedLabels).toBe(0);
  expect(layout.poweredRows).toBe(8);
  expect(layout.tableScrollHeight).toBeLessThanOrEqual(layout.tableClientHeight + 1);
  expect(layout.ninthRowScrolls).toBe(true);
  expect(layout.activeFullyVisible).toBe(true);
  expect(layout.overflowingHeaderValues).toBe(0);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight + layout.electricityHeight);

  await page.setViewportSize({ width: 1280, height: 800 });
  const narrower = await page.locator(".editor-workspace").evaluate((workspace) => {
    const bounds = (selector: string) => workspace.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const electricity = bounds("#editorElectricity");
    const stage = bounds("#stage");
    const summary = bounds("#editorSummary");
    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      electricityStageLeftDifference: Math.abs(electricity.left - stage.left),
      electricitySummaryRightDifference: Math.abs(electricity.right - summary.right),
      stageSummaryGap: summary.left - stage.right,
      stageSummaryTopDifference: Math.abs(stage.top - summary.top),
    };
  });
  expect(narrower.electricityStageLeftDifference).toBeLessThanOrEqual(1);
  expect(narrower.electricitySummaryRightDifference).toBeLessThanOrEqual(1);
  expect(narrower.stageSummaryGap).toBeGreaterThanOrEqual(5);
  expect(narrower.stageSummaryTopDifference).toBeLessThanOrEqual(1);
  expect(narrower.documentScrollWidth).toBeLessThanOrEqual(narrower.documentClientWidth);
});

test("Editor planning companions preserve the dense workspace alone and together", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");
  await page.getByRole("button", { name: "DEV" }).click();
  await page.getByRole("button", { name: "editor", exact: true }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();

  await page.getByRole("button", { name: "Resonant orbit planner" }).click();
  await page.getByRole("textbox", { name: "Plan name" }).fill("Editor orbit review");
  await page.getByRole("button", { name: "SAVE PLAN" }).click();
  await page.getByRole("button", { name: /LOAD SAVED PLANS/ }).click();
  await page.getByRole("button", { name: "Pin in Editor" }).click();
  await page.getByRole("button", { name: "Close saved plans" }).click();
  await page.getByRole("button", { name: "Close resonant orbit planner" }).click();

  const workspace = page.locator(".editor-workspace");
  await expect(workspace).toHaveClass(/has-planning-companion/);
  await expect(page.locator("#editorOrbitPlan")).toBeVisible();
  await expect(page.locator("#editorDeltaVPlan")).toHaveCount(0);
  await expect(page.locator("#editorOrbitPlan > h2 .panel-title")).toHaveText("Resonant Orbit Plan");
  await expect(page.locator("#editorOrbitPlan .resonant-editor-plan-details > header > strong")).toHaveText("Editor orbit review");
  await expect(page.locator("#editorOrbitPlan .resonant-editor-plan-details > header > span")).toHaveText("Kerbin");
  await expect(page.locator("#editorOrbitPlan .resonant-editor-satellite")).toHaveCount(3);
  await expect(page.locator("#editorOrbitPlan .resonant-editor-plan-status")).toContainText("No continuous LOS");
  await expect(page.getByRole("button", { name: "Open planner" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit plan" }).click();
  await expect(page.getByRole("dialog", { name: "Resonant orbit planner" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Plan name" })).toHaveValue("Editor orbit review");
  await page.getByRole("button", { name: "Close resonant orbit planner" }).click();

  const orbitOnly = await workspace.evaluate((element) => {
    const bounds = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const context = bounds("#editorContext");
    const analysis = bounds(".editor-analysis-pair");
    const electricity = bounds("#editorElectricity");
    const orbit = bounds("#editorOrbitPlan");
    return {
      analysisElectricityGap: electricity.left - analysis.right,
      analysisTopDifference: Math.abs(analysis.top - electricity.top),
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      electricityHeight: bounds("#editorElectricity").height,
      orbitElectricityGap: orbit.left - electricity.right,
      orbitTopDifference: Math.abs(orbit.top - electricity.top),
      orbitContextGap: orbit.top - context.bottom,
      orbitHeight: orbit.height,
      secondaryChildren: element.querySelector(".editor-workspace-secondary")!.children.length,
    };
  });
  expect(orbitOnly.secondaryChildren).toBe(1);
  expect(orbitOnly.orbitContextGap).toBeGreaterThanOrEqual(10);
  expect(orbitOnly.analysisElectricityGap).toBeGreaterThanOrEqual(10);
  expect(orbitOnly.orbitElectricityGap).toBeGreaterThanOrEqual(10);
  expect(orbitOnly.analysisTopDifference).toBeLessThanOrEqual(1);
  expect(orbitOnly.orbitTopDifference).toBeLessThanOrEqual(1);
  expect(orbitOnly.orbitHeight).toBeLessThanOrEqual(220);
  expect(orbitOnly.documentScrollWidth).toBeLessThanOrEqual(orbitOnly.documentClientWidth);
  expect(orbitOnly.documentScrollHeight).toBeLessThanOrEqual(orbitOnly.documentClientHeight + orbitOnly.electricityHeight);

  await page.getByRole("button", { name: "Delta-v planner" }).click();
  await page.getByRole("button", { name: "+ Add next stop" }).click();
  await page.getByRole("combobox", { name: "Next stop" }).selectOption({ label: "Duna" });
  await page.getByRole("textbox", { name: "Delta-v plan name" }).fill("Editor layout review");
  await page.getByRole("button", { name: "Save plan" }).click();
  await page.getByRole("button", { name: "Load saved plans" }).click();
  await page.getByRole("button", { name: "Pin to Editor craft" }).click();
  await page.getByRole("button", { name: "Close saved plans" }).click();
  await page.getByRole("button", { name: "Close delta-v planner" }).click();

  await expect(page.locator("#editorOrbitPlan")).toBeVisible();
  await expect(page.locator("#editorDeltaVPlan")).toBeVisible();
  const missionPlan = page.locator("#editorDeltaVPlan");
  await expect(missionPlan.getByText("Editor layout review", { exact: true })).toBeVisible();
  await expect(missionPlan.getByText("Kerbin → Duna", { exact: true })).toBeVisible();
  await expect(missionPlan.getByText("Mission budget", { exact: true })).toBeVisible();
  await expect(missionPlan.getByText(/Craft coverage/)).toBeVisible();
  await expect(missionPlan.locator(".delta-v-editor-coverage footer")).toContainText("reserve");
  await expect(missionPlan.locator(".delta-v-editor-route-heading")).toContainText("4 steps");
  await expect(missionPlan.getByText("Assisted", { exact: true })).toBeVisible();
  await expect(missionPlan.getByText("READ ONLY", { exact: true })).toHaveCount(0);

  await missionPlan.getByRole("button", { name: "Edit plan" }).click();
  await expect(page.getByRole("dialog", { name: "Delta-v planner" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Delta-v plan name" })).toHaveValue("Editor layout review");
  await page.getByRole("button", { name: "Close delta-v planner" }).click();

  const layout = await workspace.evaluate((element) => {
    const bounds = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const workspaceBounds = element.getBoundingClientRect();
    const content = bounds(".editor-workspace-content");
    const context = bounds("#editorContext");
    const analysis = bounds(".editor-analysis-pair");
    const stage = bounds("#stage");
    const summary = bounds("#editorSummary");
    const electricity = bounds("#editorElectricity");
    const secondary = bounds(".editor-workspace-secondary");
    const orbit = bounds("#editorOrbitPlan");
    const deltaV = bounds("#editorDeltaVPlan");
    const scenarioBody = bounds(".editor-electricity-body-control");
    const scenarioAltitude = bounds(".editor-electricity-altitude-control");
    const scenarioDerived = bounds(".editor-electricity-scenario-derived");
    const derivedCells = Array.from(element.querySelectorAll<HTMLElement>(".editor-electricity-scenario-derived > div"))
      .map((cell) => cell.getBoundingClientRect());
    const orbitHeader = element.querySelector<HTMLElement>("#editorOrbitPlan > h2")!.getBoundingClientRect();
    const deltaVHeader = element.querySelector<HTMLElement>("#editorDeltaVPlan > h2")!.getBoundingClientRect();
    const orbitEdit = element.querySelector<HTMLElement>("#editorOrbitPlan .resonant-edit-plan")!.getBoundingClientRect();
    const orbitUnpin = element.querySelector<HTMLElement>("#editorOrbitPlan .resonant-unpin")!.getBoundingClientRect();
    const deltaVEdit = element.querySelector<HTMLElement>("#editorDeltaVPlan .resonant-edit-plan")!.getBoundingClientRect();
    const deltaVUnpin = element.querySelector<HTMLElement>("#editorDeltaVPlan .resonant-unpin")!.getBoundingClientRect();
    const table = element.querySelector<HTMLElement>(".stage-table.editor")!;
    return {
      companionGap: deltaV.top - orbit.bottom,
      conditionNumberAppearances: Array.from(element.querySelectorAll<HTMLElement>('.editor-sim-control input[type="number"]'))
        .map((input) => getComputedStyle(input).appearance),
      contextContentGap: content.top - context.bottom,
      contextMatchesWorkspace: Math.abs(context.width - workspaceBounds.width),
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      electricityHeight: electricity.height,
      electricityWidth: electricity.width,
      deltaVHeaderHeight: deltaVHeader.height,
      deltaVEditHeight: deltaVEdit.height,
      deltaVHeight: deltaV.height,
      deltaVUnpinHeight: deltaVUnpin.height,
      coverageFooterFontSize: Number.parseFloat(getComputedStyle(element.querySelector<HTMLElement>("#editorDeltaVPlan .delta-v-editor-coverage footer")!).fontSize),
      overflowingMissionValues: Array.from(element.querySelectorAll<HTMLElement>("#editorDeltaVPlan strong, #editorDeltaVPlan .delta-v-pinned-step-copy"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingElectricityRows: Array.from(element.querySelectorAll<HTMLElement>(".editor-electricity-component :is(strong,small,output)"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingElectricityRegions: Array.from(element.querySelectorAll<HTMLElement>("#editorElectricity, .editor-electricity-ledger, .editor-electricity-ledger-body"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingStageValues: Array.from(element.querySelectorAll<HTMLElement>("#stage .st-row > span, #stage .editor-stage-total-dv"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingResourceNames: Array.from(element.querySelectorAll<HTMLElement>("#editorSummary .editor-resource-row > span:first-child"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingHeaderValues: Array.from(element.querySelectorAll<HTMLElement>("#editorContext h1, #editorContext .editor-overview-metric strong, #editorContext .editor-overview-metric small"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingOrbitValues: Array.from(element.querySelectorAll<HTMLElement>("#editorOrbitPlan .resonant-editor-plan-details strong, #editorOrbitPlan .resonant-editor-plan-details > header > span"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      orbitContextGap: orbit.top - context.bottom,
      orbitEditHeight: orbitEdit.height,
      orbitHeaderHeight: orbitHeader.height,
      orbitUnpinHeight: orbitUnpin.height,
      analysisElectricityGap: electricity.left - analysis.right,
      analysisTopDifference: Math.abs(analysis.top - electricity.top),
      companionElectricityGap: secondary.left - electricity.right,
      companionTopDifference: Math.abs(secondary.top - electricity.top),
      analysisWidth: analysis.width,
      companionWidth: secondary.width,
      derivedColumnGap: scenarioDerived.left - scenarioBody.right,
      derivedFirstColumnDifference: Math.abs(derivedCells[0].left - derivedCells[2].left),
      derivedRightColumnDifference: Math.abs(derivedCells[1].left - derivedCells[3].left),
      derivedTopRowDifference: Math.abs(derivedCells[0].top - derivedCells[1].top),
      derivedBottomRowDifference: Math.abs(derivedCells[2].top - derivedCells[3].top),
      scenarioControlLeftDifference: Math.abs(scenarioBody.left - scenarioAltitude.left),
      scenarioControlWidthDifference: Math.abs(scenarioBody.width - scenarioAltitude.width),
      scenarioControlGap: scenarioAltitude.top - scenarioBody.bottom,
      producerRows: element.querySelectorAll(".editor-electricity-ledger.is-producer .editor-electricity-component").length,
      consumerRows: element.querySelectorAll(".editor-electricity-ledger.is-consumer .editor-electricity-component").length,
      resourceRows: element.querySelectorAll("#editorSummary .editor-resource-row").length,
      stageRows: element.querySelectorAll(".stage-table.editor .st-row:not(.st-head)").length,
      secondaryChildren: element.querySelector(".editor-workspace-secondary")!.children.length,
      stageSummaryGap: summary.top - stage.bottom,
      stageSummaryLeftDifference: Math.abs(stage.left - summary.left),
      stageSummaryRightDifference: Math.abs(stage.right - summary.right),
      tableClientHeight: table.clientHeight,
      tableScrollHeight: table.scrollHeight,
    };
  });

  expect(layout.secondaryChildren).toBe(2);
  expect(layout.companionGap).toBeGreaterThanOrEqual(10);
  expect(layout.orbitHeaderHeight).toBeLessThanOrEqual(30);
  expect(layout.deltaVHeaderHeight).toBeLessThanOrEqual(30);
  expect(layout.orbitEditHeight).toBeLessThanOrEqual(24);
  expect(layout.orbitUnpinHeight).toBeLessThanOrEqual(24);
  expect(layout.deltaVEditHeight).toBeLessThanOrEqual(24);
  expect(layout.deltaVUnpinHeight).toBeLessThanOrEqual(24);
  expect(layout.deltaVHeight).toBeLessThanOrEqual(360);
  expect(layout.coverageFooterFontSize).toBeGreaterThanOrEqual(10);
  expect(layout.conditionNumberAppearances).toEqual(["textfield", "textfield"]);
  expect(layout.contextMatchesWorkspace).toBeLessThanOrEqual(1);
  expect(layout.contextContentGap).toBeGreaterThanOrEqual(10);
  expect(layout.orbitContextGap).toBeGreaterThanOrEqual(10);
  expect(layout.analysisWidth).toBeGreaterThanOrEqual(500);
  expect(layout.analysisWidth).toBeLessThanOrEqual(525);
  expect(layout.electricityWidth).toBeGreaterThanOrEqual(570);
  expect(layout.electricityWidth).toBeLessThanOrEqual(620);
  expect(layout.companionWidth).toBeGreaterThanOrEqual(620);
  expect(layout.companionWidth).toBeLessThanOrEqual(640);
  expect(layout.analysisElectricityGap).toBeGreaterThanOrEqual(10);
  expect(layout.companionElectricityGap).toBeGreaterThanOrEqual(10);
  expect(layout.analysisTopDifference).toBeLessThanOrEqual(1);
  expect(layout.companionTopDifference).toBeLessThanOrEqual(1);
  expect(layout.stageSummaryGap).toBeGreaterThanOrEqual(10);
  expect(layout.stageSummaryLeftDifference).toBeLessThanOrEqual(1);
  expect(layout.stageSummaryRightDifference).toBeLessThanOrEqual(1);
  expect(layout.scenarioControlLeftDifference).toBeLessThanOrEqual(1);
  expect(layout.scenarioControlWidthDifference).toBeLessThanOrEqual(1);
  expect(layout.scenarioControlGap).toBeGreaterThanOrEqual(5);
  expect(layout.derivedColumnGap).toBeGreaterThanOrEqual(5);
  expect(layout.derivedFirstColumnDifference).toBeLessThanOrEqual(1);
  expect(layout.derivedRightColumnDifference).toBeLessThanOrEqual(1);
  expect(layout.derivedTopRowDifference).toBeLessThanOrEqual(1);
  expect(layout.derivedBottomRowDifference).toBeLessThanOrEqual(1);
  expect(layout.stageRows).toBe(8);
  expect(layout.resourceRows).toBe(4);
  expect(layout.producerRows).toBe(4);
  expect(layout.consumerRows).toBe(7);
  expect(layout.tableScrollHeight).toBeLessThanOrEqual(layout.tableClientHeight + 1);
  expect(layout.overflowingHeaderValues).toBe(0);
  expect(layout.overflowingMissionValues).toBe(0);
  expect(layout.overflowingElectricityRows).toBe(0);
  expect(layout.overflowingElectricityRegions).toBe(0);
  expect(layout.overflowingStageValues).toBe(0);
  expect(layout.overflowingOrbitValues).toBe(0);
  expect(layout.overflowingResourceNames).toBe(0);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight + layout.electricityHeight);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByRole("button", { name: "DEV" }).click();
  await page.getByRole("button", { name: "editor", exact: true }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();
  await expect(page.locator("#editorOrbitPlan")).toBeVisible();
  await expect(page.locator("#editorDeltaVPlan")).toBeVisible();
  const medium = await workspace.evaluate((element) => {
    const bounds = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const primary = bounds(".editor-workspace-primary");
    const secondary = bounds(".editor-workspace-secondary");
    const orbit = bounds("#editorOrbitPlan");
    const deltaV = bounds("#editorDeltaVPlan");
    const table = element.querySelector<HTMLElement>(".stage-table.editor")!;
    const tableBounds = table.getBoundingClientRect();
    const activeBounds = table.querySelector<HTMLElement>('[aria-current="step"]')!.getBoundingClientRect();
    return {
      activeFullyVisible: activeBounds.top >= tableBounds.top - 1
        && activeBounds.bottom <= tableBounds.bottom + 1,
      columnGap: secondary.left - primary.right,
      companionGap: deltaV.top - orbit.bottom,
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      electricityHeight: bounds("#editorElectricity").height,
      overflowingOrbitValues: Array.from(element.querySelectorAll<HTMLElement>("#editorOrbitPlan .resonant-editor-plan-details strong, #editorOrbitPlan .resonant-editor-plan-details > header > span"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      overflowingResourceNames: Array.from(element.querySelectorAll<HTMLElement>("#editorSummary .editor-resource-row > span:first-child"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      secondaryChildren: element.querySelector(".editor-workspace-secondary")!.children.length,
      tableClientHeight: table.clientHeight,
      tableScrollHeight: table.scrollHeight,
      topDifference: Math.abs(primary.top - secondary.top),
    };
  });
  expect(medium.secondaryChildren).toBe(2);
  expect(medium.activeFullyVisible).toBe(true);
  expect(medium.columnGap).toBeGreaterThanOrEqual(10);
  expect(medium.companionGap).toBeGreaterThanOrEqual(6);
  expect(medium.overflowingOrbitValues).toBe(0);
  expect(medium.overflowingResourceNames).toBe(0);
  expect(medium.topDifference).toBeLessThanOrEqual(1);
  expect(medium.tableScrollHeight).toBeGreaterThan(medium.tableClientHeight);
  expect(medium.documentScrollWidth).toBeLessThanOrEqual(medium.documentClientWidth);
  expect(medium.documentScrollHeight).toBeLessThanOrEqual(medium.documentClientHeight + medium.electricityHeight);

  await page.setViewportSize({ width: 1080, height: 1920 });
  const portrait = await workspace.evaluate((element) => {
    const bounds = (selector: string) => element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const context = bounds("#editorContext");
    const stage = bounds("#stage");
    const summary = bounds("#editorSummary");
    const orbit = bounds("#editorOrbitPlan");
    const deltaV = bounds("#editorDeltaVPlan");
    return {
      companionGap: deltaV.top - orbit.bottom,
      contextStageGap: stage.top - context.bottom,
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      stageSummaryGap: summary.top - stage.bottom,
      secondaryChildren: element.querySelector(".editor-workspace-secondary")!.children.length,
      summaryPlanGap: orbit.top - summary.bottom,
    };
  });
  expect(portrait.secondaryChildren).toBe(2);
  expect(portrait.contextStageGap).toBeGreaterThanOrEqual(10);
  expect(portrait.stageSummaryGap).toBeGreaterThanOrEqual(10);
  expect(portrait.summaryPlanGap).toBeGreaterThanOrEqual(10);
  expect(portrait.companionGap).toBeGreaterThanOrEqual(10);
  expect(portrait.documentScrollWidth).toBeLessThanOrEqual(portrait.documentClientWidth);
  expect(portrait.documentScrollHeight).toBeLessThanOrEqual(portrait.documentClientHeight);
});

test("the wide Flight context and control plate fit long mission times in one compact header", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/");

  const missionElapsed = page.locator(".met-cell .big");
  await missionElapsed.evaluate((element) => {
    element.textContent = "T+ 999999d 05:59:59";
  });

  const layout = await page.locator(".flight-workspace-shell").evaluate((element) => {
    const status = element.querySelector<HTMLElement>(".status-strip")!;
    const plate = element.querySelector<HTMLElement>(".flight-control-plate")!;
    const cells = Array.from(status.querySelectorAll(".flight-context-identity, .clockcell, .cs-cell"));
    const tops = cells.map((cell) => cell.getBoundingClientRect().top);
    const elapsed = status.querySelector<HTMLElement>(".met-cell .big")!;
    const statusBounds = status.getBoundingClientRect();
    const plateBounds = plate.getBoundingClientRect();
    const comms = status.querySelector<HTMLElement>(".cs-cell")!;
    const delayLabel = comms.querySelector<HTMLElement>(".cs-delay .label")!;
    const delayValue = comms.querySelector<HTMLElement>(".cs-delay .cs-val")!;
    return {
      cellCount: cells.length,
      commsText: comms.textContent,
      delayLabelFontSize: Number.parseFloat(getComputedStyle(delayLabel).fontSize),
      delayValueFontSize: Number.parseFloat(getComputedStyle(delayValue).fontSize),
      height: statusBounds.height,
      maxTopDifference: Math.max(...tops) - Math.min(...tops),
      clientWidth: status.clientWidth,
      scrollWidth: status.scrollWidth,
      elapsedClientWidth: elapsed.clientWidth,
      elapsedScrollWidth: elapsed.scrollWidth,
      elapsedWhiteSpace: getComputedStyle(elapsed).whiteSpace,
      plateBottom: plateBounds.bottom,
      plateLeft: plateBounds.left,
      plateTop: plateBounds.top,
      statusBottom: statusBounds.bottom,
      statusRight: statusBounds.right,
      statusTop: statusBounds.top,
    };
  });

  expect(layout.cellCount).toBe(4);
  expect(layout.commsText).toContain("CONNECTED");
  expect(layout.commsText).toContain("Signal delay");
  expect(layout.delayLabelFontSize).toBeGreaterThanOrEqual(9);
  expect(layout.delayValueFontSize).toBeGreaterThanOrEqual(11);
  expect(layout.height).toBeLessThan(100);
  expect(layout.maxTopDifference).toBeLessThanOrEqual(1);
  expect(layout.clientWidth).toBeLessThan(1600);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.elapsedWhiteSpace).toBe("nowrap");
  expect(layout.elapsedScrollWidth).toBeLessThanOrEqual(layout.elapsedClientWidth + 1);
  expect(layout.plateLeft - layout.statusRight).toBeGreaterThanOrEqual(10);
  expect(layout.plateTop).toBeGreaterThanOrEqual(layout.statusTop);
  expect(layout.plateBottom).toBeLessThanOrEqual(layout.statusBottom);
});

test("the Flight annunciator uses fixed acknowledgement-state indicators", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto("/");

  const lamp = page.locator(".annunciator-lamp");
  const plate = page.getByRole("group", { name: "Flight caution and workspace controls" });
  await expect(plate).toBeVisible();
  await expect(lamp).toBeVisible();
  await expect(lamp).toHaveAttribute("aria-label", /Master warning, unacknowledged/);
  const indicators = page.getByRole("group", { name: "Flight alert indicators" });
  await expect(indicators.getByRole("button")).toHaveCount(5);
  await expect(indicators.locator(":scope > *")).toHaveCount(6);
  const reserved = indicators.locator(".annunciator-reserved-space");
  await expect(reserved).toHaveAttribute("aria-hidden", "true");
  await expect(reserved).toHaveText("");
  expect((await reserved.boundingBox())?.width).toBeGreaterThan(0);
  await expect(plate.getByRole("tablist", { name: "Flight workspace" }).getByRole("tab")).toHaveCount(2);
  await expect(plate.getByText("Lamp Test", { exact: true })).toHaveCount(0);
  const heat = indicators.getByRole("button", { name: "HEAT new warning. Acknowledge." });
  await expect(heat).toHaveClass(/new/);
  expect(await lamp.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  const masterRect = await lamp.boundingBox();
  expect(masterRect?.width).toBeGreaterThanOrEqual(94);
  expect(masterRect?.height).toBeGreaterThanOrEqual(48);

  await heat.click();
  await expect(lamp).toHaveAttribute("aria-label", /Master warning, unacknowledged/);
  await expect(indicators.getByRole("button", { name: "HEAT warning acknowledged and still active" })).toHaveClass(/acknowledged/);

  await indicators.getByRole("button", { name: "DAMAGE new warning. Acknowledge and show affected craft parts." }).click();
  const damage = page.getByRole("dialog", { name: "Damage report" });
  await expect(damage).toBeVisible();
  await expect(damage.getByRole("heading", { name: "Active 2" })).toBeVisible();
  await expect(damage.getByRole("heading", { name: "Recorded part loss 1" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(damage).toBeHidden();
  await expect(lamp).toHaveAttribute("aria-label", /Master caution clear/);

  await lamp.click();

  const history = page.getByRole("dialog", { name: "Master caution history" });
  await expect(history).toBeVisible();
  await expect(history.getByRole("heading", { name: "Active 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toBeHidden();
  await expect(lamp).toBeFocused();
});

test("the Flight control plate reflows all five indicators and its reserved slot on compact screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const layout = await page.locator(".flight-control-plate").evaluate((plate) => {
    const indicators = Array.from(plate.querySelectorAll<HTMLElement>(".annunciator-indicator"));
    const reserved = plate.querySelector<HTMLElement>(".annunciator-reserved-space")!;
    const allSlots = [...indicators, reserved];
    return {
      columns: new Set(allSlots.map((slot) => Math.round(slot.getBoundingClientRect().left))).size,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      indicatorCount: indicators.length,
      reservedText: reserved.textContent,
      rows: new Set(allSlots.map((slot) => Math.round(slot.getBoundingClientRect().top))).size,
      slotWidths: allSlots.map((slot) => slot.getBoundingClientRect().width),
      workspaceLabelDisplay: getComputedStyle(plate.querySelector<HTMLElement>(".flight-workspace-label")!).display,
    };
  });

  expect(layout.indicatorCount).toBe(5);
  expect(layout.columns).toBe(3);
  expect(layout.rows).toBe(2);
  expect(layout.reservedText).toBe("");
  expect(Math.max(...layout.slotWidths) - Math.min(...layout.slotWidths)).toBeLessThanOrEqual(1);
  expect(layout.workspaceLabelDisplay).toBe("none");
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
});

test("Flight MONITOR and PLAN remain overlap-free at proposal targets", async ({ page }) => {
  await page.goto("/");
  for (const viewport of [
    { width: 1920, height: 1080, allowsVerticalScroll: false },
    { width: 1080, height: 1920, allowsVerticalScroll: false },
    { width: 800, height: 1280, allowsVerticalScroll: true },
  ]) {
    await page.setViewportSize(viewport);
    for (const view of ["MONITOR", "PLAN"]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      const layout = await page.locator(".flight-workspace-shell").evaluate((element) => {
        const rects = Array.from(element.querySelectorAll<HTMLElement>("[data-flight-panel-host]:not([hidden])"))
          .map((panel) => panel.getBoundingClientRect());
        let overlaps = 0;
        for (let left = 0; left < rects.length; left += 1) {
          for (let right = left + 1; right < rects.length; right += 1) {
            const a = rects[left];
            const b = rects[right];
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps += 1;
          }
        }
        return {
          documentScrollWidth: document.documentElement.scrollWidth,
          overlaps,
          shellBottom: element.getBoundingClientRect().bottom,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
      if (!viewport.allowsVerticalScroll) {
        expect(layout.shellBottom).toBeLessThanOrEqual(layout.viewportHeight);
      }
      expect(layout.overlaps).toBe(0);
    }
  }
});

test("the Ascension orbit rail reflows before telemetry values truncate", async ({ page }) => {
  await page.setViewportSize({ width: 969, height: 900 });
  await page.goto("/");

  const targetNameLayout = async () => page.locator("#asc .target-metric").evaluate((metric) => {
    const subtitle = metric.querySelector<HTMLElement>(".asc-flight-subtitle")!;
    const metricRect = metric.getBoundingClientRect();
    const subtitleRect = subtitle.getBoundingClientRect();
    return {
      clientHeight: subtitle.clientHeight,
      clientWidth: subtitle.clientWidth,
      contained: subtitleRect.left >= metricRect.left - 1
        && subtitleRect.right <= metricRect.right + 1
        && subtitleRect.top >= metricRect.top - 1
        && subtitleRect.bottom <= metricRect.bottom + 1,
      scrollHeight: subtitle.scrollHeight,
      scrollWidth: subtitle.scrollWidth,
      text: subtitle.textContent,
    };
  });
  const expectTargetNameToFit = (layout: Awaited<ReturnType<typeof targetNameLayout>>) => {
    expect(layout.text).toBe("Odyssey Station Docking Port");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
    expect(layout.contained).toBe(true);
  };

  const narrow = await page.locator("#asc .orbit-rail").evaluate((rail) => {
    const stats = Array.from(rail.querySelectorAll<HTMLElement>(".stat"));
    const readouts = Array.from(rail.querySelectorAll<HTMLElement>(".label, .v"));
    return {
      overflowingReadouts: readouts.filter((readout) => readout.scrollWidth > readout.clientWidth + 1).length,
      rows: new Set(stats.map((stat) => Math.round(stat.getBoundingClientRect().top))).size,
    };
  });
  expect(narrow.rows).toBe(2);
  expect(narrow.overflowingReadouts).toBe(0);
  expectTargetNameToFit(await targetNameLayout());

  await page.setViewportSize({ width: 1080, height: 1920 });
  const portraitTarget = await page.locator("#asc .orbit-rail").evaluate((rail) => {
    const stats = Array.from(rail.querySelectorAll<HTMLElement>(".stat"));
    return new Set(stats.map((stat) => Math.round(stat.getBoundingClientRect().top))).size;
  });
  expect(portraitTarget).toBe(1);

  await page.setViewportSize({ width: 1920, height: 889 });
  const wideTarget = await page.locator("#asc .orbit-rail").evaluate((rail) => {
    const stats = Array.from(rail.querySelectorAll<HTMLElement>(".stat"));
    return new Set(stats.map((stat) => Math.round(stat.getBoundingClientRect().top))).size;
  });
  expect(wideTarget).toBe(1);
  expectTargetNameToFit(await targetNameLayout());

  await page.setViewportSize({ width: 390, height: 844 });
  expectTargetNameToFit(await targetNameLayout());
});

test("the navball clips every projected world layer to the globe", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");

  const clipping = await page.locator("#asc .navball").evaluate((navball) => {
    const world = navball.querySelector<SVGGElement>(".nav-sphere-world");
    const clipCircle = navball.querySelector<SVGCircleElement>("clipPath circle");
    return {
      cardinalsInside: Boolean(world?.querySelector(".nav-cardinals")),
      clipPath: world?.getAttribute("clip-path"),
      clipRadius: clipCircle?.getAttribute("r"),
      gridInside: Boolean(world?.querySelector(".nav-spherical-grid")),
      horizonInside: Boolean(world?.querySelector(".nav-spherical-horizon")),
      rimInside: Boolean(world?.querySelector(".nav-sphere-rim")),
      skyInside: Boolean(world?.querySelector(".nav-sphere-sky")),
    };
  });

  expect(clipping.clipPath).toMatch(/^url\(#navball-clip-/);
  expect(clipping.clipRadius).toBe("78");
  expect(clipping.skyInside).toBe(true);
  expect(clipping.gridInside).toBe(true);
  expect(clipping.horizonInside).toBe(true);
  expect(clipping.cardinalsInside).toBe(true);
  expect(clipping.rimInside).toBe(false);
});

test("the navball aircraft marker keeps the KSP-style silhouette", async ({ page }) => {
  await page.goto("/");

  const marker = page.locator("#asc .navball");
  await expect(marker.locator(".aircraft")).toHaveAttribute("d", "M52 84 H71 L84 95 L97 84 H116");
  await expect(marker.locator(".aircraft-dot")).toHaveAttribute("r", "2");
});

test("Flight header, Science detail, and PLAN fit a maximized 1080p Chrome content area", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.addInitScript(() => localStorage.setItem("wmc-hidden-panels-v1", JSON.stringify(["conn"])));
  await page.goto("/");

  const layout = async () => page.locator(".flight-workspace-shell").evaluate((shell) => {
    const header = shell.querySelector<HTMLElement>(".status-strip")!.getBoundingClientRect();
    const ascension = shell.querySelector<HTMLElement>("#asc")!.getBoundingClientRect();
    return {
      ascensionLeft: ascension.left,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      headerLeft: header.left,
      shellBottom: shell.getBoundingClientRect().bottom,
    };
  });

  const monitor = await layout();
  expect(Math.abs(monitor.headerLeft - monitor.ascensionLeft)).toBeLessThanOrEqual(1);
  expect(monitor.documentScrollHeight).toBeLessThanOrEqual(monitor.documentClientHeight);
  expect(monitor.shellBottom).toBeLessThanOrEqual(monitor.documentClientHeight);

  await page.getByText("Experiment detail", { exact: true }).click();
  const expanded = await layout();
  expect(expanded.documentScrollHeight).toBeLessThanOrEqual(expanded.documentClientHeight);
  expect(expanded.shellBottom).toBeLessThanOrEqual(expanded.documentClientHeight);
  const scienceScroller = page.locator("#sci .sci-experiment-scroll");
  await expect(scienceScroller).toBeVisible();
  const scienceListBounds = await scienceScroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(scienceListBounds.overflowY).toBe("auto");
  expect(scienceListBounds.clientHeight).toBeLessThanOrEqual(scienceListBounds.scrollHeight);

  await page.getByRole("tab", { name: "PLAN", exact: true }).click();
  const plan = await layout();
  expect(plan.documentScrollHeight).toBeLessThanOrEqual(plan.documentClientHeight);
  expect(plan.shellBottom).toBeLessThanOrEqual(plan.documentClientHeight);
});

test("fixed Flight headers, utility rail, and meter tracks use the compact aligned treatment", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");

  await expect(page.locator("#cons > h2 .tag")).toHaveCount(0);
  await expect(page.locator("#stage > h2 .tag")).toHaveCount(0);

  const tools = page.getByRole("group", { name: "Tools" });
  await expect(tools.locator(":scope > .dashboard-rail-section-label")).toBeVisible();
  const railColors = await tools.locator(":scope > .panel-rail-button").evaluateAll((buttons) => (
    buttons.map((button) => getComputedStyle(button).color)
  ));
  expect(new Set(railColors).size).toBe(1);

  const bars = await page.locator("#heat .heat-temperature-track").evaluateAll((tracks) => (
    tracks.map((track) => {
      const rect = track.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })
  ));
  expect(bars.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...bars.map((bar) => bar.left)) - Math.min(...bars.map((bar) => bar.left))).toBeLessThanOrEqual(1);
  expect(Math.max(...bars.map((bar) => bar.right)) - Math.min(...bars.map((bar) => bar.right))).toBeLessThanOrEqual(1);

  const meterRadii = await page.locator("#cons .meter .track, #elec .ec-meter-track, #heat .heat-temperature-track, #sci .sci-meter-track").evaluateAll((tracks) => (
    tracks.map((track) => getComputedStyle(track).borderRadius)
  ));
  expect(new Set(meterRadii)).toEqual(new Set(["4px"]));
  const consumableFillRadii = await page.locator("#cons .meter .fill").evaluateAll((fills) => (
    fills.map((fill) => getComputedStyle(fill).borderRadius)
  ));
  expect(new Set(consumableFillRadii)).toEqual(new Set(["4px"]));
});

test("reactor detail uses extra runway before internal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");

  const electricity = page.locator("#elec");
  const initialHeight = await electricity.evaluate((element) => element.getBoundingClientRect().height);
  await electricity.getByRole("button", { name: "Open reactor detail" }).click();
  const list = electricity.getByRole("region", { name: "Reactor list" });
  await expect(list).toBeVisible();
  const scrolling = await list.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    return {
      after: element.scrollTop,
      before,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(scrolling.overflowY).toBe("auto");
  expect(scrolling.clientHeight).toBeGreaterThanOrEqual(scrolling.scrollHeight);
  expect(scrolling.after).toBe(scrolling.before);
  const detailHeight = await electricity.evaluate((element) => element.getBoundingClientRect().height);
  expect(detailHeight).toBeGreaterThan(384);
  expect(detailHeight).toBeGreaterThanOrEqual(initialHeight);
  expect(detailHeight).toBeLessThanOrEqual(410);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(889);
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

test("Mission Control contract focus preserves keyboard, scroll, and responsive boundaries", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 889 });
  await page.goto("/");
  await page.getByTitle("Dashboard developer controls").click();
  await page.getByLabel("Telemetry fixture").getByRole("button", { name: "inactive" }).click();
  await page.getByRole("button", { name: "Close dashboard developer controls" }).click();

  const contracts = page.locator(".overview-contracts");
  const explore = contracts.getByRole("button", { name: "Expand contract Explore Duna" });
  await explore.click();
  const focusedExplore = contracts.getByRole("button", { name: "Collapse contract Explore Duna" });
  const detailsId = await focusedExplore.getAttribute("aria-controls");
  expect(detailsId).toBeTruthy();
  await expect(page.locator(`#${detailsId}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Astronaut roster" })).toHaveCount(0);

  const reader = contracts.locator(".overview-contract-focus-scroll");
  await contracts.getByText("More briefing", { exact: true }).click();
  await reader.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await reader.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  await contracts.getByRole("button", { name: "Expand contract Position a satellite in polar orbit" }).click();
  expect(await contracts.locator(".overview-contract-focus-scroll").evaluate((element) => element.scrollTop)).toBe(0);
  await expect(contracts.locator("details[open]")).toHaveCount(0);

  await page.keyboard.press("Escape");
  const returnedSatellite = contracts.getByRole("button", { name: "Expand contract Position a satellite in polar orbit" });
  await expect(returnedSatellite).toBeFocused();
  await expect(page.getByRole("heading", { name: "Astronaut roster" })).toBeVisible();
  await returnedSatellite.click();
  await page.locator(".mission-overview-header h1").click();
  await expect(returnedSatellite).toBeFocused();

  const desktopOverflow = await page.evaluate(() => ({
    alarmOverflow: getComputedStyle(document.querySelector<HTMLElement>(".overview-alarms .overview-card-list")!).overflowY,
    clientHeight: document.documentElement.clientHeight,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(desktopOverflow.alarmOverflow).toBe("auto");
  expect(desktopOverflow.scrollHeight).toBeLessThanOrEqual(desktopOverflow.clientHeight);
  expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1080, height: 1920 },
    { width: 800, height: 1280 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      panelOverflow: Array.from(document.querySelectorAll<HTMLElement>(".overview-section"))
        .some((panel) => panel.scrollWidth > panel.clientWidth + 1),
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.panelOverflow).toBe(false);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  }
});

test("Flight staging presents both conditions without a mode toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const panel = page.locator("#stage");
  await expect(panel.getByText("Total Δv · vacuum")).toBeVisible();
  await expect(panel.getByText("Δv LIVE")).toBeVisible();
  await expect(panel.getByText("Δv VAC")).toBeVisible();
  await expect(panel.getByText("TWR · LIVE", { exact: true })).toHaveAttribute("title", "Full-throttle TWR at live body gravity (Kerbin)");
  await expect(panel.getByRole("button", { name: "CURRENT" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "VACUUM" })).toHaveCount(0);
  await expect(panel.getByText("1 unpowered stage hidden")).toBeVisible();

  const dimensions = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

  const columns = await panel.locator(".stage-table.flight .st-head").evaluate((row) => (
    Array.from(row.children).map((cell) => ({
      clientWidth: (cell as HTMLElement).clientWidth,
      scrollWidth: (cell as HTMLElement).scrollWidth,
      width: cell.getBoundingClientRect().width,
    }))
  ));
  expect(columns[1].scrollWidth).toBeLessThanOrEqual(columns[1].clientWidth);
  expect(columns[2].scrollWidth).toBeLessThanOrEqual(columns[2].clientWidth);
  expect(columns[3].scrollWidth).toBeLessThanOrEqual(columns[3].clientWidth);
  expect(columns[3].width).toBeLessThanOrEqual(columns[1].width + 1);
});
