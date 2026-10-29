// Small controls used on several screens.
import { CircleAlert, Search } from "lucide-react";
import type { ReactNode } from "react";

export function Spinner({ large = false, label }: { large?: boolean; label?: string }) {
  return <span className={large ? "spinner large" : "spinner"} role="progressbar" aria-label={label ?? "Loading"} />;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Search aria-hidden />
      <input className="field" type="search" data-search value={value} placeholder={placeholder} aria-label={placeholder}
             onChange={(event) => onChange(event.target.value)}
             onKeyDown={(event) => {
               if (event.key === "Escape" && value) {
                 event.stopPropagation();
                 onChange("");
               } else if (event.key === "Escape") (event.target as HTMLInputElement).blur();
             }} />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children, title }: {
  checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; title?: string;
}) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, children, disabled }: {
  checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

export function EmptyState({ icon, title, message, children }: { icon: ReactNode; title: string; message?: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {children}
    </div>
  );
}

/** A screen's loading, empty and content states in one place. */
export function Loadable({ isLoading, isEmpty, emptyTitle, emptyIcon, emptyMessage, children }: {
  isLoading: boolean; isEmpty: boolean; emptyTitle: string; emptyIcon: ReactNode; emptyMessage?: string; children: ReactNode;
}) {
  if (isLoading && isEmpty) return <div className="loading"><Spinner large /></div>;
  if (isEmpty) return <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />;
  return <>{children}</>;
}

/** A one-line result at the bottom of a screen ("Proposed 3 issues from …"); nothing when empty. */
export function MessageBar({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="message-bar" role="status">{message}</div>;
}

export function InlineFailure({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="inline-failure" role="alert"><CircleAlert aria-hidden /><span className="selectable">{message}</span></div>;
}

export function CountBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return <span className="count" aria-label={label ? `${count} ${label}` : undefined}>{count}</span>;
}
