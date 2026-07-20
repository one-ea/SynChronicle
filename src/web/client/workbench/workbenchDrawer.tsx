import { useEffect, useRef, type ReactNode, type RefObject } from "react";

interface WorkbenchDrawerProps {
  side: "left" | "right";
  label: string;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  children: ReactNode;
}

const focusableSelector = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function WorkbenchDrawer({ side, label, open, triggerRef, onClose, children }: WorkbenchDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();

    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        queueMicrotask(() => triggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open, triggerRef]);

  if (!open) return null;

  function close() {
    onClose();
    triggerRef.current?.focus();
  }

  return <div className="workbench-drawer-layer">
    <button className="workbench-drawer-backdrop" type="button" aria-label={`关闭${label}`} onClick={close} />
    <div className={`workbench-drawer workbench-drawer-${side}`} role="dialog" aria-modal="true" aria-label={label} ref={dialogRef}>
      <button className="workbench-drawer-close" type="button" onClick={close}>关闭</button>
      {children}
    </div>
  </div>;
}
