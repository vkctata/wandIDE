// Enhance the readable, no-JavaScript gallery into a keyboard-accessible tour.
export function enhanceTour(gallery, document) {
  if (!gallery) return;
  const panels = [...gallery.querySelectorAll('figure')];
  if (!panels.length) return;
  const tabs = document.createElement('div');
  tabs.className = 'tour-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Explore Wand features');
  const buttons = panels.map((panel, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `tour-tab-${index}`;
    button.textContent = panel.querySelector('figcaption b').textContent;
    button.setAttribute('role', 'tab');
    panel.id = `tour-panel-${index}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    button.setAttribute('aria-controls', panel.id);
    tabs.append(button);
    return button;
  });
  function select(index, focus = false) {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) buttons[index].focus();
  }
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      const next = { ArrowRight: (index + 1) % buttons.length, ArrowLeft: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 };
      if (!Object.hasOwn(next, event.key)) return;
      event.preventDefault();
      select(next[event.key], true);
    });
  });
  gallery.before(tabs);
  gallery.classList.add('gallery-enhanced');
  select(0);
}

if (typeof document !== 'undefined') enhanceTour(document.querySelector('#app-tour'), document);
