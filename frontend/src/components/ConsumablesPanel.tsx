import { formatResourcePair, humanizeResourceName } from "../formatting/numbers";
import { selectConsumables } from "../telemetry/selectors";
import type { TelemetrySnapshot } from "../telemetry/types";
import { Panel } from "./Panel";
import { resourceSeverity } from "./resourceMeter";

interface ConsumablesPanelProps {
  snapshot: TelemetrySnapshot;
}

function ResourceMeter({
  current,
  maximum,
  fraction,
}: ReturnType<typeof selectConsumables>[number]["vessel"]) {
  const percent = fraction === undefined ? 0 : Math.round(fraction * 100);
  const severity = resourceSeverity(percent);
  const hasCapacity = maximum !== undefined && maximum > 0;
  const amount = formatResourcePair(current, maximum);

  return (
    <div
      aria-label={fraction === undefined ? "Amount unavailable" : `${percent}% remaining`}
      aria-valuemax={fraction === undefined ? undefined : 100}
      aria-valuemin={fraction === undefined ? undefined : 0}
      aria-valuenow={fraction === undefined ? undefined : percent}
      className="meter"
      role={fraction === undefined ? "img" : "meter"}
    >
      <div className="track">
        <span className={`fill ${severity}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="cap" aria-hidden="true">
        <span>{hasCapacity ? amount.value : "—"}</span>
        <span className="k">/ {hasCapacity ? amount.capacity : "—"}</span>
      </span>
    </div>
  );
}

export function ConsumablesPanel({ snapshot }: ConsumablesPanelProps) {
  const resources = selectConsumables(snapshot);
  const status = snapshot["res.status"];

  return (
    <Panel compact id="cons" title="Consumables">
      <div className="col-heads" aria-hidden="true">
        <span>Resource</span>
        <span>Vessel total</span>
      </div>
      {status === "unknown" ? (
        <p className="empty-state">Consumable telemetry unavailable.</p>
      ) : resources.length === 0 ? (
        <p className="empty-state">No consumable resources reported.</p>
      ) : (
        <>
          {status === "incomplete" && (
            <p className="empty-state">Consumable telemetry incomplete.</p>
          )}
          {resources.map((resource) => (
            <div className="res-row" key={resource.name}>
              <span className="res-name" title={humanizeResourceName(resource.name)}>
                {humanizeResourceName(resource.name)}
              </span>
              <ResourceMeter {...resource.vessel} />
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
