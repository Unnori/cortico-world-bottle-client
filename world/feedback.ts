import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';

export const FEEDBACK_FORM_URL = 'https://docs.qq.com/form/page/DZm5DZ3d4V2JiUmt2';
// Read this extension's installed manifest, independently of the host/data directory.
export const WORLD_VERSION: string = (() => {
  try {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version) ? version : '';
  } catch { return ''; }
})();

let qr: Promise<Buffer> | undefined;
export function feedbackQr(): Promise<Buffer> {
  return qr ??= QRCode.toBuffer(FEEDBACK_FORM_URL, {
    type: 'png', width: 240, margin: 4, errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  }).catch(error => { qr = undefined; throw error; });
}
