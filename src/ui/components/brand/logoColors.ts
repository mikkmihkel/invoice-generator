import { logoImageSrc } from '../../util'
import { extractPalette, type PaletteOptions } from './palette'

const SIZE = 160

/** Dominant colours of an embedded PNG/JPEG logo (data URL), drawn small onto a canvas. Rejects on failure. */
export async function logoColors(dataUrl: string | undefined, opts?: PaletteOptions): Promise<string[]> {
  const src = logoImageSrc(dataUrl)
  if (!src) return []
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Logo image could not be decoded'))
    img.src = src
  })
  const scale = Math.min(1, SIZE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  return extractPalette(ctx.getImageData(0, 0, w, h).data, opts)
}
