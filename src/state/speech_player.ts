// Reading an answer aloud: intel turns the text into speech (POST /api/speak/stream, using `[voice]` in its
// config) and this plays it while it is still being generated, through the Web Audio API. Stop also stops
// the speech being generated.
//
// Browsers only start audio from a click or a key press, so UnlockAudio() runs inside those (Ask, Read
// aloud, Preview Voice); the speech itself starts later, when the first samples arrive.
import type { IntelClient } from "../api/intel_client.ts";
import { Describe, IsCancel } from "../api/intel_error.ts";
import { WavStreamReader, type WavFormat } from "../api/wav_stream.ts";

export type SpeechState = "idle" | "preparing" | "playing";

export interface SpeechSnapshot {
  state: SpeechState;
  /** Why the last text couldn't be read aloud, until the next try. */
  failure: string | null;
}

/** Collect this much before playing, so pieces don't play with gaps between them. */
export const MinimumSeconds = 0.2;
/** How far ahead of now the first piece is scheduled. */
export const LeadSeconds = 0.05;

let shared: AudioContext | null = null;

function Context(): AudioContext {
  shared ??= new AudioContext();
  return shared;
}

/** Call inside a click or key press, so speech that starts later is allowed to play. */
export function UnlockAudio(): void {
  try {
    const context = Context();
    if (context.state !== "running") void context.resume();
  } catch {
    // no Web Audio here: reading aloud will say so
  }
}

/** 16-bit little-endian samples, interleaved, as one array of floats (-1…1) per channel. */
export function PcmToChannels(bytes: Uint8Array, channels: number): Float32Array<ArrayBuffer>[] {
  const frames = Math.floor(bytes.length / (2 * channels));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      output[channel]![frame] = view.getInt16((frame * channels + channel) * 2, true) / 32768;
    }
  }
  return output;
}

/** When the next piece starts: right after the last one, or (when that has passed) just ahead of now. */
export function NextStart(cursor: number, now: number): number {
  return Math.max(cursor, now + LeadSeconds);
}

export class SpeechPlayer {
  private snapshot: SpeechSnapshot = { state: "idle", failure: null };
  private readonly listeners = new Set<() => void>();
  /** What is being (or was last) read aloud; Stop forgets it. */
  private text: string | null = null;
  private controller: AbortController | null = null;
  private gain: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private cursor = 0;
  private unplayed = 0;            // buffers scheduled and not played yet
  private received = false;        // the whole speech has arrived
  private generation = 0;          // which Speak a buffer belongs to

  readonly Snapshot = (): SpeechSnapshot => this.snapshot;

  readonly Subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private Set(changes: Partial<SpeechSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) listener();
  }

  /**
   * Read `text` aloud, in the current persona's voice or the one `voice` describes, instead of anything being
   * read now. Text already being read (or read since the last Stop) is not read again, unless `again`.
   */
  Speak(text: string, client: IntelClient, options: { voice?: string; again?: boolean } = {}): void {
    if (text === this.text && !options.again) return;
    this.Stop();
    this.text = text;
    const controller = new AbortController();
    this.controller = controller;
    const current = this.generation;
    this.Set({ state: "preparing", failure: null });
    void this.Stream(text, options.voice, client.With({ signal: controller.signal }), current).catch((error: unknown) => {
      if (IsCancel(error) || controller.signal.aborted || current !== this.generation) return;    // stopped
      this.Release();
      this.Set({ failure: Describe(error) });
    });
  }

  Stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.Release();
    this.text = null;
  }

  private async Stream(text: string, voice: string | undefined, client: IntelClient, current: number): Promise<void> {
    const reader = new WavStreamReader();
    let format: WavFormat | null = null;
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    const Flush = (): void => {
      if (!format || pendingBytes === 0) return;
      const joined = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const piece of pending) {
        joined.set(piece, offset);
        offset += piece.length;
      }
      pending = [];
      pendingBytes = 0;
      this.Schedule(PcmToChannels(joined, format.channels), format.sampleRate, current);
    };
    for await (const piece of client.SpeechStream(text, voice)) {
      if (current !== this.generation) return;
      for (const event of reader.Feed(piece)) {
        if (event.kind === "format") {
          format = event.format;
          await this.Start(current);
          if (current !== this.generation) return;
        } else if (format) {
          pending.push(event.data);
          pendingBytes += event.data.length;
          const bytesPerSecond = format.sampleRate * format.channels * 2;
          if (pendingBytes >= bytesPerSecond * MinimumSeconds) Flush();
        }
      }
    }
    if (current !== this.generation) return;
    Flush();
    this.received = true;
    this.FinishIfPlayed();
  }

  private async Start(current: number): Promise<void> {
    const context = Context();
    if (context.state !== "running") {
      await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 500))]);
      if (current !== this.generation) return;
      if ((context.state as AudioContextState) !== "running") {
        throw new Error("Your browser blocked the audio. Press Read aloud to hear it.");
      }
    }
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.cursor = 0;
    this.Set({ state: "playing" });
  }

  /** Queue samples to play after those already queued. A piece that comes late plays when it comes. */
  private Schedule(channels: Float32Array<ArrayBuffer>[], sampleRate: number, current: number): void {
    const frames = channels[0]?.length ?? 0;
    if (frames === 0 || !this.gain) return;
    const context = Context();
    const buffer = context.createBuffer(channels.length, frames, sampleRate);
    channels.forEach((samples, channel) => buffer.copyToChannel(samples, channel));
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const start = NextStart(this.cursor, context.currentTime);
    source.start(start);
    this.cursor = start + buffer.duration;
    this.sources.push(source);
    this.unplayed += 1;
    source.onended = () => {
      if (current !== this.generation) return;
      this.unplayed -= 1;
      this.FinishIfPlayed();
    };
  }

  private FinishIfPlayed(): void {
    if (this.received && this.unplayed === 0) this.Release();
  }

  /** Stop playing; anything still scheduled is dropped. */
  private Release(): void {
    this.generation += 1;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // never started
      }
      source.disconnect();
    }
    this.sources = [];
    this.gain?.disconnect();
    this.gain = null;
    this.unplayed = 0;
    this.received = false;
    if (this.snapshot.state !== "idle") this.Set({ state: "idle" });
  }
}
