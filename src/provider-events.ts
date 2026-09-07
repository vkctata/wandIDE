/** Health checks share the provider channel but are not repository syncs. */
export function isRepositorySync(payload: unknown): payload is { provider: string; count: number } {
  if (!payload || typeof payload !== "object") return false;
  const event = payload as Record<string, unknown>;
  return typeof event.provider === "string" && event.provider.length > 0
    && Number.isSafeInteger(event.count) && (event.count as number) >= 0
    && event.error == null && (event.status == null || event.status === "ok");
}

export type ProviderFailure = { provider: string; message: string };

/** Keep failures independent: a successful GitHub poll cannot clear Azure's error. */
export function updateProviderHealth(current: ProviderFailure[], payload: unknown): ProviderFailure[] {
  if (!payload || typeof payload !== "object") return current;
  const event = payload as Record<string, unknown>;
  if (typeof event.provider !== "string" || !event.provider.trim()) return current;
  if (event.status !== "ok" && event.status !== "error") return current;
  const index = current.findIndex((failure) => failure.provider === event.provider);
  if (event.status === "ok") {
    return index < 0 ? current : current.filter((failure) => failure.provider !== event.provider);
  }
  const message = typeof event.error === "string" && event.error.trim()
    ? event.error : "Connection check failed. Review this provider in Settings.";
  if (index >= 0 && current[index].message === message) return current;
  const failure = { provider: event.provider, message };
  return index < 0 ? [...current, failure] : current.map((item, i) => i === index ? failure : item);
}
