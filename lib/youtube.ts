/** Accepts a full YouTube URL or an 11-character video id and returns the id. */
export function parseYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  const match = value.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (match) return match[1];
  const alt = value.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  return alt ? alt[1] : null;
}
