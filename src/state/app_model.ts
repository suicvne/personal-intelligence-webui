// State shared by every screen: the token, the latest status, the problem banner, and a refresh signal
// (the SwiftUI app's AppModel). A plain class, so it can be tested without React; app_context.tsx
// connects it to the screens.
import { GetLocalInfo, type LocalInfo } from "../api/companion.ts";
import { IntelClient } from "../api/intel_client.ts";
import { Describe, IntelError, IsCancel } from "../api/intel_error.ts";
import type { StatusView } from "../api/models.ts";
import { LoadToken, SaveToken } from "./preferences.ts";

export interface AppState {
  token: string;
  status: StatusView | null;
  /** The last problem talking to intel, shown in a banner until the next success. */
  problem: string | null;
  isSyncing: boolean;
  lastSyncLines: string[];
  /** Screens reload whenever this changes (r, after syncing, after saving settings). */
  refreshToken: number;
  showingSettings: boolean;
  /** A short note that goes away by itself ("Shown in Finder: …"). */
  notice: string | null;
  local: LocalInfo | null;
}

export interface ModelOptions {
  token?: string;
  fetcher?: typeof fetch;
  saveToken?: (token: string) => void;
  loadLocalInfo?: () => Promise<LocalInfo>;
}

export class AppModel {
  private state: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly fetcher: typeof fetch | undefined;
  private readonly saveToken: (token: string) => void;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ModelOptions = {}) {
    const token = options.token ?? LoadToken();
    this.fetcher = options.fetcher;
    this.saveToken = options.saveToken ?? SaveToken;
    this.state = {
      token,
      status: null,
      problem: null,
      isSyncing: false,
      lastSyncLines: [],
      refreshToken: 0,
      showingSettings: token === "",
      notice: null,
      local: null,
    };
    (options.loadLocalInfo ?? GetLocalInfo)().then((local) => this.Set({ local }), () => undefined);
  }

  // MARK: Observing (for useSyncExternalStore)

  readonly Snapshot = (): AppState => this.state;

  readonly Subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private Set(changes: Partial<AppState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }

  // MARK: Talking to intel

  /** A client with the saved token. */
  get client(): IntelClient {
    return this.ClientFor(this.state.token);
  }

  /** A client with another token (Settings tests one before saving it). */
  ClientFor(token: string): IntelClient {
    return new IntelClient({ token, fetcher: this.fetcher });
  }

  RequestRefresh(): void {
    this.Set({ refreshToken: this.state.refreshToken + 1 });
  }

  /** Run an API call, recording a failure in `problem`. Null when it failed or was cancelled. */
  async Run<T>(call: (client: IntelClient) => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    try {
      const result = await call(this.client.With({ signal }));
      if (signal?.aborted) return null;
      if (this.state.problem !== null) this.Set({ problem: null });
      return result;
    } catch (error) {
      if (IsCancel(error) || signal?.aborted) return null;
      this.Set({ problem: Describe(error) });
      return null;
    }
  }

  /**
   * Like Run, for a form: why it failed goes to `failed`, to show next to the form. Only a failure to talk to
   * intel also becomes `problem`; intel refusing the form's values ("There is no folder at …") doesn't.
   */
  async Submit<T>(call: (client: IntelClient) => Promise<T>, failed: (message: string) => void,
                  signal?: AbortSignal): Promise<T | null> {
    try {
      const result = await call(this.client.With({ signal }));
      if (this.state.problem !== null) this.Set({ problem: null });
      return result;
    } catch (error) {
      if (IsCancel(error) || signal?.aborted) return null;
      const message = Describe(error);
      if (error instanceof IntelError && error.isClientError && error.status !== 401) {
        failed(message);
        return null;
      }
      this.Set({ problem: message });
      failed(message);
      return null;
    }
  }

  /** Go through a stream of API events as they arrive, recording a failure in `problem` like Run. */
  async Follow<E>(events: AsyncIterable<E>, handle: (event: E) => void, signal?: AbortSignal): Promise<void> {
    try {
      for await (const event of events) {
        if (signal?.aborted) return;
        handle(event);
      }
      if (!signal?.aborted && this.state.problem !== null) this.Set({ problem: null });
    } catch (error) {
      if (IsCancel(error) || signal?.aborted) return;
      this.Set({ problem: Describe(error) });
    }
  }

  async LoadStatus(signal?: AbortSignal): Promise<void> {
    if (this.state.token === "") return;
    const status = await this.Run((client) => client.Status(), signal);
    if (status) this.Set({ status });
  }

  async SyncNow(): Promise<void> {
    if (this.state.isSyncing) return;
    this.Set({ isSyncing: true });
    try {
      const result = await this.Run((client) => client.Sync());
      if (result) {
        this.Set({ lastSyncLines: result.lines });
        this.RequestRefresh();
      }
    } finally {
      this.Set({ isSyncing: false });
    }
  }

  /** Keep a token (in this browser) and reload everything with it. */
  SaveToken(token: string): void {
    this.saveToken(token);
    this.Set({ token: token.trim(), problem: null, status: token.trim() === "" ? null : this.state.status });
    this.RequestRefresh();
  }

  // MARK: The page

  ShowSettings(showing: boolean): void {
    this.Set({ showingSettings: showing });
  }

  Notice(message: string): void {
    clearTimeout(this.noticeTimer);
    this.Set({ notice: message });
    this.noticeTimer = setTimeout(() => this.Set({ notice: null }), 5000);
  }
}
