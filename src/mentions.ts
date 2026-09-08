/** A selected agent remains selected only while its full mention is present. */
export function hasAgentMention(body: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(])@${escaped}(?=$|[\\s.,!?;:)])`, "u").test(body);
}

export function activeMentionAt(body: string, caret: number) {
  const end = Math.max(0, Math.min(body.length, caret));
  const start = body.lastIndexOf('@', end - 1);
  if (start < 0 || start >= end || (start > 0 && !/[\s(]/.test(body[start - 1]))) return null;
  const query = body.slice(start + 1, end);
  if (query.length > 80 || /[\r\n@]/.test(query)) return null;
  return { start, end, query };
}

export function insertAgentMention(body: string, caret: number, name: string) {
  const range = activeMentionAt(body, caret);
  if (!range) return null;
  let end = range.end;
  // If the cursor is inside a partially typed name, replace its remaining token.
  while (end < body.length && /[^\s@.,!?;:)]/.test(body[end])) end++;
  const mention = `@${name}`;
  const suffix = body.slice(end);
  const separator = /^[\s.,!?;:)]/.test(suffix) ? '' : ' ';
  return { text: body.slice(0, range.start) + mention + separator + suffix,
    caret: range.start + mention.length + separator.length };
}
