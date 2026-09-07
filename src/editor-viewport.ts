/** Monaco is constructed while its React host is hidden. Measure again after
 * mount so the first native paint does not depend on a deferred resize frame. */
export function initializeEditorViewport(
  host: { layout(): void },
  views: ReadonlyArray<{ render(forceRedraw: boolean): void }>,
): void {
  host.layout();
  for (const view of views) view.render(true);
}
