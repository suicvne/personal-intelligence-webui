// A correction's sheet: title, fields, what saving does, why it failed, and Cancel / the action (Return).
import type { ReactNode } from "react";
import { InlineFailure, Spinner } from "./controls.tsx";
import { Sheet } from "./sheet.tsx";

export function EditForm({ title, footnote, action, destructive = false, canSave, isWorking, failure, onSave, onClose, width = 500, children }: {
  title: string;
  footnote: string;
  action: string;
  destructive?: boolean;
  canSave: boolean;
  isWorking: boolean;
  failure: string | null;
  onSave: () => void;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Sheet title={title} width={width} onClose={onClose} onSubmit={() => { if (canSave && !isWorking) onSave(); }}
           footer={<>
             {isWorking && <Spinner />}
             <button type="button" className="button" onClick={onClose}>Cancel</button>
             <button type="submit" className={`button primary${destructive ? " danger" : ""}`} disabled={!canSave || isWorking}>{action}</button>
           </>}>
      <div className="form">{children}</div>
      <p className="form-hint">{footnote}</p>
      <InlineFailure message={failure} />
    </Sheet>
  );
}

/** A labelled field in a form. */
export function FormRow({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="form-row">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}
