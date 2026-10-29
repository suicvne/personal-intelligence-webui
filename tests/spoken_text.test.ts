// The text read aloud, as intel makes it.
import { expect, test } from "vitest";
import { WithoutCitations } from "../src/lib/spoken_text.ts";

test("leaves out citations as intel does", () => {     // personal-intelligence tests/test_ask.py
  expect(WithoutCitations("Escape became a queued action [R2, E1]. Nothing else changed (R3); see A1 too."))
    .toBe("Escape became a queued action. Nothing else changed; see A1 too.");
});
