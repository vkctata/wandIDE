export type AppearanceSetting =
  | { key: 'theme'; value: 'obsidian' | 'daylight' }
  | { key: 'font'; value: 'system' | 'fira-code' | 'jetbrains-mono' | 'avenir' };

export async function persistAppearance(
  setting: AppearanceSetting,
  native: boolean,
  saveNative: (setting: AppearanceSetting) => Promise<unknown>,
  storage: () => Pick<Storage, 'setItem'>,
): Promise<void> {
  if (native) await saveNative(setting);
  else storage().setItem(`wand.${setting.key}`, setting.value);
}

export function readPreviewAppearance(key: 'theme' | 'font', storage: () => Pick<Storage, 'getItem'>): string | null {
  try { return storage().getItem(`wand.${key}`); }
  catch { return null; }
}
