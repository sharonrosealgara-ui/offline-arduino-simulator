/**
 * Offline silkscreen text for the 3D workspace.
 *
 * WHY CANVAS TEXTURES AND NOT 3D TEXT
 * Legible pin legends are a hard requirement, but troika/Text3D-style geometry text costs
 * hundreds of triangles per glyph and needs a font file. Both are unacceptable here: the
 * app must run on low-spec classroom hardware, and it must not load font assets (no CDN,
 * and we do not want binary assets to license). A <canvas> 2D context renders crisp text
 * using fonts the OS already has, and one strip texture carries a whole header's legend on
 * a single two-triangle plane. That is the cheapest legible option available offline.
 *
 * DISPOSAL
 * Every texture here is created by an explicit factory and owned by the caller. Callers
 * MUST dispose them (see `useDisposableTexture` in ./useDisposableTexture.ts); nothing in
 * this module caches globally, so a disposed texture is genuinely released.
 */
import * as THREE from 'three';

/** Fonts the OS is guaranteed to have. Never a webfont — nothing is fetched. */
const SILKSCREEN_FONT_STACK = "'Segoe UI Semibold', 'Helvetica Neue', Arial, sans-serif";

/** Device pixels per world inch. 256 keeps 6 pt silkscreen readable when zoomed in. */
const PIXELS_PER_INCH = 256;

export interface LabelStripOptions {
  /** Strip width in world units (inches). */
  widthInches: number;
  /** Strip height in world units (inches). */
  heightInches: number;
  /** Text colour. */
  color?: string;
  /** Optional background; omit for a transparent overlay onto the PCB. */
  background?: string;
  /** Font size in points relative to the strip height (0..1). */
  fontScale?: number;
  /** 'horizontal' lays labels left→right; 'vertical' rotates each label 90°. */
  orientation?: 'horizontal' | 'vertical';
  /** Right-align the first label instead of centring each cell. */
  align?: 'center' | 'left' | 'right';
}

function createCanvas(widthPx: number, heightPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(widthPx));
  canvas.height = Math.max(1, Math.round(heightPx));
  return canvas;
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Silkscreen is viewed at a grazing angle when the camera orbits low; anisotropy keeps
  // it from smearing. 4 is plenty and is supported everywhere WebGL2 is.
  texture.anisotropy = 4;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Renders `labels` evenly spaced across one strip, one cell per label.
 *
 * Used for pin headers: the cell pitch matches the 0.1" header pitch, so each legend sits
 * exactly under its pin without needing a mesh (or a draw call) per pin.
 */
export function createLabelStripTexture(labels: string[], options: LabelStripOptions): THREE.CanvasTexture {
  const {
    widthInches,
    heightInches,
    color = '#f2f4f7',
    background,
    fontScale = 0.62,
    orientation = 'horizontal',
    align = 'center',
  } = options;

  const canvas = createCanvas(widthInches * PIXELS_PER_INCH, heightInches * PIXELS_PER_INCH);
  const ctx = canvas.getContext('2d');
  if (!ctx) return finishTexture(canvas);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const cells = Math.max(1, labels.length);
  const cellWidth = canvas.width / cells;
  const fontPx = Math.max(8, Math.round((orientation === 'vertical' ? cellWidth : canvas.height) * fontScale));

  ctx.fillStyle = color;
  ctx.font = `${fontPx}px ${SILKSCREEN_FONT_STACK}`;
  ctx.textBaseline = 'middle';

  labels.forEach((label, index) => {
    if (!label) return;
    const cx = index * cellWidth + cellWidth / 2;
    const cy = canvas.height / 2;

    if (orientation === 'vertical') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
      return;
    }

    ctx.textAlign = align === 'center' ? 'center' : align;
    const x = align === 'center' ? cx : align === 'left' ? index * cellWidth : (index + 1) * cellWidth;
    // Squeeze over-long legends into their cell rather than letting them collide.
    const maxWidth = cellWidth * 0.94;
    ctx.fillText(label, x, cy, maxWidth);
  });

  return finishTexture(canvas);
}

export interface TextPlateOptions {
  widthInches: number;
  heightInches: number;
  color?: string;
  background?: string;
  /** Font size as a fraction of plate height. */
  fontScale?: number;
  bold?: boolean;
  letterSpacing?: number;
}

/** Renders a single centred string — board wordmarks, component values, connector legends. */
export function createTextPlateTexture(text: string, options: TextPlateOptions): THREE.CanvasTexture {
  const {
    widthInches,
    heightInches,
    color = '#f2f4f7',
    background,
    fontScale = 0.7,
    bold = true,
  } = options;

  const canvas = createCanvas(widthInches * PIXELS_PER_INCH, heightInches * PIXELS_PER_INCH);
  const ctx = canvas.getContext('2d');
  if (!ctx) return finishTexture(canvas);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const fontPx = Math.max(8, Math.round(canvas.height * fontScale));
  ctx.fillStyle = color;
  ctx.font = `${bold ? '600 ' : ''}${fontPx}px ${SILKSCREEN_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width * 0.94);

  return finishTexture(canvas);
}

/**
 * Renders the 16x2 character LCD viewport: a bezelled panel with two rows of monospace
 * text on the characteristic yellow-green backlight.
 */
export function createLcdScreenTexture(rows: readonly string[], backlit: boolean): THREE.CanvasTexture {
  const canvas = createCanvas(2.6 * PIXELS_PER_INCH, 0.9 * PIXELS_PER_INCH);
  const ctx = canvas.getContext('2d');
  if (!ctx) return finishTexture(canvas);

  ctx.fillStyle = backlit ? '#7fa63a' : '#41501f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const fontPx = Math.round(canvas.height * 0.3);
  ctx.font = `${fontPx}px 'Cascadia Mono', Consolas, 'Courier New', monospace`;
  ctx.fillStyle = backlit ? '#12180a' : '#2b3315';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const marginX = canvas.width * 0.045;
  for (let row = 0; row < 2; row += 1) {
    const text = (rows[row] ?? '').slice(0, 16);
    const y = canvas.height * (row === 0 ? 0.33 : 0.68);
    ctx.fillText(text, marginX, y);
  }

  return finishTexture(canvas);
}
