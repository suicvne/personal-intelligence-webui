// Settings: the token this browser uses (kept in its local storage), the model intel uses, and the persona
// its answers are written and read aloud in. Everything here uses the token as typed, before it's saved.
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { GetLocalToken } from "../api/companion.ts";
import { Describe } from "../api/intel_error.ts";
import type { LlmModelsView, PersonasView } from "../api/models.ts";
import { useAppModel, useAppState, useTask } from "../state/app_context.tsx";
import { Spinner } from "../ui/controls.tsx";
import { Sheet } from "../ui/sheet.tsx";
import { PersonaSection } from "./persona_settings.tsx";

/** The endpoint's models, plus the chosen one if the endpoint didn't list it (so the picker can show it). */
function ModelOptions(models: LlmModelsView): string[] {
  if (!models.chosen || models.available.includes(models.chosen)) return models.available;
  return [models.chosen, ...models.available];
}

export function SettingsDialog() {
  const model = useAppModel();
  const state = useAppState();
  const [token, setToken] = useState(state.token);
  const [showToken, setShowToken] = useState(false);
  const [check, setCheck] = useState<string | null>(null);
  const [models, setModels] = useState<LlmModelsView | null>(null);
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  const [chosenModel, setChosenModel] = useState("");               // "": the model in intel's config
  const [personas, setPersonas] = useState<PersonasView | null>(null);
  const [personaProblem, setPersonaProblem] = useState<string | null>(null);
  const [chosenPersona, setChosenPersona] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadToken, setLoadToken] = useState(0);
  const client = model.ClientFor(token.trim());
  const upstream = state.local?.upstream ?? "http://127.0.0.1:8765";

  useTask(async (signal) => {
    if (token.trim() === "") {
      setModelProblem("Connect to intel to choose its model.");
      setPersonaProblem("Connect to intel to choose a persona.");
      return;
    }
    const scoped = client.With({ signal });
    await Promise.all([
      scoped.LlmModels().then((loaded) => {
        setModels(loaded);
        setChosenModel(loaded.chosen ?? "");
        setModelProblem(null);
      }, (error: unknown) => {
        if (signal.aborted) return;
        setModels(null);
        setModelProblem(`Couldn't load intel's models: ${Describe(error)}`);
      }),
      scoped.Personas().then((loaded) => {
        setPersonas(loaded);
        setChosenPersona(loaded.chosen);
        setPersonaProblem(null);
      }, (error: unknown) => {
        if (signal.aborted) return;
        setPersonas(null);
        setPersonaProblem(`Couldn't load intel's personas: ${Describe(error)}`);
      }),
    ]);
  }, [loadToken]);

  const Test = async (): Promise<void> => {
    setCheck("Testing…");
    try {
      const status = await client.Status();
      setCheck(`Connected: intel ${status.version}, ${status.sources.length} sources, ${status.pending_proposals} proposals waiting.`);
      setLoadToken((value) => value + 1);
    } catch (error) {
      setCheck(Describe(error));
    }
  };

  const UseLocalToken = async (): Promise<void> => {
    try {
      setToken(await GetLocalToken());
      setCheck("Token read from `intel api token`.");
    } catch (error) {
      setCheck(`Couldn't run \`intel api token\` (${Describe(error)}). Run it in a terminal and paste the token here.`);
    }
  };

  const Save = async (): Promise<void> => {
    if (token.trim() === "") return;
    setSaving(true);
    try {
      model.SaveToken(token);
      if (models?.enabled && chosenModel !== (models.chosen ?? "")) {
        await client.ChooseLlmModel(chosenModel === "" ? null : chosenModel);
        model.RequestRefresh();          // the status footer names the model
      }
      if (personas && chosenPersona !== personas.chosen) await client.ChoosePersona(chosenPersona);
      model.ShowSettings(false);
    } catch (error) {
      setCheck(Describe(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title="Settings" width={560} onClose={() => model.ShowSettings(false)} onSubmit={() => void Save()}
           footer={<>
             {saving && <Spinner />}
             <button type="button" className="button" onClick={() => model.ShowSettings(false)}>Cancel</button>
             <button type="submit" className="button primary" disabled={saving || token.trim() === ""}>Save</button>
           </>}>
      <section className="form-group">
        <h3>Connection</h3>
        <div className="form-row">
          <label htmlFor="settings-token">Token</label>
          <div className="row">
            <input id="settings-token" className="field mono" type={showToken ? "text" : "password"} value={token}
                   autoComplete="off" spellCheck={false} placeholder="intel api token"
                   onChange={(event) => setToken(event.target.value)} autoFocus={state.token === ""} />
            <button type="button" className="button icon" onClick={() => setShowToken(!showToken)}
                    aria-label={showToken ? "Hide the token" : "Show the token"} title={showToken ? "Hide" : "Show"}>
              {showToken ? <EyeOff /> : <Eye />}
            </button>
          </div>
        </div>
        <div className="row wrap">
          {state.local?.localToken !== false && (
            <button type="button" className="button small" onClick={() => void UseLocalToken()}>Use the token of the intel on this Mac</button>
          )}
          <button type="button" className="button small" onClick={() => void Test()} disabled={token.trim() === ""}>Test connection</button>
        </div>
        {check && <p className="caption selectable" role="status">{check}</p>}
        <p className="form-hint">
          intel's API is at <code>{upstream}</code> (start the web UI with <code>--intel-url</code> to use another).
          Get the token with <code>intel api token</code>; it's kept in this browser.
        </p>
      </section>

      <section className="form-group">
        <h3>Model</h3>
        {models?.enabled ? (
          <>
            <select className="field" value={chosenModel} onChange={(event) => setChosenModel(event.target.value)} aria-label="Model">
              <option value="">From intel's config ({models.configured ?? "?"})</option>
              <hr />
              {ModelOptions(models).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {models.error && <p className="caption warning">Couldn't list the endpoint's models: {models.error}</p>}
          </>
        ) : models ? (
          <p className="muted">The LLM is turned off in intel's config ([llm] enabled = false).</p>
        ) : modelProblem ? (
          <p className="caption">{modelProblem}</p>
        ) : <Spinner />}
        <p className="form-hint">Every LLM task uses this model: answers, extraction and briefs. The background service switches at its next cycle.</p>
      </section>

      <PersonaSection client={client} personas={personas} setPersonas={setPersonas} chosen={chosenPersona}
                      setChosen={setChosenPersona} problem={personaProblem} />
    </Sheet>
  );
}
