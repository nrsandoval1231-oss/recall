/* Presentation only. Capture persistence and delivery remain in companion.js. */
(() => {
  "use strict";
  const views = [...document.querySelectorAll("[data-view]")];
  if (!views.length) return;
  const textarea = document.querySelector('textarea[name="note"]');
  const photo = document.querySelector('input[name="photo"]');
  const preview = document.querySelector("#photo-preview");
  let previewUrl;
  const show = () => {
    const hash = location.hash.slice(1);
    const name = ["camera", "write", "ask", "receipts"].includes(hash)
      ? hash
      : "home";
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
    // Navigation never clears the form or steals focus into the phone keyboard.
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
