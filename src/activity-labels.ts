type NamedAgent = { id: string; name: string };

/** Only rewrite the backend's generated stage summary, never arbitrary output. */
export function activityMessage(kind: string, message: string, agents: NamedAgent[]): string {
  if (!kind.startsWith('agent.')) return message;
  const match = /^(.*) completed stage (\d+)$/.exec(message);
  if (!match) return message;
  const agent = agents.find(item => item.id === match[1]);
  return agent ? `${agent.name} completed stage ${match[2]}` : message;
}
