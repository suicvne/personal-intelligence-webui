// A modal sheet (the native <dialog>): a title, a form, and its buttons. Return submits; Esc cancels.
import { useEffect, useRef, type CSSProperties, type FormEvent, type ReactNode } from "react";

export interface SheetProps {
  title: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
  labelledBy?: string;
}

export function Sheet({ title, onClose, onSubmit, width = 480, footer, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  const Submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <dialog ref={ref} className="sheet" style={{ "--sheet-width": `${width}px` } as CSSProperties}
            onCancel={(event) => { event.preventDefault(); close.current(); }}>
      <form onSubmit={Submit} style={{ display: "contents" }}>
        <div className="sheet-header"><h2>{title}</h2></div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </form>
    </dialog>
  );
}
