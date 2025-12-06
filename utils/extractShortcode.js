export function extractShortcodeFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    // The last pathname segment is generally the shortcode
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;

    // Common paths: reel/<shortcode>, p/<shortcode>, tv/<shortcode>
    const last = parts[parts.length - 1];
    // Also sometimes it might be a combination like 'reel' as last when URL ends with slash
    // So prefer the segment after 'reel' or 'p'
    const reelIdx = parts.findIndex(p => ['reel', 'p', 'tv'].includes(p));
    if (reelIdx !== -1 && parts[reelIdx + 1]) {
      const code = parts[reelIdx + 1];
      console.log('🧭 extractShortcode: found using path segment', { url, code });
      return code;
    }
    console.log('🧭 extractShortcode: using last path segment', { url, last });
    return last;
  } catch (e) {
    // The input might be just the shortcode itself
    // Validate simple pattern: alphanumeric, - and _
    if (/^[A-Za-z0-9_\-]+$/.test(url.trim())) {
      console.log('🧭 extractShortcode: input looks like shortcode, returning', { shortcode: url.trim() });
      return url.trim();
    }
    return null;
  }
}
