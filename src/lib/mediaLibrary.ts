import sharp from 'sharp';
import { IMediaQuality, MediaQualityFlag } from '../models/mediaMetadata';

export const MEDIA_SOURCES = ['menu', 'gallery'] as const;
export type MediaSource = typeof MEDIA_SOURCES[number];

export function normalizeMediaTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const tags = value.map((tag) => typeof tag === 'string' ? tag.trim().toLowerCase().replace(/\s+/g, ' ') : '').filter(Boolean);
  if (tags.some((tag) => tag.length > 32 || !/^[a-z0-9][a-z0-9 &/+-]*$/.test(tag))) return null;
  return [...new Set(tags)];
}

export function isMediaSource(value: string): value is MediaSource { return (MEDIA_SOURCES as readonly string[]).includes(value); }

export function hammingDistance(left: string, right: string) {
  if (left.length !== right.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
  return distance;
}

export async function inspectCloudinaryImage(imageUrl: string): Promise<{ quality: IMediaQuality; fingerprint: string }> {
  let url: URL;
  try { url = new URL(imageUrl); } catch { throw new Error('The image URL is invalid.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new Error('Only secure Cloudinary image URLs can be analysed.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    const length = Number(response.headers.get('content-length') || 0);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || length > 12_000_000) throw new Error('The image could not be safely inspected.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 12_000_000) throw new Error('The image could not be safely inspected.');
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height) throw new Error('The image dimensions are unavailable.');
    const pixels = await sharp(bytes, { limitInputPixels: 40_000_000 }).resize(8, 8, { fit: 'fill' }).removeAlpha().grayscale().raw().toBuffer();
    const mean = pixels.reduce((total, pixel) => total + pixel, 0) / pixels.length;
    const fingerprint = [...pixels].map((pixel) => pixel >= mean ? '1' : '0').join('');
    const stats = await sharp(bytes, { limitInputPixels: 40_000_000 }).removeAlpha().grayscale().stats();
    const edges = await sharp(bytes, { limitInputPixels: 40_000_000 }).resize(128, 128, { fit: 'inside', withoutEnlargement: true }).removeAlpha().grayscale().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).linear(1, 128).raw().toBuffer();
    const edgeStrength = edges.length ? edges.reduce((total, pixel) => total + Math.abs(pixel - 128), 0) / edges.length : 0;
    const ratio = metadata.width / metadata.height;
    const flags: MediaQualityFlag[] = [];
    if (Math.min(metadata.width, metadata.height) < 600) flags.push('small');
    if (ratio < 0.5 || ratio > 2.2) flags.push('unusual_aspect');
    if ((stats.channels[0]?.stdev || 0) < 16) flags.push('low_detail');
    if (edgeStrength < 5) flags.push('blurry');
    return { quality: { status: 'ready', width: metadata.width, height: metadata.height, bytes: bytes.length, flags, checkedAt: new Date() }, fingerprint };
  } finally { clearTimeout(timeout); }
}
