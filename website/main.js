const releaseApi = 'https://api.github.com/repos/vkctata/wandIDE/releases/latest';
const releasePage = 'https://github.com/vkctata/wandIDE/releases/latest';

document.querySelectorAll('[data-release-asset]').forEach((link) => {
  link.setAttribute('aria-busy', 'true');
});

fetch(releaseApi, { headers: { Accept: 'application/vnd.github+json' } })
  .then((response) => {
    if (!response.ok) throw new Error('release lookup failed');
    return response.json();
  })
  .then((release) => {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    document.querySelectorAll('[data-release-asset]').forEach((link) => {
      const asset = assets.find((candidate) => candidate.name.endsWith(link.dataset.releaseAsset));
      link.href = asset?.browser_download_url || release.html_url || releasePage;
      link.removeAttribute('aria-busy');
    });
  })
  .catch(() => {
    document.querySelectorAll('[data-release-asset]').forEach((link) => {
      link.href = releasePage;
      link.removeAttribute('aria-busy');
    });
  });

const form = document.querySelector('#newsletter-form');
const note = document.querySelector('#form-note');
const endpoint = window.WAND_NEWSLETTER_ENDPOINT || '';
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
