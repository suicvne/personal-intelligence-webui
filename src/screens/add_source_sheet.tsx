// Adding a source: a folder of notes, a local git repository, or GitLab projects and groups.
import { useState } from "react";
import { ChooseFolder } from "../api/companion.ts";
import { Describe } from "../api/intel_error.ts";
import type { NewSource, SourceStatus } from "../api/models.ts";
import { SplitList, Trimmed } from "../lib/text.ts";
import { useAppModel, useAppState } from "../state/app_context.tsx";
import { Segmented, Switch } from "../ui/controls.tsx";
import { EditForm, FormRow } from "../ui/edit_form.tsx";

type Kind = NewSource["kind"];

const Kinds: { value: Kind; label: string }[] = [
  { value: "filesystem", label: "Folder of notes" },
  { value: "git", label: "Git repository" },
  { value: "gitlab", label: "GitLab" },
];

function Explanation(kind: Kind): string {
  switch (kind) {
    case "git": return "A local clone: its commits, and its notes and README. Repositories under the git roots in intel's config are added on their own.";
    case "gitlab": return "The issues of GitLab projects and groups. intel reads the access token from the variable below, or from the Keychain (intel secret set GITLAB_TOKEN).";
    default: return "Markdown and text notes in a folder and its subfolders. Tasks written in them show up under Tasks.";
  }
}

function LastComponent(folder: string): string {
  return folder.replace(/\/+$/, "").split("/").pop() ?? "";
}

export function AddSourceSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (source: SourceStatus, syncNow: boolean) => Promise<void> }) {
  const model = useAppModel();
  const { local } = useAppState();
  const [kind, setKind] = useState<Kind>("filesystem");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [include, setInclude] = useState("");
  const [includeDocuments, setIncludeDocuments] = useState(true);
  const [url, setUrl] = useState("");
  const [projects, setProjects] = useState("");
  const [groups, setGroups] = useState("");
  const [tokenEnv, setTokenEnv] = useState("GITLAB_TOKEN");
  const [verifyTls, setVerifyTls] = useState(true);
  const [syncNow, setSyncNow] = useState(true);
  const [isWorking, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const gitlab = kind === "gitlab";

  const canAdd = Trimmed(name) !== "" && (gitlab
    ? Trimmed(url) !== "" && [...SplitList(projects), ...SplitList(groups)].length > 0
    : Trimmed(path) !== "");

  const Choose = async (): Promise<void> => {
    try {
      const folder = await ChooseFolder();
      if (!folder) return;
      setPath(folder);
      if (Trimmed(name) === "") setName(LastComponent(folder));
    } catch (error) {
      setFailure(Describe(error));
    }
  };

  const Add = async (): Promise<void> => {
    const source: NewSource = {
      kind, name: Trimmed(name),
      path: gitlab ? undefined : Trimmed(path),
      include: gitlab ? [] : SplitList(include),
      include_documents: includeDocuments,
      url: gitlab ? Trimmed(url) : undefined,
      projects: gitlab ? SplitList(projects) : [],
      groups: gitlab ? SplitList(groups) : [],
      token_env: gitlab ? Trimmed(tokenEnv) : undefined,
      verify_tls: verifyTls,
    };
    setWorking(true);
    setFailure(null);
    const result = await model.Submit((client) => client.AddSource(source), setFailure);
    setWorking(false);
    if (!result) return;
    onClose();
    await onAdded(result, syncNow);
  };

  return (
    <EditForm title="Add a source" action="Add" width={560} footnote={Explanation(kind)} canSave={canAdd}
              isWorking={isWorking} failure={failure} onSave={() => void Add()} onClose={onClose}>
      <div><Segmented label="Kind" value={kind} options={Kinds} onChange={(value) => { setKind(value); setFailure(null); }} /></div>
      <FormRow label="Name" htmlFor="source-name">
        <input id="source-name" className="field" value={name} autoFocus placeholder={gitlab ? "gitlab" : "a short name, e.g. notes"}
               onChange={(event) => setName(event.target.value)} />
      </FormRow>
      {gitlab ? (
        <>
          <FormRow label="GitLab URL" htmlFor="source-url">
            <input id="source-url" className="field" value={url} placeholder="https://git.example.com" onChange={(event) => setUrl(event.target.value)} />
          </FormRow>
          <FormRow label="Projects" htmlFor="source-projects">
            <input id="source-projects" className="field" value={projects} placeholder="group/project, … (comma-separated)"
                   onChange={(event) => setProjects(event.target.value)} />
          </FormRow>
          <FormRow label="Groups" htmlFor="source-groups">
            <input id="source-groups" className="field" value={groups} placeholder="groups or user names, … (comma-separated)"
                   onChange={(event) => setGroups(event.target.value)} />
          </FormRow>
          <FormRow label="Token variable" htmlFor="source-token"
                   hint="intel reads the access token from this environment variable, or from the Keychain item of that name (intel secret set)">
            <input id="source-token" className="field mono" value={tokenEnv} onChange={(event) => setTokenEnv(event.target.value)} />
          </FormRow>
          <Switch checked={verifyTls} onChange={setVerifyTls}>Verify the TLS certificate</Switch>
        </>
      ) : (
        <>
          <FormRow label={kind === "git" ? "Repository" : "Folder"} htmlFor="source-path"
                   hint={local?.canChooseFolder ? undefined : "The full path; ~ is your home folder."}>
            <div className="row">
              <input id="source-path" className="field mono" value={path} placeholder={kind === "git" ? "~/git/project" : "~/Notes"}
                     onChange={(event) => setPath(event.target.value)}
                     onBlur={() => { if (Trimmed(name) === "" && Trimmed(path) !== "") setName(LastComponent(Trimmed(path))); }} />
              {local?.canChooseFolder && <button type="button" className="button" onClick={() => void Choose()}>Choose…</button>}
            </div>
          </FormRow>
          {kind === "git" && <Switch checked={includeDocuments} onChange={setIncludeDocuments}>Also read its Markdown and text files</Switch>}
          {(kind === "filesystem" || includeDocuments) && (
            <FormRow label={kind === "git" ? "Documents" : "Files"} htmlFor="source-include">
              <input id="source-include" className="field mono" value={include} placeholder="*.md, *.txt, … (blank: the usual note files)"
                     onChange={(event) => setInclude(event.target.value)} />
            </FormRow>
          )}
        </>
      )}
      <span title="Otherwise the background service syncs it at its next cycle">
        <Switch checked={syncNow} onChange={setSyncNow}>Sync it now</Switch>
      </span>
    </EditForm>
  );
}
