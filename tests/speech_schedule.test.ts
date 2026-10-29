// Turning streamed samples into Web Audio buffers, and when each piece plays.
import { expect, test } from "vitest";
import { LeadSeconds, NextStart, PcmToChannels } from "../src/state/speech_player.ts";

test("16-bit samples become floats, a channel at a time, from any offset", () => {
  const bytes = new Uint8Array([0xaa, 0x00, 0x00, 0x00, 0x80, 0xff, 0x7f, 0x00, 0x00, 0xbb]);   // L 0, R -32768; L 32767, R 0
  const view = bytes.subarray(1, 9);              // an odd offset, as pieces of a stream can have
  const [left, right] = PcmToChannels(view, 2);
  expect(Array.from(left!)).toEqual([0, 32767 / 32768]);
  expect(Array.from(right!)).toEqual([-1, 0]);
  expect(PcmToChannels(new Uint8Array([0, 64, 0]), 1)[0]!.length).toBe(1);   // half a frame waits
});

test("pieces play one after another; a late one plays as soon as it comes", () => {
  expect(NextStart(0, 10)).toBe(10 + LeadSeconds);
  expect(NextStart(12.5, 10)).toBe(12.5);
  expect(NextStart(9, 10)).toBe(10 + LeadSeconds);
});
