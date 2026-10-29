// Personas in Settings: which one answers (its style for the answer text, its voice for reading aloud), and
// adding, changing and removing them. The choice is applied with Settings' Save, like the model; adding,
// changing and removing a persona takes effect right away.
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { IntelClient } from "../api/intel_client.ts";
import { Describe } from "../api/intel_error.ts";
import type { PersonasView, PersonaView } from "../api/models.ts";
import { SpeechPlayer, UnlockAudio } from "../state/speech_player.ts";
import { InlineFailure, Spinner } from "../ui/controls.tsx";
import { Sheet } from "../ui/sheet.tsx";
import { SpeechButton } from "../ui/speech_button.tsx";

interface Draft {
  personaId: number | null;
  name: string;
  style: string;
  voice: string;
}

function ConfiguredSummary(personas: PersonasView): string {
  const style = personas.configured_style === "" ? "plain answers" : `“${personas.configured_style}”`;
  return `Style: ${style}. Voice: “${personas.configured_voice}”.`;
}

export function PersonaSection({ client, personas, setPersonas, chosen, setChosen, problem }: {
  client: IntelClient;
  personas: PersonasView | null;
  setPersonas: (personas: PersonasView) => void;
  chosen: number | null;
  setChosen: (id: number | null) => void;
  problem: string | null;
}) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<PersonaView | null>(null);
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null);

  /** Show the personas intel now has, keeping the choice not saved yet unless its persona is gone. */
  const Loaded = (updated: PersonasView): void => {
    setPersonas(updated);
    if (chosen !== null && !updated.personas.some((persona) => persona.id === chosen)) setChosen(null);
  };

  const Delete = async (persona: PersonaView): Promise<void> => {
    try {
      Loaded(await client.DeletePersona(persona.id));
      setDeleteProblem(null);
    } catch (error) {
      setDeleteProblem(Describe(error));
    }
    setDeleting(null);
  };

  return (
    <section className="form-group">
      <h3>Persona</h3>
      {personas ? (
        <>
          <select className="field" value={chosen ?? ""} aria-label="Persona"
                  onChange={(event) => setChosen(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">From intel's config</option>
            {personas.personas.length > 0 && <hr />}
            {personas.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
          </select>
          {chosen === null && <p className="caption">{ConfiguredSummary(personas)}</p>}
          {personas.personas.length > 0 && (
            <div className="rows">
              {personas.personas.map((persona) => (
                <div key={persona.id} className="item">
                  <div className="item-main">
                    <div>{persona.name}</div>
                    <div className="caption truncate">{persona.style === "" ? "Plain answers" : persona.style}</div>
                  </div>
                  <button type="button" className="button small" onClick={() => setEditing({ personaId: persona.id, ...persona })}>
                    <Pencil aria-hidden />Edit
                  </button>
                  <button type="button" className="button small icon danger" onClick={() => setDeleting(persona)}
                          title={`Delete ${persona.name}`} aria-label={`Delete ${persona.name}`}>
                    <Trash2 aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            <button type="button" className="button small" onClick={() => setEditing({ personaId: null, name: "", style: "", voice: "" })}>
              <Plus aria-hidden />Add Persona…
            </button>
          </div>
          {deleteProblem && <p className="caption warning">{deleteProblem}</p>}
        </>
      ) : problem ? <p className="caption">{problem}</p> : <Spinner />}
      <p className="form-hint">How answers are written, and the voice that reads them aloud. Evidence and references stay plain.</p>

      {editing && (
        <PersonaEditor draft={editing} client={client} configuredVoice={personas?.configured_voice ?? ""}
                       onClose={() => setEditing(null)} onSaved={(updated) => { Loaded(updated); setEditing(null); }} />
      )}
      {deleting && (
        <Sheet title={`Delete the persona “${deleting.name}”?`} width={420} onClose={() => setDeleting(null)}
               onSubmit={() => void Delete(deleting)}
               footer={<>
                 <button type="button" className="button" onClick={() => setDeleting(null)}>Cancel</button>
                 <button type="submit" className="button primary danger" autoFocus>Delete</button>
               </>}>
          <p className="muted">If it is in use, answers go back to the style and voice in intel's config.</p>
        </Sheet>
      )}
    </section>
  );
}

const PreviewSample = "Hi. This is how I'll sound when I read your answers aloud.";

function PersonaEditor({ draft: initial, client, configuredVoice, onClose, onSaved }: {
  draft: Draft; client: IntelClient; configuredVoice: string; onClose: () => void; onSaved: (personas: PersonasView) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const speech = useMemo(() => new SpeechPlayer(), []);
  useEffect(() => () => speech.Stop(), [speech]);

  const Save = async (): Promise<void> => {
    if (draft.name.trim() === "") return;
    setSaving(true);
    try {
      onSaved(draft.personaId === null
        ? await client.AddPersona(draft.name, draft.style, draft.voice)
        : await client.UpdatePersona(draft.personaId, draft.name, draft.style, draft.voice));
    } catch (error) {
      setProblem(Describe(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={draft.personaId === null ? "Add a persona" : `Change “${initial.name}”`} width={500} onClose={onClose}
           onSubmit={() => void Save()}
           footer={<>
             {saving && <Spinner />}
             <button type="button" className="button" onClick={onClose}>Cancel</button>
             <button type="submit" className="button primary" disabled={saving || draft.name.trim() === ""}>
               {draft.personaId === null ? "Add" : "Save"}
             </button>
           </>}>
      <div className="form">
        <div className="form-row">
          <label htmlFor="persona-name">Name</label>
          <input id="persona-name" className="field" value={draft.name} placeholder="Drill sergeant" autoFocus
                 onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="form-row">
          <label htmlFor="persona-style">Answer style</label>
          <textarea id="persona-style" className="field" rows={3} value={draft.style} placeholder="Warm and encouraging."
                    onChange={(event) => setDraft({ ...draft, style: event.target.value })} />
          <p className="form-hint">How the answer text is written. Empty: plainly.</p>
        </div>
        <div className="form-row">
          <label htmlFor="persona-voice">Voice</label>
          <textarea id="persona-voice" className="field" rows={3} value={draft.voice} placeholder={configuredVoice}
                    onChange={(event) => setDraft({ ...draft, voice: event.target.value })} />
          <SpeechButton title="Preview Voice" player={speech} speak={() => {
            UnlockAudio();
            const voice = draft.voice.trim();
            speech.Speak(PreviewSample, client, { voice: voice === "" ? undefined : voice, again: true });
          }} />
          <p className="form-hint">What the voice sounds like when answers are read aloud. Empty: the voice in intel's config.</p>
        </div>
        <InlineFailure message={problem} />
      </div>
    </Sheet>
  );
}
