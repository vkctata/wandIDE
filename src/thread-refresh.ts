export async function readThreadSnapshot<T>(read: () => Promise<T[]>): Promise<
  { messages: T[]; error: null } | { messages: null; error: string }
> {
  try {
    return { messages: await read(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { messages: null, error: message.trim() || 'Unable to read repository history' };
  }
}

/** Messages are append-only. A snapshot must not erase a newer live event. */
export function mergeThreadSnapshot<T extends { id: number }>(current: T[], snapshot: T[]): T[] {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of snapshot) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.id - b.id);
}
