(() => {
  if (!document.querySelector("link[data-site-shell]")) {
    const s = document.createElement("link");
    s.rel = "stylesheet";
    s.href = "/site-shell.css";
    s.dataset.siteShell = "true";
    document.head.appendChild(s);
  }
  const notice = "Donate by Mail is a U.S. 501(c)(3) public charity",
    root = document.getElementById("root"),
    owned = (e) => Boolean(root && e && root.contains(e)),
    primaryLink = ["Donate a phone", "/donate-phone.html"],
    visibleLinks = [
      ["How it works", "/how-it-works.html"],
      ["For nonprofits", "/for-nonprofits.html"],
      ["Help and FAQs", "/resources.html"],
    ],
    moreLinks = [
      ["Prepare your phone", "/prepare-phone.html"],
      ["Blog", "/articles"],
      ["About", "/about.html"],
    ],
    currentPath = location.pathname.replace(/\/$/, "") || "/",
    active = (h) => h === "/articles" ? currentPath === "/articles" || currentPath === "/articles.html" || currentPath.startsWith("/articles/") : currentPath === h.replace(/\.html$/, "") || currentPath === h,
    brand =
      '<a class="site-brand-logo" href="/" aria-label="Donate by Mail home"><img src="/resources/donate-by-mail-logo.png" alt="Donate by Mail"></a>',
    accountLink = '<a class="account-nav-link" href="/login">Log in</a>',
    social = `<nav class="footer-social-links" aria-label="Donate by Mail social media"><a href="https://x.com/donatebymail" target="_blank" rel="noopener noreferrer" aria-label="Donate by Mail on X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a><a href="https://www.facebook.com/people/Donate-by-Mail/61551982935106/" target="_blank" rel="noopener noreferrer" aria-label="Donate by Mail on Facebook"><svg viewBox="0 0 320 512" aria-hidden="true"><path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06H297V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"/></svg></a><a href="https://bsky.app/profile/donatebymail.bsky.social" target="_blank" rel="noopener noreferrer" aria-label="Donate by Mail on Bluesky"><img class="social-icon-bluesky" src="/resources/bluesky-white-icon.png" alt="" width="512" height="512" aria-hidden="true"></a></nav>`,
    renderLink = ([l, h], primary = false) =>
      `<a ${active(h) ? 'aria-current="page"' : ""} class="${primary ? "nav-primary" : ""}" href="${h}">${l}</a>`,
    moreActive = moreLinks.some(([, h]) => active(h)),
    nav = `${renderLink(primaryLink, true)}${visibleLinks.map((link) => renderLink(link)).join("")}<details class="nav-menu${moreActive ? " nav-active" : ""}"><summary>More</summary><div class="nav-menu-panel">${moreLinks.map((link) => renderLink(link)).join("")}</div></details>`;
  let busy = false;
  let accountResolved = false;
  const normalize = () => {
    if (busy) return;
    busy = true;
    try {
      const main = document.querySelector("main");
      if (!root && main && !main.id) main.id = "content";
      if (!root && main && !document.querySelector("a.skip")) {
        const skip = document.createElement("a");
        skip.className = "skip";
        skip.href = "#content";
        skip.textContent = "Skip to content";
        document.body.prepend(skip);
      }
      const h = document.querySelector("header");
      if (h && !owned(h) && !h.dataset.sharedShell) {
        h.dataset.sharedShell = "true";
        h.className = "site-header";
        h.innerHTML = `<div class="header-inner">${brand}<nav class="desktop-nav" aria-label="Primary navigation">${nav}</nav>${accountLink}<button class="menu-button" type="button" aria-expanded="false" aria-controls="mobile-navigation" aria-label="Open menu">Menu</button></div><nav id="mobile-navigation" class="mobile-nav" aria-label="Mobile navigation" hidden>${nav}${accountLink}</nav>`;
        const b = h.querySelector(".menu-button"),
          m = h.querySelector(".mobile-nav");
        b?.addEventListener("click", () => {
          const o = b.getAttribute("aria-expanded") === "true";
          b.setAttribute("aria-expanded", String(!o));
          b.setAttribute("aria-label", o ? "Open menu" : "Close menu");
          b.textContent = o ? "Menu" : "Close";
          if (m) m.hidden = o;
        });
      }
      const bars = Array.from(
        document.querySelectorAll(".top,.topline,.charity-bar"),
      );
      let primary = bars.find(owned) || bars[0];
      if (!primary && !root) {
        primary = document.createElement("div");
        document.body.prepend(primary);
      }
      if (primary) {
        primary.className = "charity-bar";
        if (primary.textContent !== notice) primary.textContent = notice;
        bars.filter((bar) => bar !== primary).forEach((bar) => bar.remove());
      }
      const f = document.querySelector("footer");
      if (f && !owned(f) && !f.dataset.sharedShell) {
        f.dataset.sharedShell = "true";
        f.className = "site-footer";
        f.innerHTML = `<div class="footer-inner"><div>${brand}<p>Turning unused phones into funding for meaningful causes through a clear mail-in process.</p><p><strong>U.S. 501(c)(3) public charity · EIN 92-1515120</strong><br><a href="mailto:tre@donatebymail.org">tre@donatebymail.org</a></p>${social}</div><div><h2>Get started</h2><a href="/donate-phone.html">Donate a phone</a><a href="/prepare-phone.html">Prepare your phone</a><a href="/phone-drives.html">Host a phone drive</a><a href="/get-involved.html">Get involved</a><a href="/receipts.html">Receipts and documents</a></div><div><h2>Learn</h2><a href="/how-it-works.html">How it works</a><a href="/for-nonprofits.html">For nonprofits</a><a href="/resources.html">Help and FAQs</a><a href="/articles">Blog</a><a href="/transparency.html">Transparency</a></div><div><h2>Organization and policies</h2><a href="/about.html">About us</a><a href="/team.html">Our team</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="/accessibility.html">Accessibility</a></div></div>`;
      }
    } finally {
      busy = false;
    }
  };
  normalize();
  const closeOpenMenus = (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".nav-menu")) return;
    document.querySelectorAll(".nav-menu[open]").forEach((menu) => menu.removeAttribute("open"));
  };
  const closeMenusOnEscape = (event) => {
    if (event.key !== "Escape") return;
    const openMenus = [...document.querySelectorAll(".nav-menu[open]")];
    openMenus.forEach((menu) => menu.removeAttribute("open"));
    if (openMenus.length) openMenus[0].querySelector("summary")?.focus();
  };
  document.addEventListener("pointerdown", closeOpenMenus);
  document.addEventListener("keydown", closeMenusOnEscape);
  fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
    .then((response) => response.json())
    .then((body) => {
      if (accountResolved || !body?.authenticated) return;
      accountResolved = true;
      document.querySelectorAll(".account-nav-link").forEach((link) => { link.textContent = "My Account"; });
    })
    .catch(() => undefined);
  requestAnimationFrame(normalize);
  const observer = new MutationObserver(normalize);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  addEventListener("pagehide", () => {
    observer.disconnect();
    document.removeEventListener("pointerdown", closeOpenMenus);
    document.removeEventListener("keydown", closeMenusOnEscape);
  }, { once: true });
})();
