type NamedAgent = { id: string; name: string };

export function agentDisplayName(id: string, agents: NamedAgent[]): string {
  // The backend's verification stage reuses the persisted Sentinel configuration.
  const persistedId = id === 'sentinel-verifier' ? 'sentinel' : id;
  return agents.find(agent => agent.id === persistedId)?.name || id;
}

/** Only rewrite the backend's generated stage summary, never arbitrary output. */
export function activityMessage(kind: string, message: string, agents: NamedAgent[]): string {
  if (!kind.startsWith('agent.')) return message;
  const match = /^(.*) completed stage (\d+)$/.exec(message);
  if (!match) return message;
  return `${agentDisplayName(match[1], agents)} completed stage ${match[2]}`;
}
