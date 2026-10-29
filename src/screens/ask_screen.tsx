// Ask: a question answered from stored evidence, with evidence and inference kept apart. Mirrors `intel ask`.
// The model may first look things up ("Looking up records changed on 2026-10-24…"); the answer text appears
// while the model writes it; evidence, references and what was looked up follow when it is done.
// An answer can be read aloud, by intel's speech server; "Read aloud" does that for every answer.
import { Check as CheckIcon, MessageCircleQuestion, Send, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AnswerView, CitedStatement, LookupView, ReferenceView } from "../api/models.ts";
import { CitationPattern, WithoutCitations } from "../lib/spoken_text.ts";
import { useAppModel } from "../state/app_context.tsx";
import { LoadReadAloud, SaveReadAloud } from "../state/preferences.ts";
import { useShortcuts } from "../state/shortcuts.ts";
import { SpeechPlayer, UnlockAudio } from "../state/speech_player.ts";
import { Check, EmptyState, Spinner } from "../ui/controls.tsx";
import { OpenButton } from "../ui/open_button.tsx";
import { ScreenHeader } from "../ui/shell.tsx";
import { SpeechButton, useSpeech } from "../ui/speech_button.tsx";

/** "records changed on 2026-10-24" -> "Records changed on 2026-10-24". */
function Sentence(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
}

function ShowReference(ref: string): void {
  const row = document.getElementById(`ref-${ref}`);
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

/** The answer text, its citations ("[R1, E2]", "(R3)") as links to the references below. */
function CitedText({ text, references }: { text: string; references: ReferenceView[] }) {
  const known = new Set(references.map((reference) => reference.ref));
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CitationPattern)) {
    const refs = match[0].match(/[A-Z]\d+/g) ?? [];
    if (!refs.some((ref) => known.has(ref))) continue;
    parts.push(text.slice(last, match.index));
    if (/^\s/.test(match[0])) parts.push(" ");
    parts.push(
      <span key={match.index} className="citation">
        {refs.map((ref) => known.has(ref)
          ? <button key={ref} type="button" className="cite" onClick={() => ShowReference(ref)} title={references.find((r) => r.ref === ref)?.label}>{ref}</button>
          : <span key={ref} className="cite unknown">{ref}</span>)}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Statements({ title, statements }: { title: string; statements: CitedStatement[] }) {
  if (statements.length === 0) return null;
  return (
    <section className="section">
      <h3>{title}</h3>
      <ul className="bullets">
        {statements.map((statement, index) => (
          <li key={index} className="selectable">
            {statement.statement}
            {statement.refs.length > 0 && <span className="citation">{statement.refs.map((ref) =>
              <button key={ref} type="button" className="cite" onClick={() => ShowReference(ref)}>{ref}</button>)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Lines({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="section">
      <h3>{title}</h3>
      <ul className="bullets">{lines.map((line, index) => <li key={index} className="selectable">{line}</li>)}</ul>
    </section>
  );
}

/** What the model looked up before answering; hover for the lookup as `intel ask` prints it. */
function LookedUp({ lookups }: { lookups: LookupView[] }) {
  if (lookups.length === 0) return null;
  return (
    <section className="section">
      <h3>Looked up</h3>
      <div className="rows">
        {lookups.map((lookup, index) => (
          <div key={index} className="item" title={lookup.text}>
            <span className="item-main">{Sentence(lookup.description)}</span>
            {lookup.result && <span className="item-detail">{lookup.result}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** While the model reads what it looked up: the lookups made so far, the last one still being read. */
function LookingUp({ lookups }: { lookups: LookupView[] }) {
  const current = lookups[lookups.length - 1]!;
  return (
    <div className="looking-up">
      {lookups.slice(0, -1).map((lookup, index) => (
        <div key={index} className="row" title={lookup.text}>
          <CheckIcon className="lookup-done" aria-hidden />
          <span>{Sentence(lookup.description)}{lookup.result && <span className="faint"> · {lookup.result}</span>}</span>
        </div>
      ))}
      <div className="row" title={current.text}><Spinner /><span>Looking up {current.description}…</span></div>
    </div>
  );
}

function References({ references }: { references: ReferenceView[] }) {
  if (references.length === 0) return null;
  return (
    <section className="section">
      <h3>References</h3>
      <div className="rows">
        {references.map((reference) => (
          <div key={reference.ref} id={`ref-${reference.ref}`} className="item reference">
            <span className="pill mono">{reference.ref}</span>
            <span className="item-main clamp-2">{reference.label}</span>
            <OpenButton uri={reference.uri} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function AskScreen() {
  const model = useAppModel();
  const [question, setQuestion] = useState("");
  const [useModel, setUseModel] = useState(true);
  const [readAloud, setReadAloud] = useState(LoadReadAloud);
  const [answer, setAnswer] = useState<AnswerView | null>(null);
  /** The answer text so far, while the model writes it (replaced by `answer` when that arrives). */
  const [streamed, setStreamed] = useState("");
  /** What the model has looked up so far (the answer lists them all when it arrives). */
  const [lookups, setLookups] = useState<LookupView[]>([]);
  const [asking, setAsking] = useState<AbortController | null>(null);
  const speech = useMemo(() => new SpeechPlayer(), []);
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;
  const speaking = useSpeech(speech).state !== "idle";

  // Leaving the screen loses the answer, so stop the model (and the voice) too.
  const askingRef = useRef(asking);
  askingRef.current = asking;
  useEffect(() => () => {
    askingRef.current?.abort();
    speech.Stop();
  }, [speech]);

  const ReadAnswer = (final: AnswerView, again = false): void => {
    speech.Speak(final.spoken_text || final.text, model.client, { again });
  };

  const AskNow = async (): Promise<void> => {
    const text = question.trim();
    if (text === "" || asking) return;
    if (readAloud) UnlockAudio();          // inside the click or key press, so the speech may play later
    setAnswer(null);
    setStreamed("");
    setLookups([]);
    speech.Stop();
    const controller = new AbortController();
    setAsking(controller);
    await model.Follow(model.client.With({ signal: controller.signal }).AskStream(text, useModel), (event) => {
      switch (event.kind) {
        case "lookup": setLookups((current) => [...current, event.lookup]); break;
        case "delta": setStreamed((current) => current + event.text); break;
        case "answerText":                  // the model still writes the evidence: start reading
          if (readAloudRef.current) speech.Speak(event.spokenText || WithoutCitations(event.text), model.client);
          break;
        case "answer":
          setAnswer(event.answer);
          if (readAloudRef.current) ReadAnswer(event.answer);    // unless it is what is already being read
          break;
      }
    }, controller.signal);
    setAsking(null);
  };

  useShortcuts((event) => {
    if (event.key === "Escape" && asking) {
      asking.abort();
      return true;
    }
    return false;
  });

  const isAsking = asking !== null;
  let content: ReactNode;
  if (answer) {
    content = (
      <>
        <div className="answer selectable"><CitedText text={answer.text} references={answer.references} /></div>
        <SpeechButton title="Read aloud" player={speech} speak={() => { UnlockAudio(); ReadAnswer(answer, true); }} />
        <Statements title="Evidence (what the records show)" statements={answer.evidence} />
        <Statements title="Inference (interpretation, not established fact)" statements={answer.inferences} />
        <Lines title="Missing or uncertain" lines={answer.gaps} />
        <Lines title="Ambiguous names (not assumed)"
               lines={Object.entries(answer.ambiguous).map(([name, options]) => `'${name}' could be: ${options.join(", ")}`)} />
        <References references={answer.references} />
        <LookedUp lookups={answer.lookups ?? lookups} />
        {answer.invalid_refs.length > 0 && (
          <p className="caption warning">The model cited unknown references {answer.invalid_refs.join(", ")}; they were discarded.</p>
        )}
        {answer.note && <p className="caption">{answer.note}</p>}
      </>
    );
  } else if (isAsking && streamed === "") {
    content = lookups.length > 0 ? <LookingUp lookups={lookups} /> : <div className="row muted thinking"><Spinner />Thinking…</div>;
  } else if (streamed !== "") {
    content = (
      <>
        <div className="answer selectable">{streamed}</div>
        {isAsking
          ? <div className="row caption"><Spinner />Writing… evidence and references follow.</div>
          : <p className="caption">Stopped before the answer was complete.</p>}
        {speaking && <SpeechButton title="Read aloud" player={speech} speak={() => undefined} />}
        <LookedUp lookups={lookups} />
      </>
    );
  } else if (lookups.length > 0) {
    content = (
      <>
        <p className="caption">Stopped before the answer was written.</p>
        <LookedUp lookups={lookups} />
      </>
    );
  } else {
    content = <EmptyState icon={<MessageCircleQuestion />} title="Ask about your projects"
                          message="Answers cite the notes, commits and issues they come from." />;
  }

  return (
    <div className="screen ask">
      <ScreenHeader title="Ask" />
      <div className="screen-body" aria-live="polite" aria-busy={isAsking}>
        <div className="reading">{content}</div>
      </div>
      <form className="ask-bar" onSubmit={(event) => { event.preventDefault(); void AskNow(); }}>
        <input className="field ask-field" value={question} placeholder="What has changed in Project Succubi recently?"
               aria-label="Question" autoFocus onChange={(event) => setQuestion(event.target.value)} />
        <div className="row wrap ask-options">
          <Check checked={useModel} onChange={setUseModel} title="Off: show the retrieved evidence without a written answer">Use the model</Check>
          <Check checked={readAloud} title="Read each answer aloud once it is complete, in the voice set in intel's config ([voice])"
                 onChange={(checked) => {
                   if (checked) UnlockAudio();
                   setReadAloud(checked);
                   SaveReadAloud(checked);
                 }}>Read aloud</Check>
          {isAsking ? (
            <button type="button" className="button" onClick={() => asking.abort()} title="Stop the model writing (Esc)">
              <Square aria-hidden />Stop
            </button>
          ) : (
            <button type="submit" className="button primary" disabled={question.trim() === ""}><Send aria-hidden />Ask</button>
          )}
        </div>
      </form>
    </div>
  );
}
