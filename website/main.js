const form = document.querySelector('#newsletter-form');
const note = document.querySelector('#form-note');
const endpoint = window.WAND_NEWSLETTER_ENDPOINT || '';
const releasePage = 'https://github.com/vkctata/wandIDE/releases/latest';
const releaseApi = 'https://api.github.com/repos/vkctata/wandIDE/releases/latest';

const installerFor = (platform, assets) => {
  const names = assets.map((asset) => ({ name: asset.name.toLowerCase(), url: asset.browser_download_url }));
  const match = platform === 'macos'
    ? names.find((asset) => asset.name.endsWith('.dmg'))
    : platform === 'windows'
      ? names.find((asset) => asset.name.endsWith('.msi')) || names.find((asset) => asset.name.endsWith('.exe'))
      : names.find((asset) => asset.name.endsWith('.appimage')) || names.find((asset) => asset.name.endsWith('.deb'));
  return match?.url || releasePage;
};

fetch(releaseApi, { headers: { Accept: 'application/vnd.github+json' } })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error('release unavailable')))
  .then((release) => {
    document.querySelectorAll('[data-platform]').forEach((card) => {
      const href = installerFor(card.dataset.platform, release.assets || []);
      card.href = href;
      card.removeAttribute('target');
      card.setAttribute('download', '');
      card.dataset.direct = href !== releasePage ? 'true' : 'false';
    });
  })
  .catch(() => {});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = new FormData(form).get('email');
  if (!endpoint) {
    note.textContent = 'Newsletter signup is opening soon — follow Wand on GitHub for release updates.';
    note.dataset.state = 'success';
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, source: 'wand-website' }) });
    if (!response.ok) throw new Error('signup failed');
    form.reset();
    note.textContent = 'You are on the list. Welcome to the crew.';
    note.dataset.state = 'success';
  } catch {
    note.textContent = 'That did not go through. Please try again in a moment.';
    note.dataset.state = 'error';
  } finally { button.disabled = false; }
});
