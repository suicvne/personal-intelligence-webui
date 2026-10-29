// A small client for the intel HTTP API (personal-intelligence/src/intel/server.py), through the companion.
//
// One method per route, as in the SwiftUI app's IntelClient. Every call sends `Authorization: Bearer <token>`;
// errors come back as IntelError with the server's message, so screens can show them as they are. The
// streaming routes are async generators; stopping the iteration (or aborting the signal) closes the
// connection, which also stops intel generating.
import { IntelError } from "./intel_error.ts";
import {
  NormalizeAnswer, NormalizeLookup,
  type AnswerView, type AskEvent, type BriefView, type DecisionResult, type EntityDetail, type EntitySummary,
  type EventPage, type GoalView, type GroupDecisionResult, type HealthView, type ImportResult, type LlmModelsView,
  type NewSource, type ObservationView, type PersonasView, type PredicateView, type ProposalDetail,
  type ProposalOverview, type ProposalView, type RelationshipView, type SourceStatus, type StatusView,
  type SyncResult, type TaskView,
} from "./models.ts";
import { ReadEventStream, type ServerSentEvent } from "./server_sent_events.ts";

/** The companion marks a 502 with this when intel itself can't be reached (server/proxy.ts). */
export const UpstreamHeader = "X-Intel-WebUI-Upstream";
/** Sent on /local/* calls; the companion refuses them without it (server/guards.ts). */
export const LocalHeader = "X-Intel-WebUI";

const JsonTimeoutMs = 120_000;           // asking the model can take a while
const SpeechPieceBytes = 9_600;          // about a fifth of a second of 24 kHz 16-bit mono

type Query = Record<string, string | number | null | undefined>;
type Body = Record<string, unknown>;

export interface ClientOptions {
  token: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  baseUrl?: string;                      // "" (the default): the page's own origin, i.e. the companion
}

/** Leaves out keys whose value is null or undefined, as the SwiftUI app's encoder does. */
function Compact(body: Body): Body {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null && value !== undefined));
}

function QueryString(query: Query): string {
  const entries = Object.entries(query)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString();
}

function ParseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw IntelError.InvalidResponse();
  }
}

/** One /api/ask/stream event; null for an event this app doesn't know. */
export function AskEventFrom(event: ServerSentEvent): AskEvent | null {
  switch (event.name) {
    case "lookup":
      return { kind: "lookup", lookup: NormalizeLookup(ParseJson<unknown>(event.data)) };
    case "delta":
      return { kind: "delta", text: ParseJson<{ text: string }>(event.data).text };
    case "answer_text": {
      const piece = ParseJson<{ text: string; spoken_text: string }>(event.data);
      return { kind: "answerText", text: piece.text, spokenText: piece.spoken_text ?? "" };
    }
    case "answer":
      return { kind: "answer", answer: NormalizeAnswer(ParseJson<AnswerView>(event.data)) };
    case "error": {
      const failure = ParseJson<{ error: string; status?: number | null }>(event.data);
      throw IntelError.Server(failure.status ?? 500, failure.error);
    }
    default:
      return null;
  }
}

export class IntelClient {
  readonly token: string;
  private readonly signal: AbortSignal | undefined;
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: ClientOptions) {
    this.token = options.token;
    this.signal = options.signal;
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? "";
  }

  /** The same client, its calls cancelled by `signal`. */
  With(options: { signal?: AbortSignal }): IntelClient {
    return new IntelClient({ token: this.token, signal: options.signal, fetcher: this.fetcher, baseUrl: this.baseUrl });
  }

  // MARK: Status and sync

  Health(): Promise<HealthView> { return this.Get("/api/health"); }
  Status(): Promise<StatusView> { return this.Get("/api/status"); }

  /**
   * Sync every enabled source (after discovering new ones), or only the named `sources`. intel may wait
   * minutes for another sync first, so this goes through the companion's /local/sync, which keeps the
   * connection from going quiet.
   */
  async Sync(sources?: string[]): Promise<SyncResult> {
    const response = await this.Fetch("/local/sync", {
      method: "POST",
      headers: { ...this.JsonHeaders(), [LocalHeader]: "1" },
      body: JSON.stringify(Compact({ sources })),
    }, null);
    if (!response.ok || !response.body) throw await this.Failure(response);
    try {
      for await (const event of ReadEventStream(response.body)) {
        if (event.name !== "result") continue;
        const result = ParseJson<{ status: number; body?: unknown; unreachable?: string }>(event.data);
        if (result.unreachable !== undefined) throw IntelError.Unreachable(result.unreachable);
        if (result.status < 200 || result.status >= 300) {
          throw IntelError.FromFailure(result.status, JSON.stringify(result.body ?? {}));
        }
        return result.body as SyncResult;
      }
    } catch (error) {
      throw this.StreamFailure(error);
    }
    throw IntelError.Unreachable("the connection closed before the sync finished");
  }

  // MARK: Sources

  async Sources(): Promise<SourceStatus[]> {
    return this.Outdating(this.Get("/api/sources"), "manage sources");
  }

  AddSource(source: NewSource): Promise<SourceStatus> {
    return this.Post("/api/sources", { ...source });
  }

  /** A disabled source isn't synced; its data is kept. */
  SetSourceEnabled(id: number, enabled: boolean): Promise<SourceStatus> {
    return this.Post(`/api/sources/${id}/${enabled ? "enable" : "disable"}`, {});
  }

  // MARK: Brief and observations

  Brief(): Promise<BriefView> { return this.Get("/api/brief"); }

  Observations(includeClosed = false): Promise<ObservationView[]> {
    return this.Get("/api/observations", includeClosed ? { all: "1" } : {});
  }

  /** `action` is "ack", "dismiss" or "resolve". */
  RespondToObservation(id: number, action: "ack" | "dismiss" | "resolve",
                       options: { note?: string; unhelpful?: boolean } = {}): Promise<ObservationView> {
    return this.Post(`/api/observations/${id}/${action}`, { note: options.note, unhelpful: options.unhelpful ?? false });
  }

  // MARK: Activity

  /**
   * The activity feed, newest first. `before` is the previous page's `next_before`; `layer` is "source" or
   * "semantic" (none: both); `entity` keeps what is about it and everything that belongs to it.
   */
  async Events(options: { limit?: number; before?: number | null; layer?: string | null; entity?: string } = {}): Promise<EventPage> {
    const { limit = 100, before, layer, entity } = options;
    const call = this.Get<EventPage>("/api/events", { limit, before, layer: layer || undefined, entity });
    if (before != null || entity !== undefined) return call;
    return this.Outdating(call, "show recent activity");    // a missing route, not a missing event or entity
  }

  // MARK: Proposals

  Proposals(options: { filter?: string; status?: string; kind?: string } = {}): Promise<ProposalOverview> {
    return this.Get("/api/proposals", { filter: options.filter, status: options.status ?? "pending", kind: options.kind });
  }

  Proposal(id: number): Promise<ProposalDetail> { return this.Get(`/api/proposals/${id}`); }

  /** `edits` corrects the proposal before it is applied. */
  Decide(id: number, decision: "approve" | "reject",
         options: { note?: string; rename?: boolean; edits?: Record<string, string> } = {}): Promise<DecisionResult> {
    return this.Post(`/api/proposals/${id}/${decision}`,
                     { note: options.note, rename: options.rename ?? false, edits: options.edits });
  }

  /** The proposals a group decision would affect: exactly the named `group`. */
  PreviewGroup(group: string, kind?: string): Promise<ProposalView[]> {
    return this.Get("/api/proposals/group", { group, kind });
  }

  /** Approve or reject every pending proposal in a group (as named in ProposalOverview). */
  DecideGroup(group: string, decision: "approve" | "reject",
              options: { kind?: string; note?: string } = {}): Promise<GroupDecisionResult> {
    return this.Post("/api/proposals/group", { group, decision, kind: options.kind, note: options.note });
  }

  // MARK: Tasks

  Tasks(options: { includeClosed?: boolean; note?: string } = {}): Promise<TaskView[]> {
    return this.Get("/api/tasks", { all: options.includeClosed ? "1" : undefined, note: options.note });
  }

  /** Propose GitLab issues for one note's open tasks. `note` may be "R<record id>". */
  ImportTasks(note: string, project?: string): Promise<ImportResult> {
    return this.Post("/api/tasks/import", { note, project });
  }

  // MARK: Entities

  Entities(type?: string | null): Promise<EntitySummary[]> {
    return this.Get("/api/entities", { type: type || undefined });
  }

  /** `reference` is an id ("12"), a name, or a typed name ("repository:cascade"). */
  Entity(reference: string | number): Promise<EntityDetail> {
    return this.Get(`/api/entities/${encodeURIComponent(String(reference))}`);
  }

  /** `type` is project, component, repository, concept, person, … (lower_snake_case). */
  AddEntity(type: string, name: string, options: { aliases?: string[]; description?: string } = {}): Promise<EntityDetail> {
    return this.Post("/api/entities", { type, name, aliases: options.aliases ?? [], description: options.description });
  }

  /** The old name stays resolvable, as a former name. */
  RenameEntity(id: number, name: string, note?: string): Promise<EntityDetail> {
    return this.Post(`/api/entities/${id}/rename`, { name, note });
  }

  /** `kind` is "alias" (another name) or "former" (a name it used to have). */
  AddEntityName(id: number, name: string, kind: "alias" | "former" = "alias", note?: string): Promise<EntityDetail> {
    return this.Post(`/api/entities/${id}/names`, { name, kind, note });
  }

  RemoveEntityName(id: number, name: string, note?: string): Promise<EntityDetail> {
    return this.Post(`/api/entities/${id}/names/remove`, { name, note });
  }

  /** `status` is "active", "paused", "done" or "archived". */
  SetEntityStatus(id: number, status: string, note?: string): Promise<EntityDetail> {
    return this.Post(`/api/entities/${id}/status`, { status, note });
  }

  /** An empty description removes it. */
  DescribeEntity(id: number, description: string): Promise<EntityDetail> {
    return this.Post(`/api/entities/${id}/description`, { description });
  }

  /** `absorb` (an id or a name) is the same thing as entity `id`, which takes over its names and relationships. */
  MergeEntity(id: number, absorb: string, note?: string): Promise<EntityDetail> {
    return this.Post(`/api/entities/${id}/merge`, { absorb, note });
  }

  Predicates(): Promise<PredicateView[]> { return this.Get("/api/predicates"); }

  // MARK: Goals

  /** Active goals by priority; `includeClosed` adds achieved and abandoned ones. */
  Goals(includeClosed = false): Promise<GoalView[]> {
    return this.Outdating(this.Get("/api/goals", includeClosed ? { all: "1" } : {}), "manage goals");
  }

  /** `prioritizes`: entity ids or names. `priority`: 1 (highest) to 3. `targetDate`: "2026-10-30". */
  AddGoal(statement: string, prioritizes: string[], priority = 2, targetDate?: string | null): Promise<GoalView> {
    return this.Post("/api/goals", { statement, prioritizes, priority, target_date: targetDate });
  }

  /** Replace its priority, target date (none: cleared) and what it prioritizes. */
  UpdateGoal(id: number, priority: number, targetDate: string | null, prioritizes: string[], note?: string): Promise<GoalView> {
    return this.Post(`/api/goals/${id}`, { prioritizes, priority, target_date: targetDate, note });
  }

  /** `state` is "active", "achieved" or "abandoned". */
  SetGoalState(id: number, state: string, note?: string): Promise<GoalView> {
    return this.Post(`/api/goals/${id}/state`, { state, note });
  }

  // MARK: Relationships

  /** State a relationship (confirmed). `subject` and `object` are ids or names. */
  AddRelationship(subject: string, predicate: string, object: string, note?: string): Promise<RelationshipView> {
    return this.Post("/api/relationships", { subject, predicate, object, note });
  }

  /** "confirm", "reject" (remembered, so it isn't proposed again) or "end" (no longer true; kept as history). */
  DecideRelationship(id: number, action: "confirm" | "reject" | "end", note?: string): Promise<RelationshipView> {
    return this.Post(`/api/relationships/${id}/${action}`, { note });
  }

  // MARK: Ask

  async Ask(question: string, useLlm = true): Promise<AnswerView> {
    return NormalizeAnswer(await this.Post<AnswerView>("/api/ask", { question, use_llm: useLlm }));
  }

  /** Ask, with the answer text streamed while the model writes it. */
  async *AskStream(question: string, useLlm = true): AsyncGenerator<AskEvent> {
    const response = await this.Fetch("/api/ask/stream", {
      method: "POST",
      headers: this.JsonHeaders(),
      body: JSON.stringify({ question, use_llm: useLlm }),
    }, null);
    if (response.status === 404) {
      // An intel from before streaming (the service runs the old code until it restarts): ask plainly.
      await response.body?.cancel().catch(() => undefined);
      yield { kind: "answer", answer: await this.Ask(question, useLlm) };
      return;
    }
    if (!response.ok || !response.body) throw await this.Failure(response);
    const body = response.body;
    let answered = false;
    let finished = false;
    try {
      for await (const event of ReadEventStream(body)) {
        const decoded = AskEventFrom(event);
        if (!decoded) continue;
        if (decoded.kind === "answer") answered = true;
        yield decoded;
      }
      finished = true;
    } catch (error) {
      throw this.StreamFailure(error);
    } finally {
      if (!finished) await body.cancel().catch(() => undefined);
    }
    if (!answered) throw IntelError.Unreachable("the connection closed before the answer was complete");
  }

  // MARK: LLM model

  /** The model intel uses and the models its endpoint offers. */
  LlmModels(): Promise<LlmModelsView> { return this.Get("/api/llm/models"); }

  /** Use `model` for every LLM task from now on; null goes back to the model in intel's config. */
  ChooseLlmModel(model: string | null): Promise<LlmModelsView> {
    return this.Post("/api/llm/model", { model });
  }

  // MARK: Speech

  /**
   * `text` read aloud by intel's speech server, in the current persona's voice or the one `voice` describes.
   * One WAV stream, in pieces of about a fifth of a second, while the speech is still being generated.
   */
  async *SpeechStream(text: string, voice?: string): AsyncGenerator<Uint8Array> {
    const response = await this.Fetch("/api/speak/stream", {
      method: "POST",
      headers: this.JsonHeaders(),
      body: JSON.stringify(Compact({ text, voice })),
    }, null);
    if (!response.ok || !response.body) {
      if (response.status === 404) throw IntelError.Outdated("read aloud while it generates speech");
      throw await this.Failure(response);
    }
    const reader = response.body.getReader();
    const pieces: Uint8Array[] = [];
    let size = 0;
    const Take = (): Uint8Array => {
      const piece = new Uint8Array(size);
      let offset = 0;
      for (const part of pieces) {
        piece.set(part, offset);
        offset += part.length;
      }
      pieces.length = 0;
      size = 0;
      return piece;
    };
    let finished = false;
    try {
      for (;;) {
        let read: Awaited<ReturnType<typeof reader.read>>;
        try {
          read = await reader.read();
        } catch (error) {
          throw this.StreamFailure(error);
        }
        if (read.done) break;
        pieces.push(read.value);
        size += read.value.length;
        if (size >= SpeechPieceBytes) yield Take();
      }
      finished = true;
      if (size > 0) yield Take();
    } finally {
      if (!finished) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  // MARK: Personas

  /** The personas, the one in use, and the style and voice in intel's config. */
  Personas(): Promise<PersonasView> {
    return this.Outdating(this.Get("/api/personas"), "manage personas");
  }

  AddPersona(name: string, style: string, voice: string): Promise<PersonasView> {
    return this.Post("/api/personas", { name, style, voice });
  }

  UpdatePersona(id: number, name: string, style: string, voice: string): Promise<PersonasView> {
    return this.Post(`/api/personas/${id}`, { name, style, voice });
  }

  DeletePersona(id: number): Promise<PersonasView> {
    return this.Post(`/api/personas/${id}/delete`, {});
  }

  /** Answer in this persona's style and voice from now on; null goes back to those in intel's config. */
  ChoosePersona(id: number | null): Promise<PersonasView> {
    return this.Post("/api/personas/choose", { id });
  }

  // MARK: Transport

  private JsonHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  private Get<T>(path: string, query: Query = {}): Promise<T> {
    return this.Send<T>(path + QueryString(query), { method: "GET", headers: { Authorization: `Bearer ${this.token}` } });
  }

  private Post<T>(path: string, body: Body): Promise<T> {
    return this.Send<T>(path, { method: "POST", headers: this.JsonHeaders(), body: JSON.stringify(Compact(body)) });
  }

  private async Send<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.Fetch(path, init, JsonTimeoutMs);
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw this.StreamFailure(error);
    }
    if (!response.ok) throw this.FailureFromText(response, text);
    return ParseJson<T>(text);
  }

  /** fetch, with a timeout (null: none, for streams) and this client's signal. */
  private async Fetch(path: string, init: RequestInit, timeoutMs: number | null): Promise<Response> {
    const signals = [this.signal, timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs)]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    try {
      return await this.fetcher(this.baseUrl + path, { ...init, signal, cache: "no-store" });
    } catch (error) {
      throw this.StreamFailure(error);
    }
  }

  /** A transport failure as the error to report; an abort stays an abort (a cancellation, not a failure). */
  private StreamFailure(error: unknown): unknown {
    if (error instanceof IntelError) return error;
    if (error instanceof DOMException && error.name === "AbortError") return error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return IntelError.Unreachable("the request timed out");
    }
    if (error instanceof TypeError) return IntelError.Companion(error.message);
    return IntelError.Unreachable(error instanceof Error ? error.message : String(error));
  }

  private async Failure(response: Response): Promise<IntelError> {
    let text = "";
    try {
      text = await response.text();
    } catch {
      // the body is gone too; the status will do
    }
    return this.FailureFromText(response, text);
  }

  private FailureFromText(response: Response, text: string): IntelError {
    if (response.status === 502 && response.headers.get(UpstreamHeader) === "unreachable") {
      let message = "it doesn't answer";
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        // keep the general message
      }
      return IntelError.Unreachable(message);
    }
    return IntelError.FromFailure(response.status, text);
  }

  /** A 404 on a route an older intel doesn't have, as a message that says so. */
  private async Outdating<T>(call: Promise<T>, ability: string): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (error instanceof IntelError && error.kind === "server" && error.status === 404) throw IntelError.Outdated(ability);
      throw error;
    }
  }
}
