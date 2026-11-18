/**
 * Browser side of R2 media uploads: ask the API for a signed URL, PUT the file straight to R2
 * with progress, then ask the API to verify it. The file never passes through our servers.
 */
export type UploadKind = 'image' | 'video' | 'document';

/** Mirrors MEDIA_TYPES in src/modules/media/service.ts (the server re-checks everything). */
export const ACCEPT: Record<UploadKind, { mime: string[]; maxMb: number; label: string }> = {
  image: { mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxMb: 10, label: 'JPEG, PNG, WebP or GIF up to 10 MB' },
  video: { mime: ['video/mp4', 'video/webm'], maxMb: 100, label: 'MP4 or WebM up to 100 MB' },
  document: { mime: ['application/pdf'], maxMb: 20, label: 'PDF up to 20 MB' },
};

export interface UploadedMedia {
  id: string;
  kind: UploadKind;
  fileName: string;
  size: number;
  contentType: string;
  url: string;
}

export class UploadError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
  }
}

/** Client-side pre-check so obvious mistakes fail instantly; the server enforces the same rules. */
export function precheck(file: File, kind: UploadKind): string | null {
  const spec = ACCEPT[kind];
  if (!spec.mime.includes(file.type)) return `That file type is not supported. Use ${spec.label}.`;
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > spec.maxMb * 1024 * 1024) return `That file is too large. Use ${spec.label}.`;
  return null;
}

async function json(res: Response) {
  return res.json().catch(() => ({}));
}

export async function uploadMedia(file: File, kind: UploadKind, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<UploadedMedia> {
  const start = await fetch('/api/media/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size, kind }),
    signal,
  }).catch(() => null);
  if (!start) throw new UploadError('Network error. Check your connection and try again.');
  const s = await json(start);
  if (!start.ok) throw new UploadError(s.message || 'The upload could not be started.', s.error);
  const mediaId: string = s.media.id;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', s.upload.url);
    for (const [k, v] of Object.entries(s.upload.headers as Record<string, string>)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.min(0.99, e.loaded / e.total));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError('The file could not be uploaded. Please try again.')));
    xhr.onerror = () => reject(new UploadError('The file could not be uploaded. Check your connection and try again.'));
    xhr.onabort = () => reject(new UploadError('Upload cancelled.', 'ABORTED'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  }).catch((e) => {
    // Best effort: release the reservation; the server's cleanup removes it anyway.
    fetch(`/api/media/${mediaId}`, { method: 'DELETE' }).catch(() => undefined);
    throw e;
  });

  const done = await fetch(`/api/media/${mediaId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
  if (!done) throw new UploadError('Network error. Check your connection and try again.');
  const d = await json(done);
  if (!done.ok) throw new UploadError(d.message || 'The file could not be verified.', d.error);
  onProgress(1);
  return d.media as UploadedMedia;
}

export function formatBytes(n?: number) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
