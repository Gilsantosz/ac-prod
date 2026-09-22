import bundledLogo from '@/assets/leo-madeiras-logo.jpg?inline';

// The existing file has a legacy .jpg name but verified PNG bytes (690 x 685).
// Embed the original artwork so UI/reports never depend on a separate image URL.
// Normalize MIME without changing a single byte of the company artwork.
export const LEO_LOGO_DATA_URL = bundledLogo.replace(/^data:image\/jpe?g;/i, 'data:image/png;');
export const LEO_LOGO_WIDTH = 690;
export const LEO_LOGO_HEIGHT = 685;

/** Only raster data URLs. Detect format by bytes, not the legacy MIME/file name. */
export function getReportImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 12 * 1024 * 1024) return null;
  const match = /^data:image\/(?:png|jpe?g);base64,([a-z\d+/=\s]+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const encoded = match[1].replace(/\s/g, '');
    const bytes = atob(encoded);
    const png = bytes.startsWith('\x89PNG\r\n\x1a\n')
      && bytes.length >= 45 && bytes.slice(-8, -4) === 'IEND';
    const jpeg = bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9');
    if (!png && !jpeg) return null;
    const extension = png ? 'png' : 'jpeg';
    return { dataUrl: `data:image/${extension};base64,${encoded}`, extension,
      format: png ? 'PNG' : 'JPEG' };
  } catch { return null; }
}
