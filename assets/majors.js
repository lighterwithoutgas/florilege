/* ============================================================
   Florilège — faculty / major themes
   Each major has: a label, an accent colour, and an emblem icon.
   • emblemSVG(key, {size,color}) → an engraved line-icon emblem
   • emblemForMajor(majorKey)     → the emblem key for a major
   • MAJORS / PALETTES            → presets for the create page
   ============================================================ */

export const MAJORS = {
  medicine:     { label: 'Medicine',         accent: '#B23A48', emblem: 'cross' },
  pharmacy:     { label: 'Pharmacy',         accent: '#4F6A4C', emblem: 'mortar' },
  engineering:  { label: 'Engineering',      accent: '#3A6EA5', emblem: 'gear' },
  cs:           { label: 'Computer Science', accent: '#5B6CB8', emblem: 'code' },
  business:     { label: 'Business',         accent: '#1F4E5F', emblem: 'briefcase' },
  law:          { label: 'Law',              accent: '#7A2E3A', emblem: 'scales' },
  arts:         { label: 'Arts & Design',    accent: '#B5478E', emblem: 'palette' },
  science:      { label: 'Science',          accent: '#2E8B8B', emblem: 'atom' },
};

/* curated colour palettes (accent presets) */
export const PALETTES = [
  { label: 'Carnation', color: '#D2588A' },
  { label: 'Wine',      color: '#7A2E3A' },
  { label: 'Sage',      color: '#6E8B6A' },
  { label: 'Ocean',     color: '#1F4E5F' },
  { label: 'Royal',     color: '#3A6EA5' },
  { label: 'Lavender',  color: '#8E7BC4' },
  { label: 'Amber',     color: '#C57B2E' },
  { label: 'Ink',       color: '#3A352C' },
];

const EMBLEMS = {
  cap:       `<path d="M12 4 2 9l10 5 10-5-10-5z"/><path d="M6 11.5V16c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-4.5"/><path d="M22 9v5"/>`,
  cross:     `<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8.5v7M8.5 12h7"/>`,
  mortar:    `<path d="M4.5 11h15"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 11V7"/><path d="M9.5 5.5h5"/><path d="M14.8 5.2 18 3"/>`,
  gear:      `<circle cx="12" cy="12" r="3.2"/><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M5.9 5.9l1.8 1.8M16.3 16.3l1.8 1.8M18.1 5.9l-1.8 1.8M7.7 16.3l-1.8 1.8"/>`,
  code:      `<path d="M9 7.5 4.5 12 9 16.5"/><path d="M15 7.5 19.5 12 15 16.5"/>`,
  briefcase: `<rect x="3.2" y="7.5" width="17.6" height="12" rx="2.2"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M3.2 12.5h17.6"/>`,
  scales:    `<path d="M12 4v15M6.5 19h11"/><path d="M5 7.5h14"/><path d="M5 7.5 2.8 12.5a3 3 0 0 0 6 0z"/><path d="M19 7.5 16.8 12.5a3 3 0 0 0 6 0z"/>`,
  palette:   `<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-1 1.9-1.9 0-1.4 1-1.9 1.9-1.9h1a2.8 2.8 0 0 0 2.8-2.8A8.5 8.5 0 0 0 12 3.5z"/><circle cx="8" cy="10" r=".9"/><circle cx="12" cy="7.6" r=".9"/><circle cx="16" cy="10" r=".9"/>`,
  atom:      `<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>`,
};

export function emblemForMajor(majorKey) {
  return (MAJORS[majorKey] && MAJORS[majorKey].emblem) || 'cap';
}

export function emblemSVG(key, { size = 64, color = 'currentColor' } = {}) {
  const inner = EMBLEMS[key] || EMBLEMS.cap;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}
