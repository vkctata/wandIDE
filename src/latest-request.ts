/** Discard stale responses, including callbacks from an unmounted view. */
export function latestRequest() {
  let version = 0;
  return {
    begin() {
      const current = ++version;
      return () => current === version;
    },
    invalidate() { version++; },
  };
}
