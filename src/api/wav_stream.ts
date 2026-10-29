// WAV while it streams in, as intel's /api/speak/stream sends it: a header (usually with an open-ended
// length), then the samples while the speech is still being generated.

export interface WavFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export function BytesPerFrame(format: WavFormat): number {
  return (format.channels * format.bitsPerSample) / 8;
}

export type WavStreamEvent =
  | { kind: "format"; format: WavFormat }       // comes before any samples
  | { kind: "samples"; data: Uint8Array };      // signed little-endian integers, in whole frames

export class WavStreamError extends Error {
  static NotWav(): WavStreamError {
    return new WavStreamError("intel sent something that isn't WAV audio.");
  }

  static Unsupported(what: string): WavStreamError {
    return new WavStreamError(`intel sent WAV audio this app can't play (${what}).`);
  }
}

const OpenEnded = 0xffffffff;

function Concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (a.length === 0) return new Uint8Array(b);
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  return joined;
}

function Ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Reads one WAV stream fed in pieces of any size. */
export class WavStreamReader {
  private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private format: WavFormat | null = null;
  private inSamples = false;
  private samplesLeft: number | null = null;     // null: until the stream ends

  /** What the newly arrived `data` completes. */
  Feed(data: Uint8Array): WavStreamEvent[] {
    this.buffer = Concat(this.buffer, data);
    const events: WavStreamEvent[] = [];
    if (!this.inSamples) {
      const header = this.ReadHeader();
      if (!header) return [];
      events.push({ kind: "format", format: header });
    }
    const format = this.format;
    if (!format) return events;
    let available = this.buffer.length;
    if (this.samplesLeft !== null) available = Math.min(available, this.samplesLeft);
    available -= available % BytesPerFrame(format);
    if (available > 0) {
      events.push({ kind: "samples", data: this.buffer.slice(0, available) });
      this.buffer = this.buffer.slice(available);
      if (this.samplesLeft !== null) this.samplesLeft -= available;
    }
    return events;
  }

  /** The format, once the header up to the samples has arrived (null until then). */
  private ReadHeader(): WavFormat | null {
    const buffer = this.buffer;
    if (buffer.length < 12) return null;
    if (Ascii(buffer, 0, 4) !== "RIFF" || Ascii(buffer, 8, 4) !== "WAVE") throw WavStreamError.NotWav();
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 12;
    let found: WavFormat | null = null;
    while (buffer.length >= offset + 8) {
      const chunk = Ascii(buffer, offset, 4);
      const size = view.getUint32(offset + 4, true);
      if (chunk === "data") {
        if (!found) throw WavStreamError.Unsupported("no format before the samples");
        this.buffer = buffer.slice(offset + 8);
        this.format = found;
        this.inSamples = true;
        this.samplesLeft = size === 0 || size === OpenEnded ? null : size;
        return found;
      }
      const padded = size + (size & 1);
      if (buffer.length < offset + 8 + padded) return null;
      if (chunk === "fmt ") {
        const tag = view.getUint16(offset + 8, true);
        const channels = view.getUint16(offset + 10, true);
        const rate = view.getUint32(offset + 12, true);
        const bits = view.getUint16(offset + 22, true);
        if (tag !== 1 || bits !== 16 || channels <= 0) {
          throw WavStreamError.Unsupported(`format ${tag}, ${bits} bits, ${channels} channels`);
        }
        found = { sampleRate: rate, channels, bitsPerSample: bits };
      }
      offset += 8 + padded;
    }
    return null;
  }
}
