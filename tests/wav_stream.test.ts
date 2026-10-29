// Reading the WAV stream /api/speak/stream sends, in pieces of any size (ported from wav_stream_tests.swift).
import { describe, expect, test } from "vitest";
import { WavStreamError, WavStreamReader, type WavFormat } from "../src/api/wav_stream.ts";

export function WavHeader(options: { rate?: number; channels?: number; bits?: number; tag?: number; dataBytes?: number } = {}): Uint8Array {
  const { rate = 24_000, channels = 1, bits = 16, tag = 1, dataBytes = 0xffffffff } = options;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const Ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) header[offset + i] = text.charCodeAt(i);
  };
  Ascii(0, "RIFF");
  view.setUint32(4, 0xffffffff, true);
  Ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, tag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true);
  view.setUint16(34, bits, true);
  Ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

function Join(...parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function Read(stream: Uint8Array, size: number): { formats: WavFormat[]; samples: Uint8Array } {
  const reader = new WavStreamReader();
  const formats: WavFormat[] = [];
  const pieces: Uint8Array[] = [];
  for (let start = 0; start < stream.length; start += size) {
    for (const event of reader.Feed(stream.slice(start, start + size))) {
      if (event.kind === "format") formats.push(event.format);
      else {
        expect(event.data.length % 2).toBe(0);
        pieces.push(event.data);
      }
    }
  }
  return { formats, samples: Join(...pieces) };
}

describe("WavStreamReader", () => {
  test("reads an open-ended WAV stream in pieces of any size", () => {
    const samples = Uint8Array.from({ length: 4_000 }, (_, i) => i % 251);
    for (const size of [1, 3, 44, 45, 1_000, 10_000]) {
      const read = Read(Join(WavHeader(), samples), size);
      expect(read.formats).toEqual([{ sampleRate: 24_000, channels: 1, bitsPerSample: 16 }]);
      expect(read.samples).toEqual(samples);
    }
  });

  test("stops at the end of a WAV with a length", () => {
    const read = Read(Join(WavHeader({ dataBytes: 6 }), Uint8Array.from([1, 2, 3, 4, 5, 6]), new TextEncoder().encode("LIST")), 5);
    expect(read.samples).toEqual(Uint8Array.from([1, 2, 3, 4, 5, 6]));
  });

  test("refuses what it can't play", () => {
    expect(() => new WavStreamReader().Feed(new TextEncoder().encode("{\"error\": \"nope\"}"))).toThrow(WavStreamError);
    expect(() => new WavStreamReader().Feed(WavHeader({ bits: 32, tag: 3 }))).toThrow(WavStreamError);
  });
});
