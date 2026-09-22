import leoLogo from '@/assets/leo-madeiras-logo.png?inline';

// One original image for interface, PDF, HTML and Excel. Inlining keeps the small
// company asset available after deployments and while the installed PWA is offline.
export const LEO_LOGO_URL = leoLogo;
export const LEO_COMPANY_NAME = 'Leo Madeiras';
export const LEO_LOGO_ASPECT_RATIO = 690 / 685;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Inspect bytes, not the old filename/MIME (the former .jpg is actually PNG). */
export function normalizeReportImage(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:image\/(?:png|jpe?g);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  const base64 = match[1].replace(/\s/g, '');
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
  try {
    const bytes = atob(base64);
    let extension;
    if (bytes.startsWith('\x89PNG\r\n\x1a\n') && bytes.length >= 45
      && bytes.slice(12, 16) === 'IHDR' && bytes.slice(-8) === 'IEND\xaeB`\x82') {
      extension = 'png';
    } else if (bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9')) {
      extension = 'jpeg';
    } else return null;
    return { dataUrl: `data:image/${extension};base64,${base64}`, extension, pdfFormat: extension === 'png' ? 'PNG' : 'JPEG' };
  } catch { return null; }
}

let cachedLogo = null;
let pendingLogo = null;
export async function loadCompanyLogoDataUrl() {
  if (cachedLogo) return cachedLogo;
  const embedded = normalizeReportImage(LEO_LOGO_URL);
  if (embedded) { cachedLogo = embedded.dataUrl; return cachedLogo; }
  // Vite's development/SSR asset URL still needs a fetch. A failure is not cached.
  if (!pendingLogo) {
    pendingLogo = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(LEO_LOGO_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('Logo excede o tamanho permitido');
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        const image = normalizeReportImage(`data:image/png;base64,${btoa(binary)}`);
        if (!image) throw new Error('Arquivo de logo inválido');
        cachedLogo = image.dataUrl;
        return cachedLogo;
      } catch (error) {
        console.warn('[branding] Logomarca indisponível; os dados do relatório serão preservados.', error?.message);
        return null;
      } finally { clearTimeout(timeout); }
    })().finally(() => { pendingLogo = null; });
  }
  return pendingLogo;
}
