import { expect, test } from "@playwright/test";

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

test("both mission planners remain usable at a normal desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  await expect(page.getByText("React dashboard · v0.6.0", { exact: false })).toBeVisible();
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
    const stage = bounds("#stage");
    const summary = bounds("#editorSummary");
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
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      ninthRowScrolls,
      overflowingHeaderValues: Array.from(workspace.querySelectorAll<HTMLElement>("#editorContext h1, #editorContext .editor-overview-metric strong, #editorContext .editor-overview-metric small"))
        .filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      poweredRows: workspace.querySelectorAll('.stage-table.editor [role="row"][data-stage-ksp]').length,
      secondaryChildren: workspace.querySelector(".editor-workspace-secondary")!.children.length,
      stageSummaryGap: summary.left - stage.right,
      stageSummaryTopDifference: Math.abs(stage.top - summary.top),
      tableClientHeight: table.clientHeight,
      tableScrollHeight: table.scrollHeight,
    };
  });

  expect(layout.secondaryChildren).toBe(0);
  expect(layout.contextMatchesWorkspace).toBeLessThanOrEqual(1);
  expect(layout.contextContentGap).toBeGreaterThanOrEqual(10);
  expect(layout.stageSummaryGap).toBeGreaterThanOrEqual(10);
  expect(layout.stageSummaryTopDifference).toBeLessThanOrEqual(1);
  expect(layout.poweredRows).toBe(8);
  expect(layout.tableScrollHeight).toBeLessThanOrEqual(layout.tableClientHeight + 1);
  expect(layout.ninthRowScrolls).toBe(true);
  expect(layout.activeFullyVisible).toBe(true);
  expect(layout.overflowingHeaderValues).toBe(0);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight);
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
    const orbit = bounds("#editorOrbitPlan");
    return {
      documentClientHeight: document.documentElement.clientHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      orbitContextGap: orbit.top - context.bottom,
      orbitHeight: orbit.height,
      secondaryChildren: element.querySelector(".editor-workspace-secondary")!.children.length,
    };
  });
  expect(orbitOnly.secondaryChildren).toBe(1);
  expect(orbitOnly.orbitContextGap).toBeGreaterThanOrEqual(10);
  expect(orbitOnly.orbitHeight).toBeLessThanOrEqual(220);
  expect(orbitOnly.documentScrollWidth).toBeLessThanOrEqual(orbitOnly.documentClientWidth);
  expect(orbitOnly.documentScrollHeight).toBeLessThanOrEqual(orbitOnly.documentClientHeight);

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
    const stage = bounds("#stage");
    const summary = bounds("#editorSummary");
    const orbit = bounds("#editorOrbitPlan");
    const deltaV = bounds("#editorDeltaVPlan");
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
      deltaVHeaderHeight: deltaVHeader.height,
      deltaVEditHeight: deltaVEdit.height,
      deltaVHeight: deltaV.height,
      deltaVUnpinHeight: deltaVUnpin.height,
      coverageFooterFontSize: Number.parseFloat(getComputedStyle(element.querySelector<HTMLElement>("#editorDeltaVPlan .delta-v-editor-coverage footer")!).fontSize),
      overflowingMissionValues: Array.from(element.querySelectorAll<HTMLElement>("#editorDeltaVPlan strong, #editorDeltaVPlan .delta-v-pinned-step-copy"))
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
      secondaryChildren: element.querySelector(".editor-workspace-secondary")!.children.length,
      stageSummaryGap: summary.left - stage.right,
      stageSummaryTopDifference: Math.abs(stage.top - summary.top),
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
  expect(layout.stageSummaryGap).toBeGreaterThanOrEqual(10);
  expect(layout.stageSummaryTopDifference).toBeLessThanOrEqual(1);
  expect(layout.tableScrollHeight).toBeLessThanOrEqual(layout.tableClientHeight + 1);
  expect(layout.overflowingHeaderValues).toBe(0);
  expect(layout.overflowingMissionValues).toBe(0);
  expect(layout.overflowingOrbitValues).toBe(0);
  expect(layout.overflowingResourceNames).toBe(0);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight);

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
      overflowingOrbitValues: Array.from(element.querySelectorAll<HTMLElement>("#editorOrbitPlan .resonant-editor-plan-details strong, #editorOrbitPlan .resonant-editor-plan-details > header > span"))
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
  expect(medium.topDifference).toBeLessThanOrEqual(1);
  expect(medium.tableScrollHeight).toBeGreaterThan(medium.tableClientHeight);
  expect(medium.documentScrollWidth).toBeLessThanOrEqual(medium.documentClientWidth);
  expect(medium.documentScrollHeight).toBeLessThanOrEqual(medium.documentClientHeight);

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

test("the wide Flight context and annunciator fit long mission times in one compact row", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/");

  const missionElapsed = page.locator(".met-cell .big");
  await missionElapsed.evaluate((element) => {
    element.textContent = "T+ 999999d 05:59:59";
  });

  const layout = await page.locator(".status-strip").evaluate((element) => {
    const cells = Array.from(element.querySelectorAll(".flight-context-identity, .clockcell, .cs-cell, .flight-annunciator"));
    const tops = cells.map((cell) => cell.getBoundingClientRect().top);
    const elapsed = element.querySelector<HTMLElement>(".met-cell .big")!;
    return {
      height: element.getBoundingClientRect().height,
      maxTopDifference: Math.max(...tops) - Math.min(...tops),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      elapsedClientWidth: elapsed.clientWidth,
      elapsedScrollWidth: elapsed.scrollWidth,
      elapsedWhiteSpace: getComputedStyle(elapsed).whiteSpace,
    };
  });

  expect(layout.height).toBeLessThan(100);
  expect(layout.maxTopDifference).toBeLessThanOrEqual(1);
  expect(layout.clientWidth).toBeLessThan(1600);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.elapsedWhiteSpace).toBe("nowrap");
  expect(layout.elapsedScrollWidth).toBeLessThanOrEqual(layout.elapsedClientWidth + 1);
});

test("the Flight annunciator uses fixed acknowledgement-state indicators", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto("/");

  const lamp = page.locator(".annunciator-lamp");
  await expect(lamp).toBeVisible();
  await expect(lamp).toHaveAttribute("aria-label", /Master warning, unacknowledged/);
  const indicators = page.getByRole("group", { name: "Flight alert indicators" });
  await expect(indicators.getByRole("button")).toHaveCount(5);
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

test("Flight MONITOR and PLAN remain overlap-free at both proposal targets", async ({ page }) => {
  await page.goto("/");
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
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
      expect(layout.shellBottom).toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.overlaps).toBe(0);
    }
  }
});

test("the Ascension orbit rail reflows before telemetry values truncate", async ({ page }) => {
  await page.setViewportSize({ width: 969, height: 900 });
  await page.goto("/");

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

test("fixed Flight headers, utility rail, and Heat rows use the compact aligned treatment", async ({ page }) => {
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
