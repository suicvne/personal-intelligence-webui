// ?: the keyboard shortcuts.
import { CommandKey } from "../state/shortcuts.ts";
import { Sheet } from "../ui/sheet.tsx";

const Groups: [string, [string[], string][]][] = [
  ["Everywhere", [
    [["r"], "Reload"],
    [["Shift", "S"], "Sync every source now"],
    [["1", "–", "8"], "Brief, Activity, Proposals, Tasks, Goals, Entities, Ask, Sources"],
    [[","], "Settings"],
    [["/"], "Search the list"],
    [["j"], "Next in the list"],
    [["k"], "Previous in the list"],
    [["?"], "These shortcuts"],
  ]],
  ["Proposals", [
    [[`${CommandKey}Enter`], "Approve"],
    [[`${CommandKey}Backspace`], "Reject"],
  ]],
  ["Ask", [
    [["Enter"], "Ask"],
    [["Esc"], "Stop"],
  ]],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard shortcuts" width={520} onClose={onClose}
           footer={<button type="button" className="button primary" onClick={onClose} autoFocus>Done</button>}>
      {Groups.map(([group, keys]) => (
        <section key={group} className="section">
          <h3>{group}</h3>
          <dl className="facts">
            {keys.map(([combo, what]) => (
              <div key={what} style={{ display: "contents" }}>
                <dt>{combo.map((key, index) => key === "–" ? <span key={index}> – </span> : <kbd key={index}>{key}</kbd>)}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="form-hint">Single keys work when you aren't typing in a field.</p>
    </Sheet>
  );
}
