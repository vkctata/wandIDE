export async function readSearchSources<T>(sources: Array<{ name: string; read: () => Promise<T[]> }>) {
  const results = await Promise.allSettled(sources.map(source => Promise.resolve().then(source.read)));
  return {
    rows: results.map(result => result.status === 'fulfilled' ? result.value : []),
    unavailable: results.flatMap((result, index) => result.status === 'rejected' ? [sources[index].name] : []),
  };
}
