const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.site-nav');
if (menuButton && navigation) {
  const compact = window.matchMedia('(max-width: 1100px)');
  const header = menuButton.closest('.header-inner');
  const icon = menuButton.querySelector('[aria-hidden]');
  const links = () => [...navigation.querySelectorAll('a[href]')];
  const isOpen = () => menuButton.getAttribute('aria-expanded') === 'true';
  const setOpen = (open, restoreFocus = false) => {
    const expanded = open && compact.matches;
    menuButton.setAttribute('aria-expanded', String(expanded));
    menuButton.setAttribute('aria-label', expanded ? 'Close main navigation' : 'Open main navigation');
    if (icon) icon.textContent = expanded ? '×' : '☰';
    navigation.classList.toggle('is-open', expanded);
    if (restoreFocus) menuButton.focus();
  };
  header?.classList.add('navigation-ready');
  setOpen(false);

  menuButton.addEventListener('click', () => {
    setOpen(!isOpen());
  });
  menuButton.addEventListener('keydown', event => {
    if (!compact.matches || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    setOpen(true);
    const items = links();
    (event.key === 'ArrowUp' ? items.at(-1) : items[0])?.focus();
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  navigation.addEventListener('keydown', event => {
    if (!isOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = links(), index = items.indexOf(document.activeElement);
    if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  const closeOutside = event => {
    if (isOpen() && !navigation.contains(event.target) && !menuButton.contains(event.target)) setOpen(false);
  };
  document.addEventListener('pointerdown', closeOutside);
  document.addEventListener('focusin', closeOutside);
  compact.addEventListener('change', () => {
    const focusWouldBeHidden = compact.matches && navigation.contains(document.activeElement);
    setOpen(false, focusWouldBeHidden);
  });
}
