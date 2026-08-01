// React Native has no DOM, so we strip HTML with regex instead of DOMPurify.
// Deliberately excludes the single quote: it's the only one of these
// characters that shows up in otherwise-legitimate input (names like
// "O'Brien"/"D'Angelo", contractions in bio text, addresses like "O'Malley
// Ave") — stripping it would corrupt real data for no injection-safety
// benefit once <, >, ", and ` are already gone.
const DANGEROUS_CHARS = /[<>"`]/g;
const HTML_TAG = /<[^>]*>/g;
const SAFE_RICH_TAGS = /(<\/?(p|br|strong|em|ul|ol|li)\b[^>]*>)/gi;

export const sanitize = {
  // For all plain text: names, emails, messages, comments
  text: (input: string): string => {
    if (!input) return '';
    return input.replace(HTML_TAG, '').replace(DANGEROUS_CHARS, '').trim();
  },

  // For doctor bios and consultation notes that may contain basic formatting
  richText: (input: string): string => {
    if (!input) return '';
    // Collect allowed tags, strip everything else, then re-insert them
    const allowed: string[] = [];
    let i = 0;
    const withPlaceholders = input.replace(SAFE_RICH_TAGS, (match) => {
      allowed.push(match);
      return `\x00${i++}\x00`;
    });
    const stripped = withPlaceholders
      .replace(HTML_TAG, '')
      .replace(DANGEROUS_CHARS, '');
    return stripped
      .replace(/\x00(\d+)\x00/g, (_, idx) => allowed[Number(idx)] ?? '')
      .trim();
  },
};
