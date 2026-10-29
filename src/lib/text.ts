// Small text helpers for forms.

export function Trimmed(text: string): string {
  return text.trim();
}

/** "a, b,,c" (or one per line) -> ["a", "b", "c"]. */
export function SplitList(text: string): string[] {
  return text.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== "");
}
