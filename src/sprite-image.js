'use strict';

// NativeImage decodes PNG/JPEG, but GIF and WebP support varies by platform.
// Use Chromium for those formats so validation matches the pet's actual renderer.
async function decodeSprite(bytes, mime, { nativeImage, BrowserWindow }) {
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return false;
  if (!nativeImage.createFromBuffer(bytes).isEmpty()) return true;
  if (!['image/gif', 'image/webp'].includes(mime)) return false;
  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        await win.loadURL(
          'data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; img-src data:">'
        );
        const url = `data:${mime};base64,${bytes.toString('base64')}`;
        return await win.webContents.executeJavaScript(`new Promise(resolve => {
          const image = new Image();
          image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
          image.onerror = () => resolve(false);
          image.src = ${JSON.stringify(url)};
        })`);
      })(),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), 5000);
      })
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    if (!win.isDestroyed()) win.destroy();
  }
}
module.exports = { decodeSprite };
