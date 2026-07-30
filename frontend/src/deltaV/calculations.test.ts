import { describe, expect, it } from "vitest";
import {
  bodiesForSystem,
  bodiesFromTelemetry,
  bodyByName,
  calculateDeltaVPlan,
  calculateSerialDeltaVPlan,
  deltaVSystemForCatalogNames,
  earliestDownstreamDepartureUT,
  liveTransferRequestFor,
  minimumParkingAltitude,
  nextRecurringLocalDepartureUT,
  serialTransferTimingsForRoute,
  transferArcsForRoute,
  transferArcsForSerialRoute,
  transferTimelineConstraint,
  type LiveTransferSolution,
} from "./calculations";

const assistedArrival = { captureBeforeLanding: false, aerocapture: true, atmosphericLanding: true, assistedLandingReserve: 150 };

function stockPlan(overrides: Partial<Parameters<typeof calculateDeltaVPlan>[0]> = {}) {
  return calculateDeltaVPlan({
    system: "stock",
    originName: "Kerbin",
    destinationName: "Mun",
    originEndpoint: "surface",
    destinationEndpoint: "surface",
    returnEndpoint: "surface",
    direction: "oneWay",
    originParkingAltitude: 80_000,
    destinationParkingAltitude: 14_000,
    outboundArrival: assistedArrival,
    returnArrival: assistedArrival,
    marginPercent: 15,
    ...overrides,
  });
}

describe("delta-v mission planning", () => {
  it("builds an ordered multi-stop route with stable segment leg IDs", () => {
    const plan = calculateSerialDeltaVPlan({
      system: "stock",
      start: { bodyName: "Kerbin", endpoint: "surface", parkingAltitude: 80_000 },
      stops: [
        { id: "segment-1", bodyName: "Duna", endpoint: "surface", parkingAltitude: 60_000, arrivalStrategy: assistedArrival },
        { id: "segment-2", bodyName: "Kerbin", endpoint: "surface", parkingAltitude: 80_000, arrivalStrategy: assistedArrival },
      ],
      marginPercent: 15,
    });

    expect(plan.origin.name).toBe("Kerbin");
    expect(plan.destination.name).toBe("Kerbin");
    expect(plan.legs.some((leg) => leg.id === "segment-1-ejection")).toBe(true);
    expect(plan.legs.some((leg) => leg.id === "segment-2-ejection")).toBe(true);
    expect(plan.legs.findIndex((leg) => leg.id === "segment-1-landing")).toBeLessThan(
      plan.legs.findIndex((leg) => leg.id === "segment-2-ascent"),
    );
  });

  it("adds a deorbit burn when a later stop descends from an established orbit on the same body", () => {
    const route = {
      system: "stock" as const,
      start: { bodyName: "Kerbin", endpoint: "orbit" as const, parkingAltitude: 80_000 },
      stops: [
        { id: "segment-1", bodyName: "Duna", endpoint: "orbit" as const, parkingAltitude: 250_000, arrivalStrategy: assistedArrival },
        { id: "segment-2", bodyName: "Duna", endpoint: "surface" as const, parkingAltitude: 60_000, arrivalStrategy: assistedArrival },
      ],
      marginPercent: 0,
    };
    const orbitOnly = calculateSerialDeltaVPlan({ ...route, stops: route.stops.slice(0, 1) });
    const plan = calculateSerialDeltaVPlan(route);
    const deorbit = plan.legs.find((leg) => leg.id === "segment-2-deorbit");
    const landing = plan.legs.find((leg) => leg.id === "segment-2-landing");
    const alternateSurfaceAltitude = calculateSerialDeltaVPlan({
      ...route,
      stops: [route.stops[0], { ...route.stops[1], parkingAltitude: 100_000 }],
    });

    expect(deorbit).toMatchObject({
      label: "Deorbit at Duna",
      kind: "deorbit",
      note: expect.stringContaining("into the atmosphere"),
    });
    expect(deorbit?.deltaV).toBeGreaterThan(0);
    expect(landing?.deltaV).toBe(150);
    expect(plan.landingDeltaV).toBeCloseTo((deorbit?.deltaV ?? 0) + 150, 6);
    expect(plan.nominalDeltaV).toBeCloseTo(orbitOnly.nominalDeltaV + (deorbit?.deltaV ?? 0) + 150, 6);
    expect(alternateSurfaceAltitude.legs.find((leg) => leg.id === "segment-2-deorbit")?.deltaV).toBeCloseTo(deorbit?.deltaV ?? 0, 6);
  });

  it("uses the destination altitude for a same-body surface-to-orbit stop", () => {
    const plan = calculateSerialDeltaVPlan({
      system: "stock",
      start: { bodyName: "Duna", endpoint: "surface", parkingAltitude: 60_000 },
      stops: [
        { id: "segment-1", bodyName: "Duna", endpoint: "orbit", parkingAltitude: 125_000, arrivalStrategy: assistedArrival },
      ],
      marginPercent: 0,
    });
    const ascent = plan.legs.find((leg) => leg.id === "segment-1-ascent");

    expect(ascent).toMatchObject({
      label: "Duna surface → 125\u2009km orbit",
      kind: "ascent",
      note: expect.stringContaining("60.0\u2009km reference orbit"),
    });
    expect(ascent?.note).toContain("planned 125\u2009km orbit");
    expect(ascent?.deltaV).toBeGreaterThan(bodyByName("stock", "Duna")!.ascentBudget!);
    expect(plan.legs.some((leg) => leg.id === "segment-1-ascent-orbit-adjustment")).toBe(false);
  });

  it("keys dated arcs and selected solutions by mission segment", () => {
    const route = {
      system: "stock" as const,
      start: { bodyName: "Kerbin", endpoint: "surface" as const, parkingAltitude: 80_000 },
      stops: [
        { id: "segment-1", bodyName: "Duna", endpoint: "surface" as const, parkingAltitude: 60_000, arrivalStrategy: assistedArrival },
        { id: "segment-2", bodyName: "Kerbin", endpoint: "surface" as const, parkingAltitude: 80_000, arrivalStrategy: assistedArrival },
      ],
    };
    const arcs = transferArcsForSerialRoute(route);
    expect(arcs.map((arc) => arc.direction)).toEqual(["segment-1", "segment-2"]);

    const selectedTransferSolutions = Object.fromEntries(arcs.map((arc, index) => [arc.direction, {
      ...arc,
      arcId: arc.id,
      requestId: `request-${index + 1}`,
      fingerprint: `fingerprint-${index + 1}`,
      departureUT: 1_000_000 + index * 2_000_000,
      arrivalUT: 2_000_000 + index * 2_000_000,
      transferTime: 1_000_000,
      ejectionDeltaV: 1_100 + index * 100,
      arrivalVInfinity: 600,
    }]));
    const plan = calculateSerialDeltaVPlan({ ...route, marginPercent: 0, selectedTransferSolutions });

    expect(plan.transferTimeline["segment-1"]?.arrivalUT).toBe(2_000_000);
    expect(plan.transferTimeline["segment-2"]?.departureUT).toBe(3_000_000);
    expect(plan.legs.find((leg) => leg.id === "segment-1-ejection")?.deltaV).toBe(1_100);
    expect(plan.legs.find((leg) => leg.id === "segment-2-ejection")?.deltaV).toBe(1_200);
  });

  it("reserves porkchops for interplanetary legs and models local moon timing", () => {
    const route = {
      system: "stock" as const,
      start: { bodyName: "Kerbin", endpoint: "orbit" as const, parkingAltitude: 150_000 },
      stops: [
        { id: "segment-1", bodyName: "Jool", endpoint: "orbit" as const, parkingAltitude: 500_000, arrivalStrategy: assistedArrival },
        { id: "segment-2", bodyName: "Laythe", endpoint: "orbit" as const, parkingAltitude: 60_000, arrivalStrategy: assistedArrival },
        { id: "segment-3", bodyName: "Vall", endpoint: "orbit" as const, parkingAltitude: 15_000, arrivalStrategy: assistedArrival },
        { id: "segment-4", bodyName: "Jool", endpoint: "orbit" as const, parkingAltitude: 500_000, arrivalStrategy: assistedArrival },
        { id: "segment-5", bodyName: "Kerbin", endpoint: "orbit" as const, parkingAltitude: 500_000, arrivalStrategy: assistedArrival },
      ],
    };

    expect(transferArcsForSerialRoute(route).map((arc) => arc.direction)).toEqual(["segment-1", "segment-5"]);
    const timings = serialTransferTimingsForRoute(route);
    expect(timings.map(({ segmentId, interplanetary }) => ({ segmentId, interplanetary }))).toEqual([
      { segmentId: "segment-1", interplanetary: true },
      { segmentId: "segment-2", interplanetary: false },
      { segmentId: "segment-3", interplanetary: false },
      { segmentId: "segment-4", interplanetary: false },
      { segmentId: "segment-5", interplanetary: true },
    ]);
    expect(timings.slice(1, 4).every((timing) => timing.modeledTransferTime > 0)).toBe(true);
  });

  it("uses the selected parent parking altitude for direct parent-child transfers", () => {
    const planFromJool = (parkingAltitude: number) => calculateSerialDeltaVPlan({
      system: "stock",
      start: { bodyName: "Jool", endpoint: "orbit", parkingAltitude },
      stops: [{
        id: "laythe",
        bodyName: "Laythe",
        endpoint: "orbit",
        parkingAltitude: 150_000,
        arrivalStrategy: { ...assistedArrival, aerocapture: false },
      }],
      marginPercent: 0,
    });
    const lowOrbit = planFromJool(210_000);
    const highOrbit = planFromJool(600_000);
    const lowDeparture = lowOrbit.legs.find((leg) => leg.kind === "departure")!;
    const highDeparture = highOrbit.legs.find((leg) => leg.kind === "departure")!;

    expect(highDeparture.label).toBe("Jool → Laythe transfer");
    expect(highDeparture.deltaV).toBeLessThan(lowDeparture.deltaV);
    expect(lowDeparture.deltaV - highDeparture.deltaV).toBeGreaterThan(90);

    const returnPlan = calculateSerialDeltaVPlan({
      system: "stock",
      start: { bodyName: "Pol", endpoint: "orbit", parkingAltitude: 75_000 },
      stops: [{
        id: "jool",
        bodyName: "Jool",
        endpoint: "orbit",
        parkingAltitude: 600_000,
        arrivalStrategy: { ...assistedArrival, aerocapture: false },
      }],
      marginPercent: 0,
    });
    expect(returnPlan.legs.find((leg) => leg.kind === "capture")?.label).toBe("600\u2009km Capture at Jool");
  });

  it("finds the next recurring same-parent Hohmann window from live orbital phase", () => {
    const catalog = bodiesForSystem("stock").map((body) =>
      body.name === "Laythe"
        ? { ...body, source: "live" as const, orbitEpoch: 0, meanLongitudeAtEpoch: 0 }
        : body.name === "Vall"
          ? { ...body, source: "live" as const, orbitEpoch: 0, meanLongitudeAtEpoch: 1 }
          : body,
    );
    const [timing] = serialTransferTimingsForRoute({
      system: "stock",
      catalog,
      start: { bodyName: "Laythe", endpoint: "orbit", parkingAltitude: 150_000 },
      stops: [{
        id: "vall",
        bodyName: "Vall",
        endpoint: "orbit",
        parkingAltitude: 75_000,
        arrivalStrategy: assistedArrival,
      }],
    });
    expect(timing.localWindow).toBeTruthy();

    const departureUT = nextRecurringLocalDepartureUT(timing, 10_000);
    expect(departureUT).toBeGreaterThanOrEqual(10_000);
    const window = timing.localWindow!;
    const originLongitude = window.originMeanLongitudeAtEpoch + window.originMeanMotion * (departureUT - window.originEpoch);
    const destinationLongitude = window.destinationMeanLongitudeAtEpoch + window.destinationMeanMotion * (departureUT - window.destinationEpoch);
    const phaseError = ((destinationLongitude - originLongitude - window.targetPhaseAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    expect(Math.min(phaseError, 2 * Math.PI - phaseError)).toBeLessThan(1e-9);
  });

  it("rejects endpoint parking altitudes below an atmosphere", () => {
    expect(() => stockPlan({ originParkingAltitude: 70_999 })).toThrow(
      "Origin parking altitude for Kerbin must be at least 71000 m.",
    );
    expect(() => stockPlan({
      destinationName: "Duna",
      destinationParkingAltitude: 50_999,
    })).toThrow("Destination parking altitude for Duna must be at least 51000 m.");
  });

  it("accepts parking altitudes exactly at the atmospheric minimum", () => {
    const kerbin = bodyByName("stock", "Kerbin");
    const duna = bodyByName("stock", "Duna");
    expect(kerbin && minimumParkingAltitude(kerbin)).toBe(71_000);
    expect(duna && minimumParkingAltitude(duna)).toBe(51_000);
    expect(() => stockPlan({
      destinationName: "Duna",
      originParkingAltitude: 71_000,
      destinationParkingAltitude: 51_000,
    })).not.toThrow();
  });

  it("enforces the 1000 m minimum on selected vacuum endpoints", () => {
    const mun = bodyByName("stock", "Mun");
    expect(mun && minimumParkingAltitude(mun)).toBe(1_000);
    expect(() => stockPlan({ destinationParkingAltitude: 999 })).toThrow(
      "Destination parking altitude for Mun must be at least 1000 m.",
    );
    expect(() => stockPlan({
      originName: "Mun",
      destinationName: "Ike",
      originEndpoint: "orbit",
      destinationEndpoint: "orbit",
      originParkingAltitude: 1_000,
      destinationParkingAltitude: 1_000,
    })).not.toThrow();
  });

  it("identifies the one MechJeb-compatible outbound arc", () => {
    expect(liveTransferRequestFor({ system: "stock", originName: "Kerbin", destinationName: "Mun", originParkingAltitude: 80_000, destinationParkingAltitude: 14_000, destinationEndpoint: "orbit", outboundArrival: assistedArrival })).toBeNull();
    expect(liveTransferRequestFor({ system: "stock", originName: "Laythe", destinationName: "Vall", originParkingAltitude: 60_000, destinationParkingAltitude: 15_000, destinationEndpoint: "orbit", outboundArrival: assistedArrival })).toBeNull();
    expect(liveTransferRequestFor({ system: "stock", originName: "Mun", destinationName: "Ike", originParkingAltitude: 14_000, destinationParkingAltitude: 10_000, destinationEndpoint: "orbit", outboundArrival: assistedArrival })).toMatchObject({ origin: "Kerbin", destination: "Duna", originParkingAltitude: 80_000, destinationParkingAltitude: 60_000, optimizePoweredCapture: true });
  });

  it("describes stable outbound and return arcs for a round trip", () => {
    const arcs = transferArcsForRoute({
      system: "stock",
      originName: "Mun",
      destinationName: "Ike",
      originParkingAltitude: 14_000,
      destinationParkingAltitude: 10_000,
      destinationEndpoint: "orbit",
      outboundArrival: assistedArrival,
      direction: "roundTrip",
      returnEndpoint: "orbit",
      returnArrival: assistedArrival,
    });

    expect(arcs).toEqual([
      expect.objectContaining({ id: "outbound-solar-transfer", direction: "outbound", routeLegId: "outbound-primary-ejection", origin: "Kerbin", destination: "Duna" }),
      expect.objectContaining({ id: "return-solar-transfer", direction: "return", routeLegId: "return-primary-ejection", origin: "Duna", destination: "Kerbin" }),
    ]);
  });

  it("applies independent dated porkchop selections to outbound and return arcs", () => {
    const outbound: LiveTransferSolution = {
      arcId: "outbound-transfer", requestId: "out", fingerprint: "out-fp", origin: "Kerbin", destination: "Duna",
      originParkingAltitude: 80_000, destinationParkingAltitude: 60_000, optimizePoweredCapture: true,
      departureUT: 1_000, arrivalUT: 2_000, transferTime: 1_000, ejectionDeltaV: 1_111, arrivalVInfinity: 700,
    };
    const inbound: LiveTransferSolution = {
      arcId: "return-transfer", requestId: "return", fingerprint: "return-fp", origin: "Duna", destination: "Kerbin",
      originParkingAltitude: 60_000, destinationParkingAltitude: 80_000, optimizePoweredCapture: true,
      departureUT: 3_000, arrivalUT: 4_000, transferTime: 1_000, ejectionDeltaV: 777, arrivalVInfinity: 900,
    };
    const plan = stockPlan({
      destinationName: "Duna",
      destinationEndpoint: "orbit",
      returnEndpoint: "orbit",
      destinationParkingAltitude: 60_000,
      outboundArrival: { ...assistedArrival, aerocapture: false },
      returnArrival: { ...assistedArrival, aerocapture: false },
      direction: "roundTrip",
      selectedTransferSolutions: { outbound, return: inbound },
    });

    expect(plan.legs.find((leg) => leg.id === "outbound-ejection")?.deltaV).toBe(1_111);
    expect(plan.legs.find((leg) => leg.id === "return-ejection")?.deltaV).toBe(777);
    expect(plan.legs.find((leg) => leg.id === "return-ejection")).toMatchObject({ label: "Duna → Kerbin transfer", departureUT: 3_000, arrivalUT: 4_000, transferArcId: "return-transfer" });
    expect(plan.outboundTransferSource).toBe("mechjeb");
    expect(plan.returnTransferSource).toBe("mechjeb");
    expect(plan.transferTimeline).toEqual({
      outbound: expect.objectContaining({ arcId: "outbound-transfer", departureUT: 1_000, arrivalUT: 2_000 }),
      return: expect.objectContaining({ arcId: "return-transfer", departureUT: 3_000, arrivalUT: 4_000 }),
    });
  });

  it("reports downstream timing constraints and conflicts", () => {
    expect(earliestDownstreamDepartureUT(2_000, 600)).toBe(2_600);
    expect(earliestDownstreamDepartureUT(undefined, 600)).toBeNull();
    expect(transferTimelineConstraint({ arrivalUT: 2_000 }, 600, { departureUT: 2_500, arrivalUT: 3_500 })).toEqual({
      earliestDepartureUT: 2_600,
      departureUT: 2_500,
      arrivalUT: 3_500,
      conflict: true,
      message: "Timeline conflict—choose another downstream transfer window.",
    });
    expect(transferTimelineConstraint({ arrivalUT: 2_000 }, 600, { departureUT: 2_600, arrivalUT: 3_600 }).conflict).toBe(false);
    expect(() => earliestDownstreamDepartureUT(2_000, -1)).toThrow(/Stay duration/);
  });

  it("uses a live MechJeb ejection and converts arrival v-infinity into a powered capture burn", () => {
    const liveTransferSolution: LiveTransferSolution = {
      requestId: "request-1", fingerprint: "fingerprint-1", origin: "Kerbin", destination: "Duna",
      originParkingAltitude: 80_000, destinationParkingAltitude: 60_000, optimizePoweredCapture: true,
      departureUT: 1_000_000, arrivalUT: 2_000_000, transferTime: 1_000_000,
      ejectionDeltaV: 1_234, arrivalVInfinity: 880,
    };
    const plan = stockPlan({ destinationName: "Duna", destinationEndpoint: "orbit", destinationParkingAltitude: 60_000, outboundArrival: { ...assistedArrival, aerocapture: false }, liveTransferSolution });

    expect(plan.legs.find((leg) => leg.id === "outbound-ejection")?.deltaV).toBe(1_234);
    expect(plan.legs.find((leg) => leg.id === "outbound-capture")?.deltaV).toBeGreaterThan(0);
    expect(plan.legs.filter((leg) => leg.transferSource === "mechjeb")).toHaveLength(2);
    expect(plan.outboundTransferSource).toBe("mechjeb");
    expect(plan.transferTime).toBe(1_000_000);
  });

  it("keeps atmospheric arrival free while using the selected live transfer", () => {
    const solution: LiveTransferSolution = {
      requestId: "request-2", fingerprint: "fingerprint-2", origin: "Kerbin", destination: "Duna",
      originParkingAltitude: 80_000, destinationParkingAltitude: 60_000, optimizePoweredCapture: false,
      departureUT: 1, arrivalUT: 2, transferTime: 1, ejectionDeltaV: 1_111, arrivalVInfinity: 999,
    };
    const assisted = stockPlan({ destinationName: "Duna", destinationEndpoint: "surface", destinationParkingAltitude: 60_000, liveTransferSolution: solution });

    expect(assisted.legs.find((leg) => leg.id === "outbound-ejection")?.deltaV).toBe(1_111);
    expect(assisted.legs.find((leg) => leg.id === "outbound-ejection")?.label).toBe("Kerbin → Duna transfer");
    expect(assisted.legs.find((leg) => leg.id === "outbound-capture")?.deltaV).toBe(0);
    expect(assisted.legs.some((leg) => leg.kind === "transfer" && leg.deltaV === 0)).toBe(false);
  });

  it("keeps a selected trajectory when its arrival changes from aerocapture to powered capture", () => {
    const solution: LiveTransferSolution = {
      requestId: "request-capture-strategy", fingerprint: "fingerprint-capture-strategy", origin: "Kerbin", destination: "Duna",
      originParkingAltitude: 80_000, destinationParkingAltitude: 60_000, optimizePoweredCapture: false,
      departureUT: 1_000, arrivalUT: 2_000, transferTime: 1_000, ejectionDeltaV: 1_111, arrivalVInfinity: 999,
    };
    const plan = stockPlan({
      destinationName: "Duna",
      destinationEndpoint: "surface",
      destinationParkingAltitude: 60_000,
      outboundArrival: { ...assistedArrival, captureBeforeLanding: true, aerocapture: false },
      selectedTransferSolutions: { outbound: solution },
    });

    expect(plan.outboundTransferSource).toBe("mechjeb");
    expect(plan.legs.find((leg) => leg.id === "outbound-ejection")?.deltaV).toBe(1_111);
    expect(plan.legs.find((leg) => leg.id === "outbound-capture")?.deltaV).toBeGreaterThan(0);
    expect(plan.transferTimeline.outbound).toEqual(expect.objectContaining({ departureUT: 1_000, arrivalUT: 2_000 }));
  });

  it("overrides only the outbound primary arc on hierarchical and round-trip routes", () => {
    const solution: LiveTransferSolution = {
      requestId: "request-3", fingerprint: "fingerprint-3", origin: "Kerbin", destination: "Duna",
      originParkingAltitude: 80_000, destinationParkingAltitude: 60_000, optimizePoweredCapture: true,
      departureUT: 10, arrivalUT: 20, transferTime: 10, ejectionDeltaV: 1_010, arrivalVInfinity: 700,
    };
    const base = stockPlan({ originName: "Mun", destinationName: "Ike", originEndpoint: "orbit", destinationEndpoint: "orbit", originParkingAltitude: 14_000, destinationParkingAltitude: 10_000, direction: "roundTrip" });
    const live = stockPlan({ originName: "Mun", destinationName: "Ike", originEndpoint: "orbit", destinationEndpoint: "orbit", originParkingAltitude: 14_000, destinationParkingAltitude: 10_000, direction: "roundTrip", liveTransferSolution: solution });
    const unchangedIds = base.legs.filter((leg) => !leg.id.includes("primary") && !leg.id.includes("solar") && leg.id.startsWith("outbound")).map((leg) => leg.id);

    for (const id of unchangedIds) expect(live.legs.find((leg) => leg.id === id)?.deltaV).toBe(base.legs.find((leg) => leg.id === id)?.deltaV);
    expect(live.legs.find((leg) => leg.id === "outbound-primary-ejection")?.deltaV).toBe(1_010);
    expect(live.legs.filter((leg) => leg.id.startsWith("return-")).map((leg) => leg.deltaV)).toEqual(base.legs.filter((leg) => leg.id.startsWith("return-")).map((leg) => leg.deltaV));
  });
  it("automatically enables the OPM catalog when OPM primaries are detected", () => {
    expect(deltaVSystemForCatalogNames(["Sun", "Kerbin", "Mun"])).toBe("stock");
    expect(deltaVSystemForCatalogNames(["Sun", "Kerbin", "Sarnus", "Urlum"])).toBe("opm");
  });

  it("builds a planner catalog for arbitrary kRPC and Kopernicus bodies", () => {
    const common = {
      rotationPeriod: 30_000,
      sphereOfInfluence: 10_000_000,
      parent: "Sun",
      parentGravitationalParameter: 1.1723328e18,
      surfaceGravity: 4,
      solidSurface: true,
      atmosphereDensityAltitudes: [0, 50_000, 100_000],
      atmosphereDensities: [1.4, 0.01, 0],
    };
    const catalog = bodiesFromTelemetry([
      { ...common, name: "Gaia", semiMajorAxis: 15_000_000_000, gravitationalParameter: 4e12, radius: 700_000, atmosphereDepth: 100_000 },
      { ...common, name: "Ares", semiMajorAxis: 24_000_000_000, gravitationalParameter: 7e11, radius: 400_000, atmosphereDepth: 60_000 },
      { ...common, name: "Phobos", parent: "Ares", parentGravitationalParameter: 7e11, semiMajorAxis: 4_000_000, gravitationalParameter: 8e8, radius: 40_000, atmosphereDepth: 0, atmosphereDensityAltitudes: [], atmosphereDensities: [] },
    ]);

    expect(catalog.map((body) => body.name)).toEqual(expect.arrayContaining(["Gaia", "Ares", "Phobos"]));
    expect(catalog.find((body) => body.name === "Gaia")).toMatchObject({ source: "live", parent: "Sun", solidSurface: true });
    expect(catalog.find((body) => body.name === "Gaia")?.ascentBudget).toBeGreaterThan(0);
    const route = {
      system: "stock" as const,
      catalog,
      start: { bodyName: "Gaia", endpoint: "orbit" as const, parkingAltitude: 120_000 },
      stops: [{ id: "segment-custom", bodyName: "Phobos", endpoint: "orbit" as const, parkingAltitude: 10_000, arrivalStrategy: assistedArrival }],
    };
    expect(transferArcsForSerialRoute(route)).toEqual([
      expect.objectContaining({ origin: "Gaia", destination: "Ares", direction: "segment-custom" }),
    ]);
    expect(() => calculateSerialDeltaVPlan({ ...route, marginPercent: 10 })).not.toThrow();

    const gaia = catalog.find((body) => body.name === "Gaia")!;
    const surfaceRoute = calculateSerialDeltaVPlan({
      ...route,
      start: {
        bodyName: "Gaia",
        endpoint: "surface",
        parkingAltitude: gaia.defaultParkingAltitude + 100_000,
      },
      marginPercent: 0,
    });
    expect(surfaceRoute.legs.find((leg) => leg.id === "segment-custom-ascent")).toMatchObject({
      deltaV: gaia.ascentBudget,
      note: expect.stringContaining("Generic gravity-and-atmosphere estimate"),
    });
    expect(surfaceRoute.legs.find((leg) => leg.id === "segment-custom-ascent-orbit-adjustment")?.deltaV).toBeGreaterThan(0);
  });

  it("builds a finite Kerbin surface to Mun surface route with an explicit landing leg", () => {
    const plan = stockPlan();
    expect(plan.nominalDeltaV).toBeGreaterThan(4_000);
    expect(plan.totalDeltaV).toBeCloseTo(plan.nominalDeltaV * 1.15, 6);
    expect(plan.legs.some((leg) => leg.kind === "ascent" && leg.deltaV === 3_400)).toBe(true);
    expect(plan.legs.some((leg) => leg.kind === "landing" && leg.deltaV > 0)).toBe(true);
  });

  it("adds an explicit parking-orbit adjustment above a curated ascent reference orbit", () => {
    const defaultOrbit = stockPlan({ marginPercent: 0 });
    const highOrbit = stockPlan({ marginPercent: 0, originParkingAltitude: 350_000 });
    const adjustment = highOrbit.legs.find((leg) => leg.id === "outbound-ascent-orbit-adjustment");

    expect(defaultOrbit.legs.some((leg) => leg.id === "outbound-ascent-orbit-adjustment")).toBe(false);
    expect(highOrbit.legs.find((leg) => leg.id === "outbound-ascent")).toMatchObject({
      deltaV: 3_400,
      note: expect.stringContaining("80.0\u2009km reference orbit"),
    });
    expect(adjustment).toMatchObject({
      label: "Raise Kerbin parking orbit to 350\u2009km",
      kind: "ascent",
      note: expect.stringContaining("80.0\u2009km to 350\u2009km"),
    });
    expect(adjustment?.deltaV).toBeCloseTo(348.428876, 6);
  });

  it("derives and rounds a circularization reserve after aerocapture", () => {
    const plan = stockPlan({
      destinationName: "Duna",
      destinationEndpoint: "orbit",
      destinationParkingAltitude: 60_000,
    });
    const capture = plan.legs.find((leg) => leg.id === "outbound-capture");

    expect(capture?.deltaV).toBeGreaterThanOrEqual(50);
    expect((capture?.deltaV ?? 1) % 50).toBe(0);
    expect(capture?.aerocaptureEstimateAvailable).toBe(true);
    expect(capture?.note).toMatch(/Reference aerocapture/);
  });

  it("uses atmospheric assistance to reduce a Kerbin landing to its assisted landing reserve", () => {
    const base = { originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit" as const, originParkingAltitude: 14_000, destinationParkingAltitude: 80_000 };
    const assisted = stockPlan({ ...base, outboundArrival: { ...assistedArrival, assistedLandingReserve: 120 } });
    const powered = stockPlan({ ...base, outboundArrival: { ...assistedArrival, atmosphericLanding: false, assistedLandingReserve: 120 } });
    expect(assisted.landingDeltaV).toBe(120);
    expect(powered.landingDeltaV).toBeGreaterThan(assisted.landingDeltaV);
    expect(powered.nominalDeltaV).toBeGreaterThan(assisted.nominalDeltaV);
  });

  it("models a Mun return as direct Kerbin re-entry when capture before landing is disabled", () => {
    const assisted = stockPlan({ direction: "roundTrip", returnArrival: { ...assistedArrival, assistedLandingReserve: 120 } });
    const powered = stockPlan({ direction: "roundTrip", returnArrival: { captureBeforeLanding: true, aerocapture: false, atmosphericLanding: false, assistedLandingReserve: 120 } });
    const assistedCapture = assisted.legs.find((leg) => leg.id.startsWith("return-") && leg.label === "Direct atmospheric arrival at Kerbin");
    const poweredCapture = powered.legs.find((leg) => leg.id.startsWith("return-") && leg.label.endsWith("Capture at Kerbin"));

    expect(assistedCapture?.deltaV).toBe(0);
    expect(assistedCapture?.note).toMatch(/Skip parking-orbit capture/);
    expect(assisted.legs.find((leg) => leg.id === "return-landing")?.deltaV).toBe(120);
    expect(poweredCapture?.deltaV).toBeGreaterThan(0);
    expect(powered.nominalDeltaV).toBeGreaterThan(assisted.nominalDeltaV);
  });

  it("lets a surface-launched round trip end in Kerbin parking orbit instead of landing", () => {
    const parkingReturn = stockPlan({ direction: "roundTrip", returnEndpoint: "orbit", returnArrival: { ...assistedArrival, assistedLandingReserve: 120 } });
    const landingReturn = stockPlan({ direction: "roundTrip", returnEndpoint: "surface", returnArrival: { ...assistedArrival, assistedLandingReserve: 120 } });
    const circularization = parkingReturn.legs.find((leg) => leg.label.endsWith("Capture at Kerbin"))?.deltaV ?? 0;

    expect(parkingReturn.legs.some((leg) => leg.id === "return-landing")).toBe(false);
    expect(circularization).toBeGreaterThanOrEqual(50);
    expect(circularization % 50).toBe(0);
    expect(landingReturn.legs.find((leg) => leg.id === "return-landing")?.deltaV).toBe(120);
    expect(parkingReturn.nominalDeltaV).toBe(landingReturn.nominalDeltaV + circularization - 120);
  });

  it("supports powered capture before an assisted atmospheric landing", () => {
    const direct = stockPlan({ originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit", destinationParkingAltitude: 80_000, outboundArrival: { ...assistedArrival, assistedLandingReserve: 120 } });
    const captured = stockPlan({ originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit", destinationParkingAltitude: 80_000, outboundArrival: { captureBeforeLanding: true, aerocapture: false, atmosphericLanding: true, assistedLandingReserve: 120 } });
    const captureLeg = captured.legs.find((leg) => leg.label.endsWith("Capture at Kerbin"));
    const deorbitLeg = captured.legs.find((leg) => leg.label === "Deorbit at Kerbin");

    expect(captureLeg?.deltaV).toBeGreaterThan(0);
    expect(deorbitLeg?.deltaV).toBeGreaterThan(0);
    expect(deorbitLeg?.note).toMatch(/into the atmosphere/);
    expect(captured.legs.find((leg) => leg.kind === "landing")?.deltaV).toBe(120);
    expect(captured.nominalDeltaV).toBeGreaterThan(direct.nominalDeltaV);
  });

  it("splits powered deorbit from descent without double-counting landing delta-v", () => {
    const directPowered = stockPlan({ originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit", destinationParkingAltitude: 80_000, outboundArrival: { ...assistedArrival, atmosphericLanding: false } });
    const capturedPowered = stockPlan({ originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit", destinationParkingAltitude: 80_000, outboundArrival: { ...assistedArrival, captureBeforeLanding: true, aerocapture: false, atmosphericLanding: false } });

    expect(capturedPowered.legs.find((leg) => leg.kind === "deorbit")?.deltaV).toBeGreaterThan(0);
    expect(capturedPowered.landingDeltaV).toBeCloseTo(directPowered.landingDeltaV, 6);
  });

  it("inserts user-estimated custom steps into the route and budget", () => {
    const base = stockPlan();
    const anchor = base.legs[0].id;
    const customized = stockPlan({ customSteps: [
      { id: "custom-1", afterLegId: anchor, label: "Maneuver adjustment", deltaV: 80 },
      { id: "custom-2", afterLegId: "custom-1", label: "Rendezvous", deltaV: 120 },
    ] });

    expect(customized.nominalDeltaV).toBe(base.nominalDeltaV + 200);
    expect(customized.totalDeltaV).toBeCloseTo((base.nominalDeltaV + 200) * 1.15, 6);
    expect(customized.legs.slice(1, 3).map((leg) => leg.label)).toEqual(["Maneuver adjustment", "Rendezvous"]);
  });

  it("allows aerocapture into parking orbit with only the circularization reserve", () => {
    const aerocapture = stockPlan({ originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit", destinationEndpoint: "orbit", destinationParkingAltitude: 80_000, outboundArrival: assistedArrival });
    const poweredCapture = stockPlan({ originName: "Mun", destinationName: "Kerbin", originEndpoint: "orbit", destinationEndpoint: "orbit", destinationParkingAltitude: 80_000, outboundArrival: { ...assistedArrival, aerocapture: false } });

    const circularization = aerocapture.legs.find((leg) => leg.label.endsWith("Capture at Kerbin"))?.deltaV ?? 0;
    const powered = poweredCapture.legs.find((leg) => leg.label.endsWith("Capture at Kerbin"))?.deltaV ?? 0;
    expect(circularization).toBeGreaterThanOrEqual(50);
    expect(circularization % 50).toBe(0);
    expect(powered).toBeGreaterThan(circularization);
  });

  it("includes the complete OPM body profile and relocates Eeloo to Sarnus", () => {
    const names = bodiesForSystem("opm").map((candidate) => candidate.name);
    expect(names).toContain("Sarnus");
    expect(names).toContain("Urlum");
    expect(names).toContain("Neidon");
    expect(names).toContain("Plock");
    expect(names).toContain("Karen");
    expect(bodyByName("opm", "Eeloo")?.parent).toBe("Sarnus");
    expect(bodyByName("stock", "Eeloo")?.parent).toBe("Sun");
  });

  it("supports an OPM interplanetary surface mission", () => {
    const plan = calculateDeltaVPlan({
      system: "opm",
      originName: "Kerbin",
      destinationName: "Slate",
      originEndpoint: "surface",
      destinationEndpoint: "surface",
      returnEndpoint: "surface",
      direction: "oneWay",
      originParkingAltitude: 80_000,
      destinationParkingAltitude: 45_000,
      outboundArrival: assistedArrival,
      returnArrival: assistedArrival,
      marginPercent: 20,
    });
    expect(plan.legs.some((leg) => leg.label.includes("Sarnus"))).toBe(true);
    expect(plan.transferTime).toBeGreaterThan(0);
    expect(plan.totalDeltaV).toBeCloseTo(plan.nominalDeltaV * 1.2, 6);
  });

  it("rejects a surface endpoint on a gas giant", () => {
    expect(() => stockPlan({ destinationName: "Jool", destinationEndpoint: "surface", destinationParkingAltitude: 210_000 })).toThrow(/landable surface/);
  });
});
