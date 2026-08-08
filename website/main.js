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
