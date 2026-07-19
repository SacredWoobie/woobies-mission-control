import { formatResourceAmount, humanizeResourceName } from "../telemetry/formatters";
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

  return (
    <div
      aria-label={fraction === undefined ? "Amount unavailable" : `${percent}% remaining`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={fraction === undefined ? undefined : percent}
      className="meter"
      role="meter"
    >
      <div className="track">
        <span className={`fill ${severity}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="cap" aria-hidden="true">
        <span>{hasCapacity ? formatResourceAmount(current, maximum) : "—"}</span>
        <span className="k">/ {hasCapacity ? formatResourceAmount(maximum, maximum) : "—"}</span>
      </span>
    </div>
  );
}

export function ConsumablesPanel({ snapshot }: ConsumablesPanelProps) {
  const resources = selectConsumables(snapshot);
  const stageKnown = snapshot["res.stageKnown"] !== false;

  return (
    <Panel hideable id="cons" title="Consumables" tag="Vessel total · Current stage">
      <div className="col-heads" aria-hidden="true">
        <span />
        <span>Vessel total</span>
        <span>Current stage</span>
      </div>
      {resources.length === 0 ? (
        <p className="empty-state">No consumable resources reported.</p>
      ) : (
        resources.map((resource) => (
          <div className="res-row" key={resource.name}>
            <span className="res-name" title={humanizeResourceName(resource.name)}>
              {humanizeResourceName(resource.name)}
            </span>
            <ResourceMeter {...resource.vessel} />
            <ResourceMeter {...(stageKnown ? resource.stage : {})} />
          </div>
        ))
      )}
      {!stageKnown && (
        <p className="res-note">
          Current-stage column unavailable — this kRPC build does not expose the active stage.
        </p>
      )}
    </Panel>
  );
}
