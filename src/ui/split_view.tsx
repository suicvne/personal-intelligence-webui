// A list beside what's selected in it. In a narrow window only one shows: the list, or the selection with
// a way back.
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function SplitView({ list, detail, hasSelection, onBack, listLabel }: {
  list: ReactNode; detail: ReactNode; hasSelection: boolean; onBack: () => void; listLabel: string;
}) {
  return (
    <div className="split" data-has-selection={hasSelection ? "" : undefined}>
      <section className="split-list" aria-label={listLabel}>{list}</section>
      <section className="split-detail">
        {hasSelection && (
          <button type="button" className="button small ghost back-button" onClick={onBack}>
            <ArrowLeft aria-hidden />{listLabel}
          </button>
        )}
        {detail}
      </section>
    </div>
  );
}
