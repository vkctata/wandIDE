export const releasePage = 'https://github.com/vkctata/wandIDE/releases/latest';

export function safeReleaseUrl(value, fallback = releasePage) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      !url.username && !url.password && !url.port &&
      url.pathname.startsWith('/vkctata/wandIDE/releases/') ? url.href : fallback;
  } catch { return fallback; }
}

export function resolveAsset(release, suffix) {
  const fallback = safeReleaseUrl(release?.html_url);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find((item) => suffix && typeof item?.name === 'string' && item.name.endsWith(suffix));
  const href = safeReleaseUrl(asset?.browser_download_url, fallback);
  const available = Boolean(asset && href !== fallback && new URL(href).pathname.startsWith('/vkctata/wandIDE/releases/download/'));
  return { href: available ? href : fallback, available, size: available && Number.isFinite(asset.size) && asset.size > 0 ? `${(asset.size / 1048576).toFixed(1)} MB` : '' };
}
