(() => {
  const links = [
    ['Donate a phone', './donate-phone.html'],
    ['How it works', './how-it-works.html'],
    ['Prepare your phone', './prepare-phone.html'],
    ['For nonprofits', './for-nonprofits.html'],
    ['Help and FAQs', './resources.html'],
    ['About', './about.html'],
  ];

  const current = window.location.pathname.split('/').pop() || 'index.html';
  const active = (href) => {
    const target = href.replace('./', '');
    return (current === '' || current === 'index.html') ? target === '' : current === target;
  };

  const brand = `
    <a class="brand" href="./">
      <span class="brand-icon" aria-hidden="true">✉</span>
      <span><strong>Donate by Mail</strong><small>Old phones. New possibilities.</small></span>
    </a>`;

  const navLinks = links.map(([label, href], index) =>
    `<a ${active(href) ? 'aria-current="page"' : ''} class="${index === 0 ? 'nav-primary' : ''}" href="${href}">${label}</a>`
  ).join('');

  const header = document.querySelector('header');
  if (header) {
    header.className = 'site-header';
    header.innerHTML = `<div class="header-inner">${brand}<nav class="desktop-nav" aria-label="Primary navigation">${navLinks}</nav><button class="menu-button" type="button" aria-expanded="false" aria-label="Open menu">Menu</button></div><nav class="mobile-nav" aria-label="Mobile navigation" hidden>${navLinks}</nav>`;
    const button = header.querySelector('.menu-button');
    const mobile = header.querySelector('.mobile-nav');
    button?.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      button.textContent = open ? 'Menu' : 'Close';
      if (mobile) mobile.hidden = open;
    });
  }

  const oldBar = document.querySelector('.top, .topline, .charity-bar');
  const charityBar = document.createElement('div');
  charityBar.className = 'charity-bar';
  charityBar.textContent = 'Donate by Mail is a U.S. 501(c)(3) public charity · EIN 92-1515120';
  if (oldBar) oldBar.replaceWith(charityBar);
  else document.body.prepend(charityBar);

  const footer = document.querySelector('footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="footer-inner"><div>${brand}<p>Turning unused phones into funding for meaningful causes through a clear mail-in process.</p><p><strong>U.S. 501(c)(3) public charity · EIN 92-1515120</strong><br><a href="mailto:satoshi@donatebymail.org">satoshi@donatebymail.org</a></p></div><div><h2>Get started</h2><a href="./donate-phone.html">Donate a phone</a><a href="./prepare-phone.html">Prepare your phone</a><a href="./receipts.html">Receipts and documents</a></div><div><h2>Learn</h2><a href="./how-it-works.html">How it works</a><a href="./for-nonprofits.html">For nonprofits</a><a href="./resources.html">Help and FAQs</a><a href="./transparency.html">Transparency</a></div><div><h2>Organization and policies</h2><a href="./about.html">About us</a><a href="./contact.html">Contact</a><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a><a href="./accessibility.html">Accessibility</a></div></div>`;
  }
})();
