export const PRODUCT_NAME = "Woobie's Mission Control";
export const PRODUCT_VERSION = "0.4.2";

export function dashboardFooter(buildLabel: "Development" | "Production") {
  return `${PRODUCT_NAME} · React dashboard · v${PRODUCT_VERSION} · ${buildLabel}`;
}
