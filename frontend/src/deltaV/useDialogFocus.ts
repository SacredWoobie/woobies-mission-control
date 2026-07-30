import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) =>
      !element.hasAttribute("hidden")
      && element.getAttribute("aria-hidden") !== "true"
      && !element.closest("[inert]"),
    );
}

interface InertState {
  count: number;
  inert: boolean;
  ariaHidden: string | null;
}

const inertStates = new WeakMap<HTMLElement, InertState>();
const activeDialogs: HTMLElement[] = [];

function makeBackgroundInert(dialog: HTMLElement) {
  const changed: HTMLElement[] = [];
  let branch: HTMLElement = dialog;
  let parent = branch.parentElement;
  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || sibling.classList.contains("delta-v-modal-backdrop") || sibling.classList.contains("resonant-drawer-backdrop") || sibling.classList.contains("notes-drawer-backdrop")) continue;
      const existing = inertStates.get(sibling);
      if (existing) existing.count += 1;
      else inertStates.set(sibling, {
        count: 1,
        inert: sibling.hasAttribute("inert"),
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      changed.push(sibling);
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = parent;
    parent = parent.parentElement;
  }
  return () => {
    for (const element of changed.reverse()) {
      const state = inertStates.get(element);
      if (!state) continue;
      state.count -= 1;
      if (state.count > 0) continue;
      inertStates.delete(element);
      if (!state.inert) element.removeAttribute("inert");
      if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", state.ariaHidden);
    }
  };
}

export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreBackground = makeBackgroundInert(dialog);
    activeDialogs.push(dialog);
    const focusable = focusableElements(dialog);
    (focusable[0] ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (activeDialogs[activeDialogs.length - 1] !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const currentDialog = dialogRef.current;
      if (!currentDialog) return;
      const currentFocusable = focusableElements(currentDialog);
      if (currentFocusable.length === 0) {
        event.preventDefault();
        currentDialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !currentDialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !currentDialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = activeDialogs.lastIndexOf(dialog);
      if (stackIndex >= 0) activeDialogs.splice(stackIndex, 1);
      restoreBackground();
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [open]);

  return dialogRef;
}
