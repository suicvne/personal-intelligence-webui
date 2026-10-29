// The JSON the intel API sends.
//
// These mirror the Pydantic models in personal-intelligence/src/intel/api.py (and the SwiftUI app's
// api_models.swift). Field names stay as they are on the wire (snake_case): several fields are dictionaries
// whose keys are data (`settings`, `fields`, `identifiers`, `ambiguous`), which no renaming could tell apart.
// Fields an older intel doesn't send are optional. tests/decoding.test.ts checks them against real samples.

// MARK: Status and sync

export interface HealthView {
  ok: boolean;
  version: string;
}

export interface SourceStatus {
  id: number;
  name: string;
  kind: string;                         // "filesystem" | "git" | "gitlab"
  enabled: boolean;
  discovered: boolean;
  location: string | null;
  records: number;
  last_success_at: string | null;
  last_run: string | null;              // "succeeded" | "failed" | "running" | "interrupted"; null before the first sync
  last_error: string | null;
  discovered_from?: string | null;      // the git root or notes folder it was discovered in
  poll_interval_seconds?: number | null;
  settings?: Record<string, string> | null;
}

export function SourceFailed(source: SourceStatus): boolean {
  return source.last_run === "failed";
}

/** A source to add (POST /api/sources); only the fields for its kind are used. */
export interface NewSource {
  kind: "filesystem" | "git" | "gitlab";
  name: string;
  path?: string;
  include: string[];                    // filename patterns; empty: intel's defaults
  include_documents: boolean;           // git: also read Markdown and text files
  url?: string;
  projects: string[];
  groups: string[];
  token_env?: string;
  verify_tls: boolean;
}

export interface StatusView {
  version: string;
  database: string;
  llm: string;
  sources: SourceStatus[];
  entity_counts: Record<string, number>;
  pending_proposals: number;
  open_observations: number;            // every open observation, including ones already seen
  needs_attention: number;              // what the Brief would show right now: the Brief badge
  open_tasks: number;
  queue: Record<string, number>;
  last_observed_at: string | null;
}

export interface SyncResult {
  lines: string[];
  events: number;
  entities_created: number;
  queued: number;
}

// MARK: LLM model

export interface LlmModelsView {
  enabled: boolean;
  base_url: string | null;
  configured: string | null;            // [llm] model in intel's config
  chosen: string | null;                // picked here or with `intel llm use`; overrides `configured`
  current: string | null;
  available: string[];
  error: string | null;                 // why `available` is empty
}

// MARK: Evidence and observations

export interface EvidenceView {
  record_id: number | null;
  source: string | null;
  kind: string | null;
  title: string | null;
  location: string | null;
  uri: string | null;
  excerpt: string | null;
  context: string | null;
  note: string | null;
  stale: boolean;
  model: string | null;
}

export interface ObservationView {
  id: number;
  category: string;
  summary: string;
  explanation: string;
  confidence: number;
  priority: number;
  status: string;
  created_at: string;
  reason: string | null;
  entities: string[];
  evidence: EvidenceView[];
}

export interface BriefView {
  created_at: string;
  window_start: string | null;
  observations: ObservationView[];
  activity: string[];
  knowledge_changes: string[];
  pending_proposals: number;
  ambiguous_mentions: number;
  failed_work: number;
  text: string;
}

// MARK: Activity

export interface EventView {
  id: number;
  layer: string;                        // "source": a change in a source; "semantic": a change in what intel knows
  type: string;                         // commit.added, document.modified, entity.renamed, …
  summary: string;
  at: string;
  source: string | null;
  record_id: number | null;
  uri: string | null;
  entity_id: number | null;
  entity: string | null;
  entity_type: string | null;
  origin: string | null;                // "user" | "llm" | "rule" | "source"
}

export interface EventPage {
  events: EventView[];
  next_before: number | null;
}

// MARK: Proposals

export interface ProposalView {
  id: number;
  kind: string;
  origin: string;
  status: string;
  summary: string;
  source: string;
  group: string;
  confidence: number | null;
  created_at: string;
}

export interface ProposalGroupView {
  name: string;
  sources: number;
  kinds: Record<string, number>;
  proposals: ProposalView[];
}

export interface ProposalOverview {
  total: number;
  groups: ProposalGroupView[];
  predicates: string[];
}

export interface ProposalDetail {
  proposal: ProposalView;
  rationale: string | null;
  decision_note: string | null;
  fields: Record<string, string>;       // current values of what may be corrected before approving
  evidence: EvidenceView[];
}

export interface DecisionResult {
  proposal: ProposalView;
  also_approved: ProposalView[];
  created_issue_url: string | null;
}

export interface GroupDecisionResult {
  decision: string;
  decided: number;
  groups: string[];
}

// MARK: Tasks

export interface TaskView {
  id: number;
  text: string;
  state: string;                        // "open" | "done" | "removed"
  location: string;
  note_path: string | null;
  line: number;
  section: string | null;
  backlog: boolean;
  tracked_as: string | null;
  issue_url: string | null;
  record_id: number;
}

export interface ImportResult {
  note: string;
  proposed: number;
  unplaced: number;
}

// MARK: Entities

export interface EntitySummary {
  id: number;
  type: string;
  name: string;
  status: string;
  other_names: string[];
}

export interface NameView {
  name: string;
  kind: string;                         // "canonical" | "alias" | "former"
  origin: string;
  until: string | null;
}

export interface RelationshipView {
  id: number;
  subject_id: number;
  subject: string;
  predicate: string;
  object_id: number;
  object: string;
  status: string;                       // "asserted" | "confirmed" | "rejected"
  origin: string;
  confidence: number | null;
}

export interface PredicateView {
  name: string;
  meaning: string;
}

export interface ActivityView {
  at: string;
  kind: string;
  title: string | null;
  source: string;
  record_id: number;
}

export interface EntityDetail {
  entity: EntitySummary;
  description: string | null;
  status_note: string | null;
  names: NameView[];
  identifiers: Record<string, string>;
  properties: Record<string, string>[]; // {key, value, where}
  relationships: RelationshipView[];
  activity: ActivityView[];
  observations: ObservationView[];
  decision: string | null;
  goal: string | null;
}

// MARK: Goals

export interface GoalTargetView {
  id: number;
  name: string;
  type: string;
  last_activity_at: string | null;
}

export interface GoalView {
  id: number;
  statement: string;
  priority: number;                     // 1 is the highest
  target_date: string | null;           // "2026-10-30"
  state: string;                        // "active" | "achieved" | "abandoned"
  prioritizes: GoalTargetView[];
  observations: ObservationView[];
}

// MARK: Ask

export interface CitedStatement {
  statement: string;
  refs: string[];
}

export interface ReferenceView {
  ref: string;
  kind: string;
  label: string;
  record_id: number | null;
  entity_id: number | null;
  uri: string | null;
}

/** One lookup the model made before answering. */
export interface LookupView {
  text: string;                         // the call and what it found
  description: string;                  // what was looked up, in words (`text` from an intel that doesn't say)
  result: string | null;                // what it found; null from an intel that doesn't say
}

export interface AnswerView {
  question: string;
  mode: string;                         // "llm" | "retrieval_only" | "no_evidence"
  text: string;
  spoken_text: string;                  // `text` without its citations, for reading aloud ("" from an older intel)
  evidence: CitedStatement[];
  inferences: CitedStatement[];
  gaps: string[];
  references: ReferenceView[];
  ambiguous: Record<string, string[]>;
  invalid_refs: string[];
  note: string | null;
  lookups: LookupView[] | null;         // null from an intel that can't look things up
}

export type AskEvent =
  | { kind: "lookup"; lookup: LookupView }
  | { kind: "delta"; text: string }
  /** The whole answer text as soon as it's written: early enough to start reading it aloud. */
  | { kind: "answerText"; text: string; spokenText: string }
  /** The final answer; its text replaces the streamed text. */
  | { kind: "answer"; answer: AnswerView };

// MARK: Personas

export interface PersonaView {
  id: number;
  name: string;
  style: string;                        // "" means plainly
  voice: string;                        // "" means PersonasView.configured_voice
}

export interface PersonasView {
  personas: PersonaView[];
  chosen: number | null;                // null: the style and voice in intel's config
  configured_style: string;
  configured_voice: string;
}

// MARK: Older intels

/** A lookup as any intel sends it: a bare string or {"text"} from before descriptions. */
export function NormalizeLookup(raw: unknown): LookupView {
  if (typeof raw === "string") return { text: raw, description: raw, result: null };
  const value = (raw ?? {}) as Partial<LookupView>;
  const text = String(value.text ?? "");
  return { text, description: value.description ?? text, result: value.result ?? null };
}

export function NormalizeAnswer(raw: AnswerView): AnswerView {
  return {
    ...raw,
    spoken_text: raw.spoken_text ?? "",
    evidence: raw.evidence ?? [],
    inferences: raw.inferences ?? [],
    gaps: raw.gaps ?? [],
    references: raw.references ?? [],
    ambiguous: raw.ambiguous ?? {},
    invalid_refs: raw.invalid_refs ?? [],
    note: raw.note ?? null,
    lookups: raw.lookups == null ? null : raw.lookups.map(NormalizeLookup),
  };
}
