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
};

function icon(name) {
  const body = PATHS[name] || PATHS.info;
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

module.exports = { icon };
