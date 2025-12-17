export function extractShortcodeFromUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const last = parts[parts.length - 1];
    const reelIdx = parts.findIndex(p => ['reel', 'p', 'tv'].includes(p));
    if (reelIdx !== -1 && parts[reelIdx + 1]) {
      const code = parts[reelIdx + 1];
      // eslint-disable-next-line no-console
      console.log('🧭 extractShortcode: found using path segment', { url, code });
      return code;
    }
    // eslint-disable-next-line no-console
    console.log('🧭 extractShortcode: using last path segment', { url, last });
    return last;
  } catch (e) {
    if (/^[A-Za-z0-9_\-]+$/.test(url.trim())) {
      // eslint-disable-next-line no-console
      console.log('🧭 extractShortcode: input looks like shortcode, returning', { shortcode: url.trim() });
      return url.trim();
    }
    return null;
  }
}
