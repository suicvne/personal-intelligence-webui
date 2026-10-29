// Menus: the ⋯ button on a row, and the same menu on right-click. Built on the Popover API, so they close
// on Esc or a click elsewhere by themselves.
import { Ellipsis } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

export type MenuEntry =
  | { label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean; icon?: ReactNode }
  | { title: string }
  | "divider";

interface Anchor {
  x: number;
  y: number;
  /** "end": the menu's right edge at x (under a button on the right). */
  align: "start" | "end";
  /** Where the button's top is, to open upwards when there's no room below. */
  above?: number;
}

function PopoverMenu({ entries, anchor, onClose }: { entries: MenuEntry[]; anchor: Anchor; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closed = useRef(onClose);
  closed.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const Toggle = (event: Event): void => {
      if ((event as ToggleEvent).newState === "closed") closed.current();
    };
    menu.addEventListener("toggle", Toggle);
    menu.showPopover();
    const rect = menu.getBoundingClientRect();
    let left = anchor.align === "end" ? anchor.x - rect.width : anchor.x;
    let top = anchor.y;
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    if (top + rect.height > window.innerHeight - 8) {
      top = anchor.above !== undefined ? anchor.above - rect.height - 4 : window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      menu.removeEventListener("toggle", Toggle);
      if (menu.matches(":popover-open")) menu.hidePopover();
    };
  }, [anchor]);
  const Move = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div ref={ref} popover="auto" className="menu" role="menu" onKeyDown={Move} onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry, index) => {
        if (entry === "divider") return <hr key={index} />;
        if ("title" in entry) return <div key={index} className="menu-title">{entry.title}</div>;
        return (
          <button key={index} type="button" role="menuitem" className={entry.destructive ? "destructive" : undefined}
                  disabled={entry.disabled}
                  onClick={() => {
                    ref.current?.hidePopover();
                    entry.onSelect();
                  }}>
            {entry.icon}
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small ⋯ button that opens `entries`. */
export function MenuButton({ entries, label, icon, className = "button ghost icon small" }: {
  entries: MenuEntry[]; label: string; icon?: ReactNode; className?: string;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closedAt = useRef(0);
  const Open = (event: MouseEvent): void => {
    event.stopPropagation();
    if (anchor || Date.now() - closedAt.current < 250) return;    // the click that closed it
    const rect = button.current!.getBoundingClientRect();
    setAnchor({ x: rect.right, y: rect.bottom + 4, align: "end", above: rect.top });
  };
  return (
    <>
      <button ref={button} type="button" className={className} aria-label={label} title={label}
              aria-haspopup="menu" aria-expanded={anchor !== null} onClick={Open}>
        {icon ?? <Ellipsis />}
      </button>
      {anchor && <PopoverMenu entries={entries} anchor={anchor}
                              onClose={() => { closedAt.current = Date.now(); setAnchor(null); }} />}
    </>
  );
}

/** Right-click opens `entries` where the pointer is. Spread `onContextMenu` on the row; render `menu`. */
export function useContextMenu(entries: () => MenuEntry[]): { onContextMenu: (event: MouseEvent) => void; menu: ReactNode } {
  const [state, setState] = useState<{ anchor: Anchor; entries: MenuEntry[] } | null>(null);
  return {
    onContextMenu: (event: MouseEvent) => {
      const items = entries();
      if (items.length === 0) return;
      event.preventDefault();
      setState({ anchor: { x: event.clientX, y: event.clientY, align: "start" }, entries: items });
    },
    menu: state && <PopoverMenu entries={state.entries} anchor={state.anchor} onClose={() => setState(null)} />,
  };
}
