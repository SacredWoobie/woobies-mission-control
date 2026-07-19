import type { PropsWithChildren, ReactNode } from "react";
import { panelLabels, usePanelVisibility, type DashboardPanelId } from "./PanelVisibility";

interface PanelProps extends PropsWithChildren {
  id?: string;
  headingActions?: ReactNode;
  hideable?: boolean;
  title: string;
  tag?: ReactNode;
}

export function Panel({ children, headingActions, hideable = false, id, tag, title }: PanelProps) {
  const visibility = usePanelVisibility();
  const panelId = id && id in panelLabels ? id as DashboardPanelId : null;
  return (
    <section className="panel" id={id}>
      <h2>
        <span>{title}</span>
        <span className="panel-heading-actions">
          {tag && <span className="tag">{tag}</span>}
          {headingActions}
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
      <div className="body">{children}</div>
    </section>
  );
}
