// Opens a note in its app (through the companion) or a GitLab issue in a new tab. A browser can't open local
// files by itself, so without the companion's help (not macOS) a file can only be copied as a path.
import { OpenLocalPath } from "../api/companion.ts";
import { Describe } from "../api/intel_error.ts";
import { OpenableUri } from "../lib/formatting.ts";
import { useAppModel, useAppState } from "../state/app_context.tsx";

export function useOpener(): (uri: string | null | undefined, reveal?: boolean) => void {
  const model = useAppModel();
  const { local } = useAppState();
  return (uri, reveal = false) => {
    const target = OpenableUri(uri);
    if (!target) return;
    if (target.kind === "web") {
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (local && !local.canOpen) {
      void navigator.clipboard?.writeText(target.path).then(
        () => model.Notice(`This web UI can't open files here; copied the path: ${target.path}`),
        () => model.Notice(target.path),
      );
      return;
    }
    OpenLocalPath(target.path, reveal).then(
      (result) => {
        if (result.revealed) model.Notice("Shown in Finder: opening it would run it.");
      },
      (error: unknown) => model.Notice(Describe(error)),
    );
  };
}

export function OpenButton({ title = "Open", uri, reveal = false }: { title?: string; uri: string | null | undefined; reveal?: boolean }) {
  const open = useOpener();
  const target = OpenableUri(uri);
  if (!target) return null;
  if (target.kind === "web") {
    return <a href={target.url} target="_blank" rel="noopener noreferrer" className="link-button nowrap">{title}</a>;
  }
  return (
    <button type="button" className="link-button nowrap" title={target.path} onClick={() => open(uri, reveal)}>
      {title}
    </button>
  );
}
