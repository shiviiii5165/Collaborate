/**
 * Post media stored in Cloudflare R2 (src/lib/media/r2.ts). Postgres keeps one `media_object`
 * document per file; R2 keeps only the bytes. The bucket is private.
 *
 * Lifecycle:
 *   pending   signed upload URL issued; the browser uploads directly to R2
 *   ready     upload checked by the API (exists, declared size and type, file signature)
 *   attached  used by exactly one post (postId)
 *   detached  removed from its post by an edit, or the post was deleted; cleanup deletes it
 *   deleting  claimed by the cleanup job; can no longer be attached
 *
 * Cleanup deletes pending uploads older than PENDING_TTL, ready-but-never-attached uploads older
 * than READY_TTL, and every detached object. A post removed by a moderator keeps its media
 * (status stays attached) so a "restore" brings it back intact.
 */
import crypto from 'crypto';
import { durableDb } from '@/lib/db/index';
import { getMediaStore, type MediaStore } from '@/lib/media/r2';

export type MediaKind = 'image' | 'video' | 'document';
export type MediaStatus = 'pending' | 'ready' | 'attached' | 'detached' | 'deleting';

export interface MediaDoc {
  id: string;
  ownerId: string;
  key: string;
  kind: MediaKind;
  contentType: string;
  size: number;
  fileName: string;
  status: MediaStatus;
  postId?: string;
  createdAt: string;
  uploadedAt?: string;
  attachedAt?: string;
  detachedAt?: string;
}

export class MediaError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

const MB = 1024 * 1024;
/** Allowed types. SVG and HTML are deliberately excluded (script content). */
export const MEDIA_TYPES: Record<string, { kind: MediaKind; maxBytes: number; ext: string }> = {
  'image/jpeg': { kind: 'image', maxBytes: 10 * MB, ext: 'jpg' },
  'image/png': { kind: 'image', maxBytes: 10 * MB, ext: 'png' },
  'image/webp': { kind: 'image', maxBytes: 10 * MB, ext: 'webp' },
  'image/gif': { kind: 'image', maxBytes: 10 * MB, ext: 'gif' },
  'video/mp4': { kind: 'video', maxBytes: 100 * MB, ext: 'mp4' },
  'video/webm': { kind: 'video', maxBytes: 100 * MB, ext: 'webm' },
  'application/pdf': { kind: 'document', maxBytes: 20 * MB, ext: 'pdf' },
};

export const MEDIA_LIMITS = {
  uploadUrlSeconds: 10 * 60,
  readUrlSeconds: 5 * 60,
  /** Unattached uploads (pending or ready) a member may hold at once. */
  maxUnattachedPerMember: 20,
  pendingTtlMs: 60 * 60_000,
  readyTtlMs: 24 * 60 * 60_000,
  /** A cleanup claim older than this is considered abandoned and retried. */
  deletingTtlMs: 15 * 60_000,
  fileNameChars: 120,
} as const;

const nowIso = () => new Date().toISOString();
const err = (status: number, code: string, message: string) => new MediaError(status, code, message);
const media = () => durableDb.getSocialState().mediaObjects;
const changed = () => durableDb.markSocialChanged();

export function requireMediaStore(): MediaStore {
  const s = getMediaStore();
  if (!s) throw err(503, 'MEDIA_NOT_CONFIGURED', 'File uploads are not available right now.');
  return s;
}

export function cleanFileName(raw: unknown, ext: string): string {
  let name = typeof raw === 'string' ? raw : '';
  name = name.split(/[\\/]/).pop() || '';
  name = name
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F"<>|:*?\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEDIA_LIMITS.fileNameChars);
  if (!name || name.startsWith('.')) name = `file.${ext}`;
  return name;
}

/** Checks the first bytes of the stored object against the declared type. */
export function signatureMatches(contentType: string, head: Buffer): boolean {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, s: string) => head.subarray(offset, offset + s.length).toString('latin1') === s;
  switch (contentType) {
    case 'image/jpeg':
      return at(0, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return ascii(0, 'GIF87a') || ascii(0, 'GIF89a');
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'video/mp4':
      return ascii(4, 'ftyp');
    case 'video/webm':
      return at(0, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'application/pdf':
      return ascii(0, '%PDF-');
    default:
      return false;
  }
}

function ownedMedia(userId: string, id: unknown): MediaDoc {
  const doc = typeof id === 'string' ? (media()[id] as MediaDoc | undefined) : undefined;
  // Someone else's file is reported exactly like a missing one.
  if (!doc || doc.ownerId !== userId) throw err(404, 'MEDIA_NOT_FOUND', 'This file is not available.');
  return doc;
}

function publicMedia(doc: MediaDoc) {
  return { id: doc.id, kind: doc.kind, contentType: doc.contentType, size: doc.size, fileName: doc.fileName, status: doc.status, url: `/api/media/${doc.id}` };
}

/** Step 1: validate the declared file and issue a short-lived signed PUT URL. */
export async function createUpload(userId: string, body: Record<string, any>) {
  const store = requireMediaStore();
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
  const spec = MEDIA_TYPES[contentType];
  if (!spec) throw err(400, 'UNSUPPORTED_FILE_TYPE', 'Upload a JPEG, PNG, WebP or GIF image, an MP4 or WebM video, or a PDF.');
  const size = body.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) throw err(400, 'VALIDATION_ERROR', 'File size is required.');
  if (size > spec.maxBytes) throw err(413, 'FILE_TOO_LARGE', `This ${spec.kind} is too large. The limit is ${Math.round(spec.maxBytes / MB)} MB.`);
  if (body.kind !== undefined && body.kind !== spec.kind) throw err(400, 'UNSUPPORTED_FILE_TYPE', `That file is not a${spec.kind === 'image' ? 'n' : ''} ${body.kind}.`);
  const unattached = Object.values(media()).filter((m: MediaDoc) => m.ownerId === userId && (m.status === 'pending' || m.status === 'ready')).length;
  if (unattached >= MEDIA_LIMITS.maxUnattachedPerMember) {
    throw err(429, 'TOO_MANY_UPLOADS', 'You have too many unfinished uploads. Publish or remove some before adding more.');
  }

  const id = `med_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
  const fileName = cleanFileName(body.fileName, spec.ext);
  // The key never contains the user's file name, so it cannot be used to craft paths.
  const key = `posts/${userId}/${id}.${spec.ext}`;
  const uploadUrl = await store.presignPut(key, contentType, size, MEDIA_LIMITS.uploadUrlSeconds);
  const doc: MediaDoc = { id, ownerId: userId, key, kind: spec.kind, contentType, size, fileName, status: 'pending', createdAt: nowIso() };
  media()[id] = doc;
  changed();
  return {
    media: publicMedia(doc),
    upload: {
      method: 'PUT',
      url: uploadUrl,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + MEDIA_LIMITS.uploadUrlSeconds * 1000).toISOString(),
    },
  };
}

/** Step 2: after the browser's PUT, confirm what actually landed in R2 before it can be used. */
export async function completeUpload(userId: string, id: unknown) {
  const store = requireMediaStore();
  const doc = ownedMedia(userId, id);
  if (doc.status === 'ready' || doc.status === 'attached') return { media: publicMedia(doc) }; // idempotent retry
  if (doc.status !== 'pending') throw err(404, 'MEDIA_NOT_FOUND', 'This file is not available.');

  const info = await store.head(doc.key);
  if (!info) throw err(409, 'UPLOAD_NOT_FOUND', 'The upload has not finished yet. Please try again.');
  const reject = async (message: string) => {
    await store.delete(doc.key).catch(() => undefined);
    const current = media()[doc.id] as MediaDoc | undefined;
    if (current && current.status === 'pending') {
      delete media()[doc.id];
      changed();
    }
    return err(422, 'UPLOAD_REJECTED', message);
  };
  if (info.size !== doc.size) throw await reject('The uploaded file does not match the declared size.');
  if (info.contentType && info.contentType.toLowerCase() !== doc.contentType) throw await reject('The uploaded file does not match the declared type.');
  const head = await store.readPrefix(doc.key, 16);
  if (!signatureMatches(doc.contentType, head)) throw await reject('The file content does not match its type.');

  // Re-read after the awaits: another request on this instance may have changed the record.
  const current = media()[doc.id] as MediaDoc | undefined;
  if (!current || current.ownerId !== userId) throw err(404, 'MEDIA_NOT_FOUND', 'This file is not available.');
  if (current.status === 'pending') {
    media()[doc.id] = { ...current, status: 'ready', uploadedAt: nowIso() };
    changed();
  }
  return { media: publicMedia(media()[doc.id]) };
}

/** Removes an upload the member decided not to use (never one that is attached to a post). */
export async function discardUpload(userId: string, id: unknown) {
  const doc = ownedMedia(userId, id);
  if (doc.status === 'attached') throw err(409, 'MEDIA_IN_USE', 'Remove this file from its post first.');
  if (doc.status === 'deleting') return { deleted: true };
  // Marked detached first so a failed R2 call still leaves it for the cleanup job.
  media()[doc.id] = { ...doc, status: 'detached', detachedAt: nowIso() };
  changed();
  const store = getMediaStore();
  if (store) {
    try {
      await store.delete(doc.key);
      const current = media()[doc.id] as MediaDoc | undefined;
      if (current && current.status === 'detached') {
        delete media()[doc.id];
        changed();
      }
    } catch {
      /* cleanup job retries */
    }
  }
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Attachment linking (called by the social service inside one request)
// ---------------------------------------------------------------------------
/**
 * Validates a media attachment for `authorId`. The file must belong to the author, have passed
 * completeUpload, and be either unused or already attached to `postId` (when editing).
 */
export function resolveMediaAttachment(authorId: string, mediaId: unknown, declaredType: unknown, postId?: string) {
  const doc = typeof mediaId === 'string' ? (media()[mediaId] as MediaDoc | undefined) : undefined;
  if (!doc || doc.ownerId !== authorId) throw err(400, 'MEDIA_NOT_FOUND', 'One of the attached files is not available. Remove it and upload it again.');
  const usable = doc.status === 'ready' || (doc.status === 'attached' && postId !== undefined && doc.postId === postId);
  if (!usable) {
    if (doc.status === 'pending') throw err(400, 'UPLOAD_INCOMPLETE', 'Wait for the upload to finish before publishing.');
    if (doc.status === 'attached') throw err(400, 'MEDIA_IN_USE', 'That file is already used by another post.');
    throw err(400, 'MEDIA_NOT_FOUND', 'One of the attached files is not available. Remove it and upload it again.');
  }
  if (declaredType !== undefined && declaredType !== doc.kind) throw err(400, 'VALIDATION_ERROR', 'Attachment type does not match the uploaded file.');
  return doc;
}

/** Marks the post's media attached and media no longer referenced by it detached. */
export function syncPostMedia(postId: string, mediaIds: string[]): void {
  const all = media();
  const keep = new Set(mediaIds);
  const ts = nowIso();
  let dirty = false;
  for (const id of keep) {
    const doc = all[id] as MediaDoc | undefined;
    if (doc && (doc.status !== 'attached' || doc.postId !== postId)) {
      all[id] = { ...doc, status: 'attached', postId, attachedAt: ts };
      dirty = true;
    }
  }
  for (const doc of Object.values(all) as MediaDoc[]) {
    if (doc.postId === postId && doc.status === 'attached' && !keep.has(doc.id)) {
      all[doc.id] = { ...doc, status: 'detached', detachedAt: ts };
      dirty = true;
    }
  }
  if (dirty) changed();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
/**
 * A short-lived signed GET URL, after `canViewPost(postId)` (supplied by the caller, so the post
 * visibility rules stay in one place). Unattached uploads are visible only to their owner.
 */
export async function readUrl(viewerId: string, id: unknown, canViewPost: (postId: string) => boolean, opts: { download?: boolean } = {}) {
  const doc = typeof id === 'string' ? (media()[id] as MediaDoc | undefined) : undefined;
  const notFound = err(404, 'MEDIA_NOT_FOUND', 'This file is not available.');
  if (!doc || doc.status === 'detached' || doc.status === 'deleting') throw notFound;
  if (doc.status === 'attached') {
    if (!doc.postId || !canViewPost(doc.postId)) throw notFound;
  } else if (doc.ownerId !== viewerId || doc.status !== 'ready') {
    throw notFound;
  }
  const store = requireMediaStore();
  // PDFs are always served as downloads; images and videos inline.
  const download = opts.download || doc.kind === 'document';
  const url = await store.presignGet(doc.key, MEDIA_LIMITS.readUrlSeconds, { contentType: doc.contentType, downloadName: download ? doc.fileName : undefined });
  return { url, expiresIn: MEDIA_LIMITS.readUrlSeconds };
}

// ---------------------------------------------------------------------------
// Orphan cleanup
// ---------------------------------------------------------------------------
function isOrphan(doc: MediaDoc, now: number): boolean {
  const age = (iso?: string) => now - Date.parse(iso || doc.createdAt);
  switch (doc.status) {
    case 'pending':
      return age(doc.createdAt) > MEDIA_LIMITS.pendingTtlMs;
    case 'ready':
      return age(doc.uploadedAt) > MEDIA_LIMITS.readyTtlMs;
    case 'detached':
      return true;
    case 'deleting':
      return age(doc.detachedAt) > MEDIA_LIMITS.deletingTtlMs;
    case 'attached': {
      // Attached to a post that no longer exists or was deleted by its author.
      const post = doc.postId ? (durableDb.getSocialState().posts[doc.postId] as any) : undefined;
      return !post || Boolean(post.deletedAt);
    }
    default:
      return false;
  }
}

/**
 * Deletes orphaned objects from R2 and their records. Safe with several instances:
 *   1. claim: orphans are marked `deleting` and the claim is flushed (revision-checked, so a
 *      concurrent attach on another instance makes the claim conflict and nothing is deleted);
 *   2. objects are deleted from R2 (idempotent);
 *   3. records are removed and flushed.
 */
export async function cleanupOrphanMedia(opts: { now?: number; limit?: number } = {}) {
  const store = requireMediaStore();
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 200;
  await durableDb.syncFromStore();
  const all = media();
  const claimed = (Object.values(all) as MediaDoc[]).filter((d) => isOrphan(d, now)).slice(0, limit);
  if (claimed.length === 0) return { deleted: 0, failed: 0 };
  const ts = new Date(now).toISOString();
  for (const d of claimed) all[d.id] = { ...d, status: 'deleting', detachedAt: ts };
  changed();
  await durableDb.flush(true);

  let deleted = 0;
  let failed = 0;
  for (const d of claimed) {
    try {
      await store.delete(d.key);
      if ((media()[d.id] as MediaDoc | undefined)?.status === 'deleting') delete media()[d.id];
      deleted++;
    } catch {
      failed++; // stays `deleting`; retried after deletingTtlMs
    }
  }
  changed();
  await durableDb.flush(true);
  return { deleted, failed };
}

/** Periodic cleanup for a long-running API process. Returns a stop function. */
export function startMediaCleanup(intervalMs = 15 * 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running || !getMediaStore()) return;
    running = true;
    try {
      const r = await cleanupOrphanMedia();
      if (r.deleted || r.failed) console.log(`[Media] Cleanup removed ${r.deleted} orphaned file(s); ${r.failed} will be retried.`);
    } catch (e: any) {
      console.error('[Media] Cleanup failed:', e?.message || e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
