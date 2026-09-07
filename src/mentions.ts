/** A selected agent remains selected only while its full mention is present. */
export function hasAgentMention(body: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(])@${escaped}(?=$|[\\s.,!?;:)])`, "u").test(body);
}
