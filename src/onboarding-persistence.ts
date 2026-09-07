type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;

export function previewOnboardingComplete(storage: StorageAccess): boolean {
  try { return storage().getItem("wand.onboarding.complete") === "true"; }
  catch { return false; }
}

export async function persistOnboardingName(
  name: string,
  native: boolean,
  saveNative: (name: string) => Promise<unknown>,
  storage: StorageAccess,
): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new Error("Please enter your name.");
  if (native) {
    // The local database is authoritative. Never hide a failed native save.
    await saveNative(clean);
  } else {
    // Browser previews have no database; storage failures must remain visible.
    const local = storage();
    local.setItem("wand.user-name", clean);
    local.setItem("wand.onboarding.complete", "true");
  }
  return clean;
}
