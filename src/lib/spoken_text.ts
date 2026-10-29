// The text of an answer as it is read aloud, and its citations.

/** Citations such as "[R3, E2]" or "(R3)", as intel finds them (query/ask.py). */
export const CitationPattern = /\s*[[(]\s*[EDGOFRATL]\d+(?:\s*[,;]\s*[EDGOFRATL]\d+)*\s*[\])]/g;

/** The text for reading aloud, as intel's WithoutCitations makes it. */
export function WithoutCitations(text: string): string {
  return text.replace(CitationPattern, "");
}
