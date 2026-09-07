import { releasePage, resolveAsset } from './releases.js';
const releaseLinks = document.querySelectorAll('[data-release-asset]');
const releaseStatus = document.querySelector('#release-status');
releaseStatus.textContent = 'Checking the latest release…';
releaseLinks.forEach((link) => link.setAttribute('aria-busy', 'true'));

fetch('https://api.github.com/repos/vkctata/wandIDE/releases/latest', {
  headers: { Accept: 'application/vnd.github+json' },
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  signal: AbortSignal.timeout(10000),
})
  .then((response) => {
    if (!response.ok) throw new Error('Release lookup unavailable');
    return response.json();
  })
  .then((release) => {
    if (!release?.tag_name || !Array.isArray(release.assets)) throw new Error('Invalid release');
    releaseStatus.textContent = `Latest published release: ${release.tag_name}`;
    releaseLinks.forEach((link) => {
      const asset = resolveAsset(release, link.dataset.releaseAsset);
      link.href = asset.href;
      // Download in this tab; fallback release notes remain a normal link.
      if (asset.available) link.removeAttribute('target');
      const note = document.createElement('span');
      note.className = 'asset-note';
      note.textContent = asset.available ? `Download installer${asset.size ? ' · ' + asset.size : ''}` : 'Installer unavailable · view release';
      link.append(note);
    });
  })
  .catch(() => {
    releaseStatus.textContent = 'Could not check the latest release. Installer links will open GitHub Releases.';
    releaseLinks.forEach((link) => { link.href = releasePage; });
  })
  .finally(() => releaseLinks.forEach((link) => link.removeAttribute('aria-busy')));

const form = document.querySelector('#newsletter-form');
const note = document.querySelector('#form-note');

const newsletterEndpoint = () => {
  try {
    const endpoint = new URL(window.WAND_NEWSLETTER_ENDPOINT || '');
    return endpoint.protocol === 'https:' ? endpoint.href : '';
  } catch {
    return '';
  }
};

if (form && newsletterEndpoint()) {
  form.hidden = false;
  note.textContent = 'Subscribe for release updates. Your email is sent to our mailing service only when you submit.';
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = String(new FormData(form).get('email') || '').trim();
  if (!form.checkValidity() || email.length > 254) {
    form.reportValidity();
    return;
  }

  const endpoint = newsletterEndpoint();
  if (!endpoint) {
    note.textContent = 'Newsletter signup is opening soon — follow Wand on GitHub for release updates.';
    note.dataset.state = 'unavailable';
    return;
  }

  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'wand-website' }),
    });
    if (!response.ok) throw new Error('signup failed');
    form.reset();
    note.textContent = 'You are on the list. Welcome to the crew.';
    note.dataset.state = 'success';
  } catch {
    note.textContent = 'That did not go through. Please try again in a moment.';
    note.dataset.state = 'error';
  } finally {
    button.disabled = false;
  }
});
