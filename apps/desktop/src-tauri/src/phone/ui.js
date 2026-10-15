/* Presentation only. Capture persistence and delivery remain in companion.js. */
(() => {
  "use strict";
  const views = [...document.querySelectorAll("[data-view]")];
  if (!views.length) return;
  const textarea = document.querySelector('textarea[name="note"]');
  const photo = document.querySelector('input[name="photo"]');
  const preview = document.querySelector("#photo-preview");
  let previewUrl;
  const navigation = document.querySelector('.phone-nav');
  const measureNavigation = () => {
    if (navigation && !document.body.classList.contains('keyboard-open')) {
      document.body.style.setProperty('--nav-height', `${navigation.getBoundingClientRect().height + 8}px`);
    }
  };
  if (navigation) new ResizeObserver(measureNavigation).observe(navigation);
  measureNavigation();
  // Only tuck navigation away when a text field has reduced the visual viewport.
  // Focus alone (hardware keyboard/desktop) does not hide navigation.
  const keyboardLayout = () => {
    const editing = document.activeElement?.matches('textarea, input:not([type="checkbox"]):not([type="file"])');
    const reduced = window.visualViewport && window.visualViewport.height < document.documentElement.clientHeight - 120;
    document.body.classList.toggle('keyboard-open', Boolean(editing && reduced));
  };
  window.visualViewport?.addEventListener('resize', keyboardLayout);
  document.addEventListener('focusin', keyboardLayout);
  document.addEventListener('focusout', () => requestAnimationFrame(keyboardLayout));
  const show = (event) => {
    const hash = location.hash.slice(1);
    const name = ["camera", "write", "ask", "receipts"].includes(hash)
      ? hash
      : "home";
    document.body.dataset.view = name;
    const view = name === "camera" || name === "write" ? "capture" : name;
    views.forEach((el) => {
      el.hidden = el.dataset.view !== view;
    });
    document.querySelectorAll(".phone-nav a").forEach((el) => {
      const selected =
        el.hash === `#${name}` || (view === "capture" && el.hash === "#write");
      if (selected) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    document.querySelector("#capture-heading").textContent =
      name === "camera" ? "Capture a moment" : "Write a memory";
    // Hash navigation includes save completion and browser back/forward.
    // Focus a reading landmark, never an input that opens the phone keyboard.
    if (event) {
      const heading = views.find((el) => !el.hidden)?.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.addEventListener(
          "blur",
          () => heading.removeAttribute("tabindex"),
          { once: true },
        );
        heading.focus({ preventScroll: true });
      }
    }
    window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", show);
  show();
  document.querySelector("#speak").addEventListener("click", () => {
    document.querySelector("#speak-status").textContent =
      "Voice capture is unavailable in this build. Use Camera or Write.";
  });
  photo.addEventListener("change", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.replaceChildren();
    preview.hidden = true;
    const file = photo.files[0];
    if (file && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      previewUrl = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.src = previewUrl;
      img.alt = "Selected original photo";
      preview.append(img);
      preview.hidden = false;
    }
  });
  document
    .querySelector('form[action="/capture"]')
    .addEventListener("reset", () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      preview.replaceChildren();
      preview.hidden = true;
    });
  // Do not persist an unsaved draft separately from the existing durable outbox.
  // Keep it in the live form across navigation, and warn before a page is closed.
  window.addEventListener("beforeunload", (event) => {
    if (textarea.value.trim() || photo.files.length) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
})();
