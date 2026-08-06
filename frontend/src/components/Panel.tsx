import { useState, type PropsWithChildren, type ReactNode } from "react";
import { panelLabels, usePanelVisibility, type DashboardPanelId } from "./PanelVisibility";

interface PanelProps extends PropsWithChildren {
  collapsible?: boolean;
  compact?: boolean;
  id?: string;
  headingActions?: ReactNode;
  hideable?: boolean;
  title: string;
  tag?: ReactNode;
}

export function Panel({ children, collapsible = false, compact = false, headingActions, hideable = false, id, tag, title }: PanelProps) {
  const visibility = usePanelVisibility();
  const [collapsed, setCollapsed] = useState(false);
  const panelId = id && id in panelLabels ? id as DashboardPanelId : null;
  return (
    <section className={`panel${compact ? " panel-compact" : ""}${collapsed ? " panel-collapsed" : ""}`} id={id}>
      <h2>
        <span className="panel-title">{title}</span>
        <span className="panel-heading-actions">
          {tag && <span className="tag">{tag}</span>}
          {headingActions}
          {collapsible && (
            <button
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
              className="panel-collapse-button"
              onClick={() => setCollapsed((current) => !current)}
              type="button"
            >
              <span aria-hidden="true">{collapsed ? "⌄" : "⌃"}</span>
            </button>
          )}
          {hideable && panelId && (
            <button
              aria-label={`Hide ${title} panel`}
              className="panel-hide-button"
              onClick={() => visibility.hidePanel(panelId)}
              title="Hide panel"
              type="button"
            >
              ‹
            </button>
          )}
        </span>
      </h2>
      {compact ? (
        <div className="body" hidden={collapsed} inert={collapsed || undefined}>{children}</div>
      ) : !collapsed && <div className="body">{children}</div>}
    </section>
  );
}
