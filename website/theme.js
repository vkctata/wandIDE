(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem('wand-site-theme'); } catch { /* Storage may be blocked. */ }
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17191e' : '#f7f8fa');
    const button = document.querySelector('#theme-toggle');
    if (button) {
      button.hidden = false;
      button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} appearance`);
    }
  };
  if (!['light', 'dark'].includes(preference)) preference = null;
  apply(preference || (system.matches ? 'dark' : 'light'));
  system.addEventListener('change', () => {
    if (!preference) apply(system.matches ? 'dark' : 'light');
  });
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(preference);
      try { localStorage.setItem('wand-site-theme', preference); } catch { /* Keep the switch usable. */ }
    });
  });
})();
