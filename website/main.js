const releaseApi = 'https://api.github.com/repos/vkctata/wandIDE/releases/latest';
const releasePage = 'https://github.com/vkctata/wandIDE/releases/latest';

const safeGithubUrl = (value, fallback = releasePage) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : fallback;
  } catch {
    return fallback;
  }
};

const releaseLinks = document.querySelectorAll('[data-release-asset]');
releaseLinks.forEach((link) => link.setAttribute('aria-busy', 'true'));

fetch(releaseApi, {
  headers: { Accept: 'application/vnd.github+json' },
  mode: 'cors',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
})
  .then((response) => {
    if (!response.ok) throw new Error('release lookup failed');
    return response.json();
  })
  .then((release) => {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const fallback = safeGithubUrl(release?.html_url);
    releaseLinks.forEach((link) => {
      const suffix = link.dataset.releaseAsset;
      const asset = assets.find((candidate) => typeof candidate?.name === 'string' && candidate.name.endsWith(suffix));
      link.href = safeGithubUrl(asset?.browser_download_url, fallback);
      link.removeAttribute('aria-busy');
    });
  })
  .catch(() => {
    releaseLinks.forEach((link) => {
      link.href = releasePage;
      link.removeAttribute('aria-busy');
    });
  });

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
    note.dataset.state = 'success';
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
