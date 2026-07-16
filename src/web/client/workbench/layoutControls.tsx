import { useEffect, useRef, useState } from "react";

interface LayoutControlsProps {
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
}

export function LayoutControls({ leftWidth, rightWidth, setLeftWidth, setRightWidth }: LayoutControlsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRangeRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    firstRangeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return <div className="layout-controls" ref={rootRef}>
    <button
      aria-controls="layout-controls-dialog"
      aria-expanded={open}
      className="layout-controls-trigger"
      onClick={() => setOpen((value) => !value)}
      ref={triggerRef}
      type="button"
    >布局</button>
    {open ? <div aria-label="布局" className="layout-controls-dialog" id="layout-controls-dialog" role="dialog">
      <div className="layout-control-row">
        <label htmlFor="layout-left-width">作品栏</label>
        <output id="layout-left-width-value">{leftWidth} px</output>
        <input aria-describedby="layout-left-width-value" id="layout-left-width" ref={firstRangeRef} type="range" min="220" max="420" value={leftWidth} onChange={(event) => setLeftWidth(event.currentTarget.valueAsNumber)} />
      </div>
      <div className="layout-control-row">
        <label htmlFor="layout-right-width">状态栏</label>
        <output id="layout-right-width-value">{rightWidth} px</output>
        <input aria-describedby="layout-right-width-value" id="layout-right-width" type="range" min="240" max="420" value={rightWidth} onChange={(event) => setRightWidth(event.currentTarget.valueAsNumber)} />
      </div>
      <button className="layout-controls-reset" onClick={() => { setLeftWidth(280); setRightWidth(300); }} type="button">重置布局</button>
    </div> : null}
  </div>;
}
