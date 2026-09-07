export type UpdateProgress =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export type DownloadState = { bytes: number; total?: number; finished: boolean };

export function accumulateDownload(current: DownloadState, event: UpdateProgress): DownloadState {
  if (event.event === "Started") {
    const length = event.data.contentLength;
    return { bytes: 0, total: typeof length === "number" && Number.isFinite(length) && length > 0 ? length : undefined, finished: false };
  }
  if (event.event === "Finished") return { ...current, finished: true };
  const length = event.data.chunkLength;
  return Number.isFinite(length) && length > 0 ? { ...current, bytes: current.bytes + length } : current;
}

/** Called only from the approval button. A restart retry never reinstalls. */
export async function installApprovedUpdate(
  alreadyInstalled: boolean,
  downloadAndInstall: () => Promise<void>,
  markInstalled: () => void,
  restart: () => Promise<void>,
): Promise<void> {
  if (!alreadyInstalled) {
    await downloadAndInstall();
    markInstalled();
  }
  await restart();
}
