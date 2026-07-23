(() => {
  if (!document.querySelector('link[data-site-shell]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './site-shell.css';
    stylesheet.dataset.siteShell = 'true';
    document.head.appendChild(stylesheet);
  }

  const charityNotice = 'Donate by Mail is a U.S. 501(c)(3) public charity';
  const reactRoot = document.getElementById('root');
  const isReactOwned = (element) => Boolean(reactRoot && element && reactRoot.contains(element));

  const links = [
    ['Donate a phone', './donate-phone.html'],
    ['How it works', './how-it-works.html'],
    ['Prepare your phone', './prepare-phone.html'],
    ['For nonprofits', './for-nonprofits.html'],
    ['Help and FAQs', './resources.html'],
    ['About', './about.html'],
  ];

  const current = window.location.pathname.split('/').pop() || 'index.html';
  const active = (href) => current === href.replace('./', '');

  const brand = `
    <a class="brand" href="./">
      <span class="brand-icon" aria-hidden="true">✉</span>
      <span><strong>Donate by Mail</strong><small>Old phones. New possibilities.</small></span>
    </a>`;

  const navLinks = links.map(([label, href], index) =>
    `<a ${active(href) ? 'aria-current="page"' : ''} class="${index === 0 ? 'nav-primary' : ''}" href="${href}">${label}</a>`
  ).join('');

  let normalizing = false;

  const normalize = () => {
    if (normalizing) return;
    normalizing = true;

    try {
      const header = document.querySelector('header');
      if (header && !isReactOwned(header) && !header.dataset.sharedShell) {
        header.dataset.sharedShell = 'true';
        header.className = 'site-header';
        header.innerHTML = `<div class="header-inner">${brand}<nav class="desktop-nav" aria-label="Primary navigation">${navLinks}</nav><button class="menu-button" type="button" aria-expanded="false" aria-label="Open menu">Menu</button></div><nav class="mobile-nav" aria-label="Mobile navigation" hidden>${navLinks}</nav>`;
        const button = header.querySelector('.menu-button');
        const mobile = header.querySelector('.mobile-nav');
        button?.addEventListener('click', () => {
          const open = button.getAttribute('aria-expanded') === 'true';
          button.setAttribute('aria-expanded', String(!open));
          button.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
          button.textContent = open ? 'Menu' : 'Close';
          if (mobile) mobile.hidden = open;
        });
      }

      const bars = Array.from(document.querySelectorAll('.top, .topline, .charity-bar'));
      let primaryBar = bars.find((bar) => isReactOwned(bar)) || bars[0];

      // React entry pages render their own notice. Do not create a competing one
      // before the app has mounted. Static pages receive one shared notice here.
      if (!primaryBar && !reactRoot) {
        primaryBar = document.createElement('div');
        document.body.prepend(primaryBar);
      }

      if (primaryBar) {
        primaryBar.className = 'charity-bar';
        if (primaryBar.textContent !== charityNotice) primaryBar.textContent = charityNotice;
        bars.filter((bar) => bar !== primaryBar).forEach((bar) => bar.remove());
      }

      const footer = document.querySelector('footer');
      if (footer && !isReactOwned(footer) && !footer.dataset.sharedShell) {
        footer.dataset.sharedShell = 'true';
        footer.className = 'site-footer';
        footer.innerHTML = `<div class="footer-inner"><div>${brand}<p>Turning unused phones into funding for meaningful causes through a clear mail-in process.</p><p><strong>U.S. 501(c)(3) public charity · EIN 92-1515120</strong><br><a href="mailto:satoshi@donatebymail.org">satoshi@donatebymail.org</a></p></div><div><h2>Get started</h2><a href="./donate-phone.html">Donate a phone</a><a href="./prepare-phone.html">Prepare your phone</a><a href="./receipts.html">Receipts and documents</a></div><div><h2>Learn</h2><a href="./how-it-works.html">How it works</a><a href="./for-nonprofits.html">For nonprofits</a><a href="./resources.html">Help and FAQs</a><a href="./transparency.html">Transparency</a></div><div><h2>Organization and policies</h2><a href="./about.html">About us</a><a href="./contact.html">Contact</a><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a><a href="./accessibility.html">Accessibility</a></div></div>`;
      }
    } finally {
      normalizing = false;
    }
  };

  normalize();
  requestAnimationFrame(normalize);

  const observer = new MutationObserver(normalize);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();