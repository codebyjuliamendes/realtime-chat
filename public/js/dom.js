/**
 * Tiny DOM helpers. User-provided text is only ever assigned through
 * `textContent`, never interpolated into HTML, which prevents XSS.
 */

/**
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string>, children?: (Node|null|undefined|false)[] }} [opts]
 */
export function el(tag, { className, text, attrs, children } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (children) for (const child of children) if (child) node.append(child);
  return node;
}

/** Static, trusted SVG icons (replaces the unpinned lucide@latest CDN script). */
const ICON_PATHS = {
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
};

/**
 * @param {keyof typeof ICON_PATHS} name
 * @param {string} [className]
 */
export function icon(name, className = 'w-4 h-4') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

/** Replaces every `<span data-icon="name">` placeholder with its SVG. */
export function hydrateIcons(root = document) {
  for (const slot of root.querySelectorAll('[data-icon]')) {
    const name = /** @type {keyof typeof ICON_PATHS} */ (slot.getAttribute('data-icon'));
    if (ICON_PATHS[name]) slot.replaceWith(icon(name, slot.getAttribute('data-class') ?? undefined));
  }
}

/**
 * Accessible toast notifications (announced via an aria-live region).
 * @param {string} message
 * @param {'success'|'error'} [type]
 */
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = el('div', {
    className: `flex items-center gap-3 p-3 pr-4 text-sm text-white bg-slate-800 rounded-lg shadow-lg border-l-4 animate-fade-in ${
      type === 'success' ? 'border-brand-500' : 'border-red-500'
    }`,
    attrs: { role: type === 'error' ? 'alert' : 'status' },
    children: [
      icon(
        type === 'success' ? 'check' : 'alert',
        `w-5 h-5 shrink-0 ${type === 'success' ? 'text-brand-500' : 'text-red-400'}`,
      ),
      el('span', { text: message }),
    ],
  });
  container.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

/** RFC 4122 v4 id; uses the native implementation when available. */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
