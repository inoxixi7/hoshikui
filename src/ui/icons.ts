// Inline SVG icons. No glyphs, no text — strokes only, colored by currentColor.

const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  undo: svg('<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>'),
  reset: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v4.6h-4.6"/>'),
  menu: svg('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
  soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 12h4" opacity=".55"/>'),
  chapters: svg(
    '<path d="M3.5 17.5C6 9.5 18 9.5 20.5 17.5" opacity=".45"/><circle cx="3.8" cy="17" r="1.4" fill="currentColor"/><circle cx="7.6" cy="12.1" r="1.4" fill="currentColor"/><circle cx="12" cy="10.4" r="1.4" fill="currentColor"/><circle cx="16.4" cy="12.1" r="1.4"/><circle cx="20.2" cy="17" r="1.4"/>',
  ),
  home: svg('<path d="M12 3.5 17 7v6l-5 3.5L7 13V7z"/><path d="M12 3.5V10l5-3M12 10 7 7"/><path d="M4 20.5h16" opacity=".6"/>'),
  back: svg('<path d="M14.5 6 8.5 12l6 6"/>'),
  clear: svg(
    '<path d="M12 4.5 13.6 10l5.4 2-5.4 2L12 19.5 10.4 14 5 12l5.4-2z" opacity=".9"/><circle cx="19" cy="5" r=".9" fill="currentColor"/><circle cx="20.5" cy="8.5" r=".6" fill="currentColor"/><circle cx="16.5" cy="3" r=".6" fill="currentColor"/>',
  ),
  replay: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v4.6h-4.6"/><path d="M12 9.2l.9 2 2 .8-2 .8-.9 2-.9-2-2-.8 2-.8z" fill="currentColor" stroke="none"/>'),
  hand: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M26 34V13a4 4 0 0 1 8 0v15l1-.2a4 4 0 0 1 7.6 1.2l.4-.1a4 4 0 0 1 7 2.4l.3-.1A4 4 0 0 1 55 35v9c0 9-6 15-15 15h-3c-5 0-8.5-2-11.5-6L14 39a4 4 0 0 1 6-5.3z" fill="rgba(240,238,255,.86)" stroke="rgba(20,18,40,.55)" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
};
