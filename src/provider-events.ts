/** Health checks share the provider channel but are not repository syncs. */
export function isRepositorySync(payload: unknown): payload is { provider: string; count: number } {
  if (!payload || typeof payload !== "object") return false;
  const event = payload as Record<string, unknown>;
  return typeof event.provider === "string" && event.provider.length > 0
    && Number.isSafeInteger(event.count) && (event.count as number) >= 0
    && event.error == null && (event.status == null || event.status === "ok");
}
