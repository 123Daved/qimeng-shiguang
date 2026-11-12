"use strict";

const PATHS = {
  chat: '<path d="M5 16.5V7.8A2.8 2.8 0 0 1 7.8 5h8.4A2.8 2.8 0 0 1 19 7.8v5.4a2.8 2.8 0 0 1-2.8 2.8H9l-4 3.2z"/>',
  copy: '<rect x="8" y="8" width="10" height="11" rx="1.5"/><path d="M6 16V6.5A1.5 1.5 0 0 1 7.5 5H15"/>',
  user: '<circle cx="12" cy="9" r="3"/><path d="M6.5 19.2a5.5 5.5 0 0 1 11 0"/>',
  palette: '<circle cx="12" cy="12" r="7"/><circle cx="9" cy="10" r=".8" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8.5" r=".8" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r=".8" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M12.5 7.5l4 4"/>',
  link: '<path d="M10 13.5l-1.2 1.2a3 3 0 0 1-4.3-4.2L6.8 8a3 3 0 0 1 4.2 0"/><path d="M14 10.5l1.2-1.2a3 3 0 0 1 4.3 4.2L17.2 16a3 3 0 0 1-4.2 0"/>',
  search: '<circle cx="11" cy="11" r="5.5"/><path d="M15.5 15.5L20 20"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  spark: '<path d="M12 3.5l1.2 5.3L18.5 10 13.2 11.2 12 16.5 10.8 11.2 5.5 10l5.3-1.2z"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  home: '<path d="M4 11.5L12 5l8 6.5"/><path d="M7 10.8V19h10v-8.2"/>',
  send: '<path d="M4.5 12L19 5.5 14.5 19l-2.2-6.3z"/><path d="M12.3 12.7L19 5.5"/>',
  upload: '<path d="M12 16V8"/><path d="M8.5 11.5L12 8l3.5 3.5"/><path d="M5 18h14"/>',
  download: '<path d="M12 8v8"/><path d="M8.5 12.5L12 16l3.5-3.5"/><path d="M5 19h14"/>',
  phone: '<path d="M8 4.5h2.2l1 3.2-1.6 1a10 10 0 0 0 5.7 5.7l1-1.6 3.2 1V16a2 2 0 0 1-2.2 2 15 15 0 0 1-13-13A2 2 0 0 1 8 4.5z"/>',
  mail: '<rect x="4" y="6.5" width="16" height="11" rx="2"/><path d="M5 8l7 5 7-5"/>',
  map: '<path d="M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z"/><circle cx="12" cy="10" r="2"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.4 2.6 3.6 5.4 3.6 8S14.4 17.4 12 20c-2.4-2.6-3.6-5.4-3.6-8S9.6 6.6 12 4z"/>',
  file: '<path d="M7 4.5h7l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5z"/><path d="M14 4.5V10h5.5"/>',
  share: '<circle cx="18" cy="6" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M8 11.2l8-4.4M8 12.8l8 4.4"/>',
  warning: '<path d="M12 4.5L21 19H3z"/><path d="M12 10v4.5"/><path d="M12 17h.01"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  plus: '<path d="M12 6v12"/><path d="M6 12h12"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
  list: '<path d="M9 7h11"/><path d="M9 12h11"/><path d="M9 17h11"/><path d="M5 7h.01"/><path d="M5 12h.01"/><path d="M5 17h.01"/>',
  qr: '<path d="M5 5h5v5H5z"/><path d="M14 5h5v5h-5z"/><path d="M5 14h5v5H5z"/><path d="M14 14h2v2h-2z"/><path d="M18 14h1v1"/><path d="M14 18h1v1"/><path d="M18 18h1v1"/>',
  wand: '<path d="M5 19l8.5-8.5"/><path d="M15.5 4.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/><path d="M19.5 11.5l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"/>',
  book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 5.5V21"/><path d="M9 7h6"/>',
  image: '<rect x="4" y="5.5" width="16" height="13" rx="2"/><circle cx="9" cy="10" r="1.3"/><path d="M5.5 16.5l4-3.5 3 2.5 2.2-1.8 4.3 2.8"/>',
  offer: '<path d="M8 7h11v10H8l-3-5z"/><path d="M11 11h.01"/>',
  work: '<rect x="4" y="8" width="16" height="11" rx="1.5"/><path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8"/>',
  story: '<path d="M5 6h10a3 3 0 0 1 3 3v11H8a3 3 0 0 0-3 3z"/><path d="M8 6v14"/><path d="M11 10h5"/><path d="M11 14h4"/>',
  seek: '<circle cx="10" cy="10" r="5.5"/><path d="M14.5 14.5L20 20"/><path d="M10 8v4l2.5 1.5"/>',
  style: '<path d="M5 19l7-14 7 14"/><path d="M8.2 13h7.6"/>',
  pages: '<rect x="5" y="5" width="9" height="12" rx="1.2"/><path d="M10 21h7.5A1.5 1.5 0 0 0 19 19.5V8"/>',
};

function icon(name) {
  const body = PATHS[name] || PATHS.info;
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

const QDIcons = { icon, PATHS };
if (typeof module !== "undefined" && module.exports) {
  module.exports = QDIcons;
} else if (typeof window !== "undefined") {
  window.QDIcons = QDIcons;
}
