/**
 * Collaborate social feed: posts, engagement, platform-wide ranking and creator analytics.
 *
 * Storage: documents in the shared store (collections post, post_comment, post_like, ...; see
 * src/lib/db/documents.ts). Counters are never stored; every count is derived from the
 * documents, so likes / comments / reposts can never drift from what actually exists.
 *
 * Visibility: every published post is visible to every signed-in Collaborate member, with no
 * audience setting. The only exclusions are the platform's existing safety rules: blocks (either
 * direction), deactivated or restricted authors, deleted posts, and posts auto-hidden pending
 * moderation after reports from several distinct members.
 */
import crypto from 'crypto';
import { durableDb } from '@/lib/db/index';
import type { AbuseReport, MemberProfile } from '@/lib/types';
import { canInitiateContact } from '@collaborate/domain';
import { normalizeSkill } from '@/modules/intelligence/skills';
import { getProfileIntelligence } from '@/modules/intelligence/profile-intelligence';
import { toSelfMember } from '@/modules/profile/public-member';
import * as Media from '@/modules/media/service';

// ---------------------------------------------------------------------------
// Types & limits
// ---------------------------------------------------------------------------
export const POST_KINDS = ['update', 'project', 'research', 'question', 'achievement', 'opportunity', 'poll'] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** Filters map 1:1 onto the kind the author chose when posting, so every filter is backed by data. */
export const FEED_FILTERS = ['for_you', 'latest', 'research', 'projects', 'discussions', 'opportunities'] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number] | 'saved' | 'author';
const FILTER_KINDS: Partial<Record<FeedFilter, PostKind[]>> = {
  research: ['research'],
  projects: ['project'],
  discussions: ['question', 'poll'],
  opportunities: ['opportunity'],
};

export const LIMITS = {
  text: 3000,
  comment: 1500,
  topics: 5,
  topicChars: 40,
  attachments: 4,
  urlChars: 2048,
  attachmentTitle: 140,
  pollOptions: { min: 2, max: 4, chars: 80 },
  pollDays: { min: 1, max: 14 },
  pageSize: 10,
  maxPageSize: 25,
  impressionBatch: 50,
  /** Repeat displays to the same member within this window count as one impression. */
  impressionWindowMs: 30 * 60_000,
  /** Distinct reporters after which a post is hidden from others until reviewed. */
  autoHideReports: 3,
  /** Engagement rate is shown only once a post has at least this many impressions. */
  minImpressionsForRate: 20,
} as const;

export interface Attachment {
  type: 'image' | 'video' | 'document' | 'link';
  /** External https link, or `/api/media/<mediaId>` for a file uploaded to R2. */
  url: string;
  title?: string;
  /** Set for uploaded files (src/modules/media). */
  mediaId?: string;
  fileName?: string;
  size?: number;
  contentType?: string;
}

export interface PostDoc {
  id: string;
  authorId: string;
  kind: PostKind;
  text: string;
  topics: string[];
  attachments: Attachment[];
  project?: { projectId?: string; title: string; url?: string; technologies: string[] };
  poll?: { options: string[]; closesAt: string };
  repostOfId?: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  /** Set by a moderator's "remove" decision; content is kept so "restore" can undo it. */
  moderation?: ModerationMark;
}

export interface ModerationMark {
  state: 'removed';
  by: string;
  at: string;
  reportId: string;
}

export interface CommentDoc {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  moderation?: ModerationMark;
}

export class SocialError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'SocialError';
  }
}

const bad = (message: string, code = 'VALIDATION_ERROR') => new SocialError(400, code, message);
const notFound = () => new SocialError(404, 'POST_NOT_FOUND', 'This post is not available.');
const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`;
const pairKey = (postId: string, userId: string) => `${postId}|${userId}`;

/**
 * One repost per member per original: the id is derived from the pair, so two instances storing
 * the same repost write the same document key and the database rejects the second (409
 * ALREADY_REPOSTED). Undoing a repost leaves a tombstone under that id, which a later repost
 * replaces (also conflict-checked by revision).
 */
export const REPOST_ID_PREFIX = 'post_rp_';
export const repostId = (originalId: string, memberId: string) =>
  `${REPOST_ID_PREFIX}${crypto.createHash('sha256').update(`${originalId}|${memberId}`).digest('hex').slice(0, 32)}`;
const store = () => durableDb.getSocialState();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function cleanText(raw: unknown, max: number, field: string, required: boolean): string {
  if (raw === undefined || raw === null) raw = '';
  if (typeof raw !== 'string') throw bad(`${field} must be text`);
  // Strip control characters except newlines/tabs, collapse runs of blank lines.
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
  if (required && !text) throw bad(`${field} cannot be empty`);
  if (text.length > max) throw bad(`${field} can be at most ${max} characters`);
  return text;
}

export function validateUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw bad('Attachment URL is required');
  const value = raw.trim();
  if (value.length > LIMITS.urlChars) throw bad('Attachment URL is too long');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw bad('Attachment URL is not a valid web address');
  }
  if (u.protocol !== 'https:') throw bad('Attachment links must use https://');
  if (u.username || u.password) throw bad('Attachment links must not contain credentials');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':')) {
    throw bad('Attachment links must point to a public website');
  }
  return u.toString();
}

const HASHTAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_+.-]{0,38})/gu;

export function extractTopics(text: string, explicit: unknown): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const c = normalizeSkill(t.replace(/^#/, '')).slice(0, LIMITS.topicChars);
    if (c && !out.includes(c)) out.push(c);
  };
  if (explicit !== undefined && explicit !== null) {
    if (!Array.isArray(explicit) || explicit.some((t) => typeof t !== 'string')) throw bad('topics must be a list of words');
    explicit.forEach((t: string) => t.trim() && add(t));
  }
  for (const m of text.matchAll(HASHTAG)) add(m[2]);
  if (out.length > LIMITS.topics * 2) throw bad(`Use at most ${LIMITS.topics} topics`);
  return out.slice(0, LIMITS.topics);
}

/**
 * Link attachments carry an https URL. Uploaded files carry a mediaId, which must belong to the
 * author and have passed upload verification; the stored URL is then the API's own
 * `/api/media/<id>` (which checks visibility and redirects to a short-lived signed R2 URL).
 */
function validateAttachments(raw: unknown, authorId: string, postId?: string): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw bad('attachments must be a list');
  if (raw.length > LIMITS.attachments) throw bad(`At most ${LIMITS.attachments} attachments per post`);
  const seen = new Set<string>();
  return raw.map((a: any) => {
    if (!a || typeof a !== 'object') throw bad('Invalid attachment');
    if (!['image', 'video', 'document', 'link'].includes(a.type)) throw bad('Attachment type must be image, video, document or link');
    const title = a.title ? cleanText(a.title, LIMITS.attachmentTitle, 'Attachment title', false) : undefined;
    if (a.mediaId !== undefined) {
      if (a.type === 'link') throw bad('A link cannot reference an uploaded file');
      const doc = Media.resolveMediaAttachment(authorId, a.mediaId, a.type, postId);
      if (seen.has(doc.id)) throw bad('The same file is attached twice');
      seen.add(doc.id);
      return { type: doc.kind, url: `/api/media/${doc.id}`, mediaId: doc.id, fileName: doc.fileName, size: doc.size, contentType: doc.contentType, ...(title ? { title } : {}) };
    }
    return { type: a.type, url: validateUrl(a.url), ...(title ? { title } : {}) };
  });
}
const mediaIdsOf = (attachments: Attachment[]) => attachments.flatMap((a) => (a.mediaId ? [a.mediaId] : []));

/** Whether `viewerId` may load a file attached to `postId` (same rule as the post itself; admins may review). */
export function canViewPostMedia(viewerId: string, postId: string): boolean {
  const post = store().posts[postId] as PostDoc | undefined;
  if (canSee(post, viewerCtx(viewerId))) return true;
  const p = store().posts[postId] as PostDoc | undefined;
  return Boolean(p && !p.deletedAt && durableDb.getMemberById(viewerId)?.role === 'admin');
}

function validateProject(raw: unknown, author: MemberProfile): PostDoc['project'] {
  if (!raw || typeof raw !== 'object') throw bad('A project showcase needs a project');
  const r = raw as any;
  // A project from the author's own profile is copied server-side, so the showcase cannot claim
  // technologies or links the profile does not list.
  if (r.projectId) {
    const p = (author.projects || []).find((x) => x.id === r.projectId);
    if (!p) throw bad('That project is not on your profile');
    let safeUrl: string | undefined;
    for (const candidate of [p.demoUrl, ...(p.links || [])]) {
      try {
        if (candidate) {
          safeUrl = validateUrl(candidate);
          break;
        }
      } catch {
        /* not a public https link; try the next one */
      }
    }
    return { projectId: p.id, title: String(p.title || 'Project').slice(0, 140), url: safeUrl, technologies: (p.tags || []).slice(0, 12).map(String) };
  }
  const title = cleanText(r.title, 140, 'Project title', true);
  const url = r.url ? validateUrl(r.url) : undefined;
  const technologies = Array.isArray(r.technologies) ? r.technologies.filter((t: unknown) => typeof t === 'string' && t.trim()).slice(0, 12).map((t: string) => t.trim().slice(0, 40)) : [];
  return { title, url, technologies };
}

function validatePoll(raw: unknown): PostDoc['poll'] {
  if (!raw || typeof raw !== 'object') throw bad('A poll needs options');
  const r = raw as any;
  if (!Array.isArray(r.options)) throw bad('Poll options must be a list');
  const options = r.options.map((o: unknown) => cleanText(o, LIMITS.pollOptions.chars, 'Poll option', true));
  if (options.length < LIMITS.pollOptions.min || options.length > LIMITS.pollOptions.max) {
    throw bad(`A poll needs ${LIMITS.pollOptions.min}-${LIMITS.pollOptions.max} options`);
  }
  if (new Set(options.map((o: string) => o.toLowerCase())).size !== options.length) throw bad('Poll options must be different');
  const days = r.durationDays === undefined ? 7 : Number(r.durationDays);
  if (!Number.isInteger(days) || days < LIMITS.pollDays.min || days > LIMITS.pollDays.max) {
    throw bad(`Poll duration must be ${LIMITS.pollDays.min}-${LIMITS.pollDays.max} days`);
  }
  return { options, closesAt: new Date(Date.now() + days * 86_400_000).toISOString() };
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------
function activeMember(id: string): MemberProfile | null {
  const m = durableDb.getMemberById(id);
  return m && !m.deactivated ? m : null;
}

/** Distinct members with an open (pending) report on the target. Reviewed reports no longer count. */
function distinctReporters(targetType: 'post' | 'comment', targetId: string): number {
  const reporters = new Set<string>();
  for (const r of durableDb.getAbuseReports()) {
    if (r.targetType === targetType && r.targetId === targetId && r.status === 'pending') reporters.add(r.reporterId);
  }
  return reporters.size;
}

const isRemoved = (d: { moderation?: { state: string } } | undefined) => d?.moderation?.state === 'removed';

interface ViewerCtx {
  id: string;
  blocked: Set<string>;
  /** Original post ids this viewer has an active repost of. */
  reposted: Set<string>;
}

function viewerCtx(viewerId: string): ViewerCtx {
  const reposted = new Set<string>();
  for (const p of Object.values(store().posts) as PostDoc[]) {
    if (!p.deletedAt && p.authorId === viewerId && p.repostOfId) reposted.add(p.repostOfId);
  }
  return { id: viewerId, blocked: durableDb.getBlockedIdsFor(viewerId), reposted };
}

/** The one rule for whether a viewer may see a post (also used for comments' parent post). */
function canSee(post: PostDoc | undefined, v: ViewerCtx, hiddenPosts?: Set<string>): post is PostDoc {
  if (!post || post.deletedAt) return false;
  if (post.authorId === v.id) return true;
  if (v.blocked.has(post.authorId)) return false;
  const author = activeMember(post.authorId);
  if (!author || author.isRestricted) return false;
  if (isRemoved(post)) return false;
  const hidden = hiddenPosts ? hiddenPosts.has(post.id) : distinctReporters('post', post.id) >= LIMITS.autoHideReports;
  return !hidden;
}

/** Ids of posts or comments hidden pending review (reports from several distinct members). */
function autoHiddenIds(targetType: 'post' | 'comment' = 'post'): Set<string> {
  const byTarget = new Map<string, Set<string>>();
  for (const r of durableDb.getAbuseReports()) {
    if (r.targetType !== targetType || !r.targetId || r.status !== 'pending') continue;
    if (!byTarget.has(r.targetId)) byTarget.set(r.targetId, new Set());
    byTarget.get(r.targetId)!.add(r.reporterId);
  }
  return new Set([...byTarget].filter(([, s]) => s.size >= LIMITS.autoHideReports).map(([id]) => id));
}
const hiddenPostIds = () => autoHiddenIds('post');

/** What the author (or a moderator) is told about a post's or comment's moderation state. */
function moderationStateOf(targetType: 'post' | 'comment', doc: { id: string; moderation?: { state: string } }, hidden?: Set<string>) {
  if (isRemoved(doc)) return 'removed' as const;
  const isHidden = hidden ? hidden.has(doc.id) : distinctReporters(targetType, doc.id) >= LIMITS.autoHideReports;
  return isHidden ? ('hidden_pending_review' as const) : null;
}

function requireVisiblePost(postId: unknown, viewerId: string): PostDoc {
  if (typeof postId !== 'string') throw notFound();
  const post = store().posts[postId] as PostDoc | undefined;
  if (!canSee(post, viewerCtx(viewerId))) throw notFound();
  return post;
}

/** Only these author fields ever leave the server with a post. No email, plan or settings. */
function authorCard(id: string) {
  const m = durableDb.getMemberById(id);
  if (!m) return null;
  return { id: m.id, fullName: m.fullName, headline: m.headline, avatarUrl: m.avatarUrl, isVerified: Boolean(m.isVerified) };
}

// ---------------------------------------------------------------------------
// Aggregates: one pass over engagement documents per request (no per-post scans).
// ---------------------------------------------------------------------------
interface Agg {
  likes: Map<string, number>;
  comments: Map<string, number>;
  shares: Map<string, number>;
  reposts: Map<string, number>;
  votes: Map<string, number[]>;
  reach: Map<string, number>;
  impressions: Map<string, number>;
  postsByAuthor: Map<string, number>;
}

let aggCache: { version: number; agg: Agg } | null = null;

function aggregates(): Agg {
  if (aggCache && aggCache.version === durableDb.socialVersion && durableDb.usesSharedStore === false) return aggCache.agg;
  const s = store();
  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  const agg: Agg = { likes: new Map(), comments: new Map(), shares: new Map(), reposts: new Map(), votes: new Map(), reach: new Map(), impressions: new Map(), postsByAuthor: new Map() };
  for (const l of Object.values(s.postLikes)) inc(agg.likes, l.postId);
  for (const c of Object.values(s.postComments) as CommentDoc[]) if (!c.deletedAt && !isRemoved(c)) inc(agg.comments, c.postId);
  for (const sh of Object.values(s.postShares)) inc(agg.shares, sh.postId);
  for (const p of Object.values(s.posts) as PostDoc[]) {
    if (p.deletedAt) continue;
    inc(agg.postsByAuthor, p.authorId);
    if (p.repostOfId) inc(agg.reposts, p.repostOfId);
  }
  for (const v of Object.values(s.postVotes)) {
    const arr = agg.votes.get(v.postId) ?? [];
    arr[v.option] = (arr[v.option] ?? 0) + 1;
    agg.votes.set(v.postId, arr);
  }
  for (const v of Object.values(s.postViews)) {
    inc(agg.reach, v.postId);
    inc(agg.impressions, v.postId, v.impressions || 0);
  }
  aggCache = { version: durableDb.socialVersion, agg };
  return agg;
}

function changed() {
  aggCache = null;
  durableDb.markSocialChanged();
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
function serializePost(post: PostDoc, viewerId: string, agg: Agg, v: ViewerCtx, hidden: Set<string>, depth = 0): any {
  const s = store();
  const isAuthor = post.authorId === viewerId;
  const myVote = s.postVotes[pairKey(post.id, viewerId)]?.option;
  let poll: any;
  if (post.poll) {
    const counts = agg.votes.get(post.id) ?? [];
    const total = post.poll.options.reduce((acc, _o, i) => acc + (counts[i] ?? 0), 0);
    const closed = Date.parse(post.poll.closesAt) <= Date.now();
    const showResults = closed || isAuthor || myVote !== undefined;
    poll = {
      options: post.poll.options.map((label, i) => ({ label, votes: showResults ? counts[i] ?? 0 : null })),
      totalVotes: showResults ? total : null,
      closesAt: post.poll.closesAt,
      closed,
      myVote: myVote ?? null,
    };
  }
  let repostOf: any;
  if (post.repostOfId) {
    const original = s.posts[post.repostOfId] as PostDoc | undefined;
    repostOf = depth === 0 && canSee(original, v, hidden) ? serializePost(original, viewerId, agg, v, hidden, 1) : { unavailable: true };
  }
  return {
    id: post.id,
    kind: post.kind,
    text: post.text,
    topics: post.topics,
    attachments: post.attachments,
    project: post.project ?? null,
    poll: poll ?? null,
    repostOf: repostOf ?? null,
    author: authorCard(post.authorId),
    createdAt: post.createdAt,
    editedAt: post.editedAt ?? null,
    isAuthor,
    // Only the author is told when their post is hidden or removed (others cannot see it at all).
    moderation: isAuthor ? moderationStateOf('post', post, hidden) : null,
    counts: {
      likes: agg.likes.get(post.id) ?? 0,
      comments: agg.comments.get(post.id) ?? 0,
      reposts: agg.reposts.get(post.id) ?? 0,
      shares: agg.shares.get(post.id) ?? 0,
    },
    viewer: {
      liked: Boolean(s.postLikes[pairKey(post.id, viewerId)]),
      bookmarked: Boolean(s.postBookmarks[pairKey(post.id, viewerId)]),
      reposted: v.reposted.has(post.id),
    },
  };
}

function serializeOne(post: PostDoc, viewerId: string) {
  const v = viewerCtx(viewerId);
  return serializePost(post, viewerId, aggregates(), v, hiddenPostIds());
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------
function assertCanPost(authorId: string): MemberProfile {
  const author = activeMember(authorId);
  if (!author) throw new SocialError(401, 'INVALID_SESSION', 'Session expired or invalid');
  if (author.isRestricted) {
    throw new SocialError(403, 'ACCOUNT_RESTRICTED', 'Your account is restricted. Lift the restriction in Settings to publish posts.');
  }
  return author;
}

export function createPost(authorId: string, body: Record<string, any>) {
  const author = assertCanPost(authorId);
  const s = store();
  const kind: PostKind = body.kind === undefined ? 'update' : body.kind;
  if (!POST_KINDS.includes(kind)) throw bad('Unknown post type');

  let repostOfId: string | undefined;
  if (body.repostOfId !== undefined) {
    const original = requireVisiblePost(body.repostOfId, authorId);
    repostOfId = original.repostOfId ?? original.id; // reposting a repost credits the original
    const root = s.posts[repostOfId] as PostDoc | undefined;
    if (!canSee(root, viewerCtx(authorId))) throw notFound();
    if (root!.authorId === authorId) throw bad('You cannot repost your own post', 'REPOST_OWN');
    const existing = s.posts[repostId(repostOfId, authorId)] as PostDoc | undefined;
    const already = (existing && !existing.deletedAt) || Object.values(s.posts).some((p: any) => !p.deletedAt && p.authorId === authorId && p.repostOfId === repostOfId);
    if (already) throw new SocialError(409, 'ALREADY_REPOSTED', 'You have already reposted this post.');
  }

  const text = cleanText(body.text, LIMITS.text, 'Post text', !repostOfId && kind !== 'poll');
  if (kind === 'poll' && !text) throw bad('Ask a question for your poll');
  const attachments = repostOfId ? [] : validateAttachments(body.attachments, authorId);
  const topics = extractTopics(text, body.topics);
  const project = !repostOfId && kind === 'project' ? validateProject(body.project, author) : undefined;
  const poll = !repostOfId && kind === 'poll' ? validatePoll(body.poll) : undefined;
  if (project) for (const t of project.technologies) if (topics.length < LIMITS.topics) {
    const c = normalizeSkill(t);
    if (c && !topics.includes(c)) topics.push(c);
  }

  // Spam guard: the same text from the same author within 24h is refused. Repost commentary is
  // compared only with posts of the same kind (normal posts with normal posts, reposts of the
  // same original), so "Great read" on reposts of two different posts is allowed.
  if (text) {
    const dayAgo = Date.now() - 86_400_000;
    const dup = Object.values(s.posts).some(
      (p: any) => !p.deletedAt && p.authorId === authorId && p.text === text && (p.repostOfId ?? null) === (repostOfId ?? null) && Date.parse(p.createdAt) > dayAgo
    );
    if (dup) throw new SocialError(409, 'DUPLICATE_POST', 'You already published this exact post today.');
  }

  const ts = nowIso();
  const post: PostDoc = {
    id: repostOfId ? repostId(repostOfId, authorId) : newId('post'),
    authorId,
    kind: repostOfId ? 'update' : kind,
    text,
    topics,
    attachments,
    ...(project ? { project } : {}),
    ...(poll ? { poll } : {}),
    ...(repostOfId ? { repostOfId } : {}),
    createdAt: ts,
    updatedAt: ts,
  };
  s.posts[post.id] = post;
  Media.syncPostMedia(post.id, mediaIdsOf(attachments));
  changed();
  if (repostOfId) {
    const root = s.posts[repostOfId] as PostDoc;
    durableDb.addPostNotification(root.authorId, authorId, root.id, 'New repost', `${author.fullName} reposted your post.`);
  }
  return serializeOne(post, authorId);
}

export function getPost(postId: unknown, viewerId: string) {
  return serializeOne(requireVisiblePost(postId, viewerId), viewerId);
}

function requireOwnPost(postId: unknown, userId: string): PostDoc {
  const post = typeof postId === 'string' ? (store().posts[postId] as PostDoc | undefined) : undefined;
  if (!post || post.deletedAt) throw notFound();
  if (post.authorId !== userId) throw new SocialError(403, 'FORBIDDEN', 'Only the author can change this post.');
  return post;
}

export function updatePost(userId: string, postId: unknown, body: Record<string, any>) {
  assertCanPost(userId);
  const post = requireOwnPost(postId, userId);
  assertNotUnderReview('post', post);
  const author = durableDb.getMemberById(userId)!;
  const next: PostDoc = { ...post };
  if (body.text !== undefined) next.text = cleanText(body.text, LIMITS.text, 'Post text', !post.repostOfId);
  if (body.text !== undefined || body.topics !== undefined) next.topics = extractTopics(next.text, body.topics ?? post.topics);
  if (body.attachments !== undefined) {
    if (post.repostOfId) throw bad('Reposts cannot have attachments');
    next.attachments = validateAttachments(body.attachments, userId, post.id);
  }
  if (body.project !== undefined && post.kind === 'project') next.project = validateProject(body.project, author);
  if (body.poll !== undefined) throw bad('Poll options cannot be edited after publishing');
  if (body.kind !== undefined && body.kind !== post.kind) throw bad('The post type cannot be changed after publishing');
  const ts = nowIso();
  next.updatedAt = ts;
  next.editedAt = ts;
  store().posts[post.id] = next;
  Media.syncPostMedia(post.id, mediaIdsOf(next.attachments));
  changed();
  return serializeOne(next, userId);
}

/**
 * Deletion removes the content (text, attachments, poll) and every like, bookmark, vote and
 * comment on the post. The tombstone stays so reposts can say the original was removed and
 * so analytics of reposts stay consistent.
 */
export function deletePost(userId: string, postId: unknown) {
  const post = requireOwnPost(postId, userId);
  const s = store();
  s.posts[post.id] = { id: post.id, authorId: post.authorId, kind: post.kind, text: '', topics: [], attachments: [], createdAt: post.createdAt, updatedAt: nowIso(), deletedAt: nowIso(), ...(post.repostOfId ? { repostOfId: post.repostOfId } : {}) };
  for (const field of ['postLikes', 'postBookmarks', 'postVotes', 'postComments', 'postShares'] as const) {
    for (const [id, d] of Object.entries(s[field])) if ((d as any).postId === post.id) delete s[field][id];
  }
  Media.syncPostMedia(post.id, []); // files are deleted from R2 by the cleanup job
  changed();
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------
export function setLike(userId: string, postId: unknown, liked: boolean) {
  const post = requireVisiblePost(postId, userId);
  const s = store();
  const key = pairKey(post.id, userId);
  const had = Boolean(s.postLikes[key]);
  if (liked && !had) {
    s.postLikes[key] = { postId: post.id, userId, createdAt: nowIso() };
    changed();
    const already = durableDb
      .getNotificationsForUser(post.authorId)
      .some((n) => n.type === 'post_activity' && n.postId === post.id && n.actorId === userId && n.title === 'New like');
    if (!already) {
      const actor = durableDb.getMemberById(userId);
      durableDb.addPostNotification(post.authorId, userId, post.id, 'New like', `${actor?.fullName || 'A member'} liked your post.`);
    }
  } else if (!liked && had) {
    delete s.postLikes[key];
    changed();
  }
  return { liked, likes: aggregates().likes.get(post.id) ?? 0 };
}

export function setBookmark(userId: string, postId: unknown, bookmarked: boolean) {
  const post = requireVisiblePost(postId, userId);
  const s = store();
  const key = pairKey(post.id, userId);
  if (bookmarked && !s.postBookmarks[key]) {
    s.postBookmarks[key] = { postId: post.id, userId, createdAt: nowIso() };
    changed();
  } else if (!bookmarked && s.postBookmarks[key]) {
    delete s.postBookmarks[key];
    changed();
  }
  return { bookmarked };
}

/** A share is a member copying or sending the post's link; each member counts once per post. */
export function recordShare(userId: string, postId: unknown) {
  const post = requireVisiblePost(postId, userId);
  const s = store();
  const key = pairKey(post.id, userId);
  if (post.authorId !== userId && !s.postShares[key]) {
    s.postShares[key] = { postId: post.id, userId, createdAt: nowIso() };
    changed();
  }
  return { shares: aggregates().shares.get(post.id) ?? 0 };
}

export function vote(userId: string, postId: unknown, option: unknown) {
  const post = requireVisiblePost(postId, userId);
  if (!post.poll) throw bad('This post is not a poll');
  if (Date.parse(post.poll.closesAt) <= Date.now()) throw new SocialError(409, 'POLL_CLOSED', 'This poll has closed.');
  if (!Number.isInteger(option) || (option as number) < 0 || (option as number) >= post.poll.options.length) throw bad('Invalid poll option');
  store().postVotes[pairKey(post.id, userId)] = { postId: post.id, userId, option, createdAt: nowIso() };
  changed();
  return serializeOne(post, userId);
}

function safeguardComment(actorId: string, recipientId: string) {
  const actor = durableDb.getMemberById(actorId);
  const recipient = durableDb.getMemberById(recipientId);
  if (!actor || !recipient) return;
  const gate = canInitiateContact({ id: actorId, isUnder18: actor.isUnder18 }, { id: recipientId, isUnder18: recipient.isUnder18 });
  if (!gate.allowed) throw new SocialError(403, 'SAFEGUARDING_RESTRICTION', 'Replies to this member are restricted by safeguarding rules.');
}

function serializeComment(c: CommentDoc, viewerId: string, postAuthorId: string, hiddenComments?: Set<string>) {
  const moderation = moderationStateOf('comment', c, hiddenComments);
  const isOwn = c.authorId === viewerId;
  // Hidden / removed comments are a placeholder for everyone except their author.
  const concealed = !c.deletedAt && moderation !== null && !isOwn;
  const gone = Boolean(c.deletedAt) || concealed;
  return {
    id: c.id,
    postId: c.postId,
    parentId: c.parentId,
    text: gone ? '' : c.text,
    deleted: Boolean(c.deletedAt),
    hidden: concealed,
    moderation: isOwn ? moderation : null,
    author: gone ? null : authorCard(c.authorId),
    createdAt: c.createdAt,
    editedAt: c.editedAt ?? null,
    canEdit: !gone && isOwn && moderation === null,
    canDelete: !c.deletedAt && (isOwn || postAuthorId === viewerId),
  };
}

export function listComments(viewerId: string, postId: unknown) {
  const post = requireVisiblePost(postId, viewerId);
  const blocked = durableDb.getBlockedIdsFor(viewerId);
  const hidden = autoHiddenIds('comment');
  const all = (Object.values(store().postComments) as CommentDoc[])
    .filter((c) => c.postId === post.id && !blocked.has(c.authorId) && activeMember(c.authorId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const top = all.filter((c) => !c.parentId);
  const ser = (c: CommentDoc) => serializeComment(c, viewerId, post.authorId, hidden);
  const visible = (c: { deleted: boolean; hidden: boolean }) => !c.deleted && !c.hidden;
  return {
    comments: top
      .map((c) => ({ ...ser(c), replies: all.filter((r) => r.parentId === c.id).map(ser).filter(visible) }))
      // A deleted or hidden comment stays only as a placeholder for its visible replies.
      .filter((c) => visible(c) || c.replies.length > 0),
  };
}

function assertNotUnderReview(targetType: 'post' | 'comment', doc: PostDoc | CommentDoc) {
  if (moderationStateOf(targetType, doc) !== null) {
    throw new SocialError(409, 'UNDER_REVIEW', 'This content is under moderator review and cannot be edited right now.');
  }
}

export function addComment(userId: string, postId: unknown, body: Record<string, any>) {
  assertCanPost(userId);
  const post = requireVisiblePost(postId, userId);
  const s = store();
  const text = cleanText(body.text, LIMITS.comment, 'Comment', true);
  let parentId: string | null = null;
  let parent: CommentDoc | undefined;
  if (body.parentId !== undefined && body.parentId !== null) {
    parent = s.postComments[body.parentId] as CommentDoc | undefined;
    if (!parent || parent.postId !== post.id || parent.deletedAt || moderationStateOf('comment', parent) !== null) throw new SocialError(404, 'COMMENT_NOT_FOUND', 'That comment is no longer available.');
    if (durableDb.isBlocked(userId, parent.authorId)) throw new SocialError(404, 'COMMENT_NOT_FOUND', 'That comment is no longer available.');
    parentId = parent.parentId ?? parent.id; // one level of threading
    safeguardComment(userId, parent.authorId);
  }
  safeguardComment(userId, post.authorId);
  const ts = nowIso();
  const c: CommentDoc = { id: newId('cmt'), postId: post.id, authorId: userId, parentId, text, createdAt: ts, updatedAt: ts };
  s.postComments[c.id] = c;
  changed();
  const actorName = durableDb.getMemberById(userId)?.fullName || 'A member';
  durableDb.addPostNotification(post.authorId, userId, post.id, 'New comment', `${actorName} commented on your post.`);
  if (parent && parent.authorId !== post.authorId) {
    durableDb.addPostNotification(parent.authorId, userId, post.id, 'New reply', `${actorName} replied to your comment.`);
  }
  return serializeComment(c, userId, post.authorId);
}

export function updateComment(userId: string, commentId: unknown, body: Record<string, any>) {
  const c = typeof commentId === 'string' ? (store().postComments[commentId] as CommentDoc | undefined) : undefined;
  if (!c || c.deletedAt) throw new SocialError(404, 'COMMENT_NOT_FOUND', 'That comment is no longer available.');
  if (c.authorId !== userId) throw new SocialError(403, 'FORBIDDEN', 'Only the author can edit this comment.');
  const post = requireVisiblePost(c.postId, userId);
  assertNotUnderReview('comment', c);
  const ts = nowIso();
  const next = { ...c, text: cleanText(body.text, LIMITS.comment, 'Comment', true), updatedAt: ts, editedAt: ts };
  store().postComments[c.id] = next;
  changed();
  return serializeComment(next, userId, post.authorId);
}

/** The comment's author or the post's author may delete it. Replies are kept under a placeholder. */
export function deleteComment(userId: string, commentId: unknown) {
  const s = store();
  const c = typeof commentId === 'string' ? (s.postComments[commentId] as CommentDoc | undefined) : undefined;
  if (!c || c.deletedAt) throw new SocialError(404, 'COMMENT_NOT_FOUND', 'That comment is no longer available.');
  const post = s.posts[c.postId] as PostDoc | undefined;
  if (c.authorId !== userId && post?.authorId !== userId) throw new SocialError(403, 'FORBIDDEN', 'You cannot delete this comment.');
  const hasReplies = (Object.values(s.postComments) as CommentDoc[]).some((r) => r.parentId === c.id && !r.deletedAt);
  if (hasReplies) s.postComments[c.id] = { ...c, text: '', deletedAt: nowIso(), updatedAt: nowIso() };
  else delete s.postComments[c.id];
  changed();
  return { deleted: true };
}

export function reportContent(userId: string, body: Record<string, any>) {
  const targetType = body.targetType === 'comment' ? 'comment' : 'post';
  const reason = cleanText(body.reason, 100, 'Reason', true);
  const details = cleanText(body.details, 2000, 'Details', false);
  let reportedMemberId: string;
  let targetId: string;
  if (targetType === 'post') {
    const post = requireVisiblePost(body.targetId, userId);
    reportedMemberId = post.authorId;
    targetId = post.id;
  } else {
    const c = typeof body.targetId === 'string' ? (store().postComments[body.targetId] as CommentDoc | undefined) : undefined;
    if (!c || c.deletedAt) throw new SocialError(404, 'COMMENT_NOT_FOUND', 'That comment is no longer available.');
    requireVisiblePost(c.postId, userId);
    reportedMemberId = c.authorId;
    targetId = c.id;
  }
  if (reportedMemberId === userId) throw bad('You cannot report your own content');
  const duplicate = durableDb.getAbuseReports().some((r) => r.reporterId === userId && r.targetId === targetId && r.status === 'pending');
  if (duplicate) return { success: true, alreadyReported: true };
  const before = distinctReporters(targetType, targetId);
  const report = durableDb.submitContentReport(userId, reportedMemberId, targetType, targetId, reason, details);
  aggCache = null;
  if (before < LIMITS.autoHideReports && before + 1 >= LIMITS.autoHideReports) {
    const postId = targetType === 'post' ? targetId : (store().postComments[targetId] as CommentDoc).postId;
    const what = targetType === 'post' ? 'post' : 'comment';
    durableDb.addPostNotification(
      reportedMemberId,
      'moderation',
      postId,
      `Your ${what} is under review`,
      `Your ${what} was reported by several members and is hidden while a moderator reviews it. You can still see it.`
    );
  }
  return { success: true, reportId: report.id };
}

// ---------------------------------------------------------------------------
// Impressions & analytics
// ---------------------------------------------------------------------------
/**
 * Called by the client when a post has been at least half on screen for one second. One
 * document per (post, viewer): unique reach = number of documents; impressions = displays,
 * where repeat displays to the same member within 30 minutes count once. Authors' own views
 * and posts the viewer may not see are ignored.
 */
export function recordImpressions(viewerId: string, postIds: unknown) {
  if (!Array.isArray(postIds)) throw bad('postIds must be a list');
  const ids = [...new Set(postIds.filter((x): x is string => typeof x === 'string'))].slice(0, LIMITS.impressionBatch);
  const s = store();
  const v = viewerCtx(viewerId);
  const hidden = hiddenPostIds();
  const now = Date.now();
  let counted = 0;
  for (const id of ids) {
    const post = s.posts[id] as PostDoc | undefined;
    if (!canSee(post, v, hidden) || post.authorId === viewerId) continue;
    const key = pairKey(id, viewerId);
    const prev = s.postViews[key];
    if (!prev) {
      s.postViews[key] = { postId: id, viewerId, impressions: 1, firstAt: new Date(now).toISOString(), lastAt: new Date(now).toISOString() };
      counted++;
    } else if (now - Date.parse(prev.lastAt) >= LIMITS.impressionWindowMs) {
      s.postViews[key] = { ...prev, impressions: (prev.impressions || 0) + 1, lastAt: new Date(now).toISOString() };
      counted++;
    }
  }
  if (counted > 0) changed();
  return { counted };
}

export function postAnalytics(userId: string, postId: unknown) {
  const post = requireOwnPost(postId, userId);
  const agg = aggregates();
  const impressions = agg.impressions.get(post.id) ?? 0;
  const likes = agg.likes.get(post.id) ?? 0;
  const comments = agg.comments.get(post.id) ?? 0;
  const shares = agg.shares.get(post.id) ?? 0;
  const reposts = agg.reposts.get(post.id) ?? 0;
  const engagements = likes + comments + shares + reposts;
  const rateAvailable = impressions >= LIMITS.minImpressionsForRate;
  return {
    postId: post.id,
    measuredSince: post.createdAt,
    impressions,
    uniqueReach: agg.reach.get(post.id) ?? 0,
    likes,
    comments,
    shares,
    reposts,
    engagements,
    engagementRate: rateAvailable ? Math.round((engagements / impressions) * 1000) / 10 : null,
    engagementRateNote: rateAvailable ? null : `Shown once the post has ${LIMITS.minImpressionsForRate} impressions.`,
    definitions: {
      impressions: 'Times the post was at least half on screen for one second for a member other than you. Repeat views by the same member within 30 minutes count once.',
      uniqueReach: 'Distinct members (other than you) who were shown the post.',
      shares: 'Distinct members who copied or shared the link to the post.',
      reposts: 'Members who reposted the post to the feed (with or without commentary).',
      engagementRate: '(Likes + comments + shares + reposts) / impressions.',
    },
  };
}

// ---------------------------------------------------------------------------
// Feed & ranking
// ---------------------------------------------------------------------------
interface Signals {
  terms: Map<string, string>; // canonical -> display
  /** Whole-word patterns for the canonical form and the member's own wording, compiled once. */
  matchers: { canonical: string; display: string; patterns: RegExp[] }[];
  connections: Set<string>;
  engagedAuthors: Map<string, number>;
}

function viewerSignals(viewer: MemberProfile): Signals {
  const terms = new Map<string, string>();
  const add = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    const c = normalizeSkill(raw);
    if (c.length >= 2 && !terms.has(c)) terms.set(c, raw.trim());
  };
  try {
    const intel = getProfileIntelligence(viewer);
    intel.skills.forEach((s) => add(s.name));
    intel.technologies.forEach((t) => add(t.name));
    intel.interests.forEach(add);
    intel.intents.forEach(add);
  } catch {
    /* intelligence unavailable: fall back to raw profile fields below */
  }
  (viewer.skills || []).forEach(add);
  (viewer.aiSpecializations || []).forEach(add);
  (viewer.collaborationInterests || []).forEach(add);
  (viewer.contextTags || []).forEach(add);
  try {
    const dir: any = (toSelfMember(viewer) as any)?.tathastuProfile?.careerDirection;
    if (dir) {
      add(dir.label);
      for (const v of Object.values(dir)) if (Array.isArray(v)) v.forEach((x: any) => add(typeof x === 'string' ? x : x?.name ?? x?.skill));
    }
  } catch {
    /* career direction not available */
  }

  const connections = new Set<string>();
  for (const c of durableDb.getAllConnections()) {
    if (c.status !== 'accepted') continue;
    if (c.requesterId === viewer.id) connections.add(c.recipientId);
    else if (c.recipientId === viewer.id) connections.add(c.requesterId);
  }
  const s = store();
  const engagedAuthors = new Map<string, number>();
  const bump = (postId: string) => {
    const p = s.posts[postId] as PostDoc | undefined;
    if (p && p.authorId !== viewer.id) engagedAuthors.set(p.authorId, (engagedAuthors.get(p.authorId) ?? 0) + 1);
  };
  for (const l of Object.values(s.postLikes)) if (l.userId === viewer.id) bump(l.postId);
  for (const c of Object.values(s.postComments) as CommentDoc[]) if (c.authorId === viewer.id && !c.deletedAt) bump(c.postId);
  const matchers = [...terms].map(([canonical, display]) => ({
    canonical,
    display,
    patterns: [...new Set([canonical, display.toLowerCase()])]
      .filter((w) => w.length >= 3 || /[+#]/.test(w)) // too short to match safely in prose
      .map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, 'u')),
  }));
  return { terms, matchers, connections, engagedAuthors };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchedTerms(post: PostDoc, sig: Signals): string[] {
  const hits: string[] = [];
  const topics = new Set(post.topics);
  const hay = `${post.text}\n${post.project?.title ?? ''}\n${(post.project?.technologies ?? []).join(' ')}`.toLowerCase();
  for (const { canonical, display, patterns } of sig.matchers) {
    if (topics.has(canonical) || patterns.some((re) => re.test(hay))) hits.push(display);
    if (hits.length >= 4) break;
  }
  return hits;
}

interface Ranked {
  post: PostDoc;
  score: number;
  reason: string;
  outsideNetwork: boolean;
  newCreator: boolean;
}

function rankForYou(candidates: PostDoc[], viewer: MemberProfile, agg: Agg, now: number, sig: Signals): Ranked[] {
  const s = store();
  const scored: Ranked[] = candidates.map((post) => {
    const ageH = Math.max(0, (now - Date.parse(post.createdAt)) / 3_600_000);
    const freshness = Math.exp(-ageH / 48);
    const hits = matchedTerms(post.repostOfId ? ((s.posts[post.repostOfId] as PostDoc) ?? post) : post, sig);
    const relevance = Math.min(1, hits.length / 2);
    // Quality is engagement per member reached (smoothed), not raw totals, so a large audience
    // alone does not push a post up and a new post with little reach is not penalised.
    const engagement = (agg.likes.get(post.id) ?? 0) + 2 * (agg.comments.get(post.id) ?? 0) + 1.5 * (agg.reposts.get(post.id) ?? 0) + (agg.shares.get(post.id) ?? 0);
    const quality = Math.min(1, (engagement + 1) / ((agg.reach.get(post.id) ?? 0) + 8));
    const isOwn = post.authorId === viewer.id;
    const connected = sig.connections.has(post.authorId);
    const affinity = Math.min(1, (connected ? 0.5 : 0) + Math.min(0.5, (sig.engagedAuthors.get(post.authorId) ?? 0) * 0.15));
    const newCreator = !isOwn && (agg.postsByAuthor.get(post.authorId) ?? 0) <= 3;
    const outsideNetwork = !isOwn && !connected;
    const discovery = (newCreator ? 0.6 : 0) + (outsideNetwork ? 0.4 : 0);
    const kindBoost = post.kind === 'research' || post.kind === 'project' || post.kind === 'opportunity' ? 0.05 : 0;
    let score = 0.4 * relevance + 0.25 * freshness + 0.15 * quality + 0.1 * affinity + 0.1 * discovery + kindBoost;
    const seen = s.postViews[pairKey(post.id, viewer.id)]?.impressions ?? 0;
    if (seen >= 2) score *= 0.5;
    else if (seen === 1) score *= 0.8;
    if (isOwn) score *= ageH < 24 ? 1.2 : 0.6;
    const reason = isOwn
      ? 'Your post'
      : hits.length
        ? `Related to ${hits.slice(0, 2).join(' and ')}`
        : connected
          ? 'From your network'
          : newCreator
            ? 'New voice on Collaborate'
            : ageH < 24
              ? 'Recent on Collaborate'
              : 'Popular with members reached';
    return { post, score, reason, outsideNetwork, newCreator };
  });
  scored.sort((a, b) => b.score - a.score || b.post.createdAt.localeCompare(a.post.createdAt));

  // Diversity re-rank: no author twice within three slots, and every fourth slot goes to the best
  // remaining post from outside the viewer's network (exploration), when one exists.
  const out: Ranked[] = [];
  const pool = [...scored];
  while (pool.length) {
    const recentAuthors = new Set(out.slice(-3).map((r) => r.post.authorId));
    const wantExplore = out.length % 4 === 3;
    let idx = pool.findIndex((r) => !recentAuthors.has(r.post.authorId) && (!wantExplore || r.outsideNetwork));
    if (idx === -1) idx = pool.findIndex((r) => !recentAuthors.has(r.post.authorId));
    if (idx === -1) idx = 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function encodeCursor(c: { asOf: number; offset: number }) {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: unknown): { asOf: number; offset: number } | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Number.isFinite(c.asOf) && Number.isInteger(c.offset) && c.offset >= 0 && c.offset < 10_000) return c;
  } catch {
    /* invalid cursor */
  }
  throw bad('Invalid cursor');
}

export interface FeedQuery {
  filter?: unknown;
  cursor?: unknown;
  limit?: unknown;
  q?: unknown;
  authorId?: unknown;
}

export function getFeed(viewerId: string, query: FeedQuery) {
  const viewer = activeMember(viewerId);
  if (!viewer) throw new SocialError(401, 'INVALID_SESSION', 'Session expired or invalid');
  const filter: FeedFilter = typeof query.filter === 'string' && ([...FEED_FILTERS, 'saved', 'author'] as string[]).includes(query.filter) ? (query.filter as FeedFilter) : 'for_you';
  const limit = Math.min(LIMITS.maxPageSize, Math.max(1, Number(query.limit) || LIMITS.pageSize));
  const cursor = decodeCursor(query.cursor);
  const asOf = cursor?.asOf ?? Date.now();
  const offset = cursor?.offset ?? 0;
  const q = typeof query.q === 'string' ? query.q.trim().toLowerCase().slice(0, 100) : '';

  const s = store();
  const v = viewerCtx(viewerId);
  const hidden = hiddenPostIds();
  const agg = aggregates();

  let candidates = (Object.values(s.posts) as PostDoc[]).filter((p) => canSee(p, v, hidden) && Date.parse(p.createdAt) <= asOf);
  const kinds = FILTER_KINDS[filter];
  if (kinds) candidates = candidates.filter((p) => kinds.includes(p.kind) && !p.repostOfId);
  if (filter === 'saved') candidates = candidates.filter((p) => s.postBookmarks[pairKey(p.id, viewerId)]);
  if (filter === 'author') {
    if (typeof query.authorId !== 'string') throw bad('authorId is required');
    candidates = candidates.filter((p) => p.authorId === query.authorId);
  }
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
    candidates = candidates.filter((p) => {
      const hay = `${p.text} ${p.topics.join(' ')} ${p.project?.title ?? ''} ${durableDb.getMemberById(p.authorId)?.fullName ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t.replace(/^#/, '')));
    });
  }

  let ranking: 'personalized' | 'chronological' | 'chronological_fallback' = 'chronological';
  let ordered: { post: PostDoc; reason: string | null }[];
  if (filter === 'for_you') {
    const sig = viewerSignals(viewer);
    if (sig.terms.size === 0 && sig.connections.size === 0 && sig.engagedAuthors.size === 0) {
      ranking = 'chronological_fallback';
      ordered = candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((post) => ({ post, reason: null }));
    } else {
      ranking = 'personalized';
      // Rank the newest 600 visible posts; older posts remain reachable through Latest and filters.
      const pool = candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 600);
      ordered = rankForYou(pool, viewer, agg, asOf, sig).map((r) => ({ post: r.post, reason: r.reason }));
    }
  } else {
    ordered = candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((post) => ({ post, reason: null }));
  }

  const page = ordered.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    filter,
    ranking,
    posts: page.map(({ post, reason }) => ({ ...serializePost(post, viewerId, agg, v, hidden), reason })),
    nextCursor: nextOffset < ordered.length ? encodeCursor({ asOf, offset: nextOffset }) : null,
    total: ordered.length,
  };
}

/** Topics used by at least two different authors in the last 7 days. Empty when there are none. */
export function trendingTopics(viewerId: string, limit = 6) {
  const v = viewerCtx(viewerId);
  const hidden = hiddenPostIds();
  const since = Date.now() - 7 * 86_400_000;
  const authors = new Map<string, Set<string>>();
  const posts = new Map<string, number>();
  for (const p of Object.values(store().posts) as PostDoc[]) {
    if (!canSee(p, v, hidden) || Date.parse(p.createdAt) < since) continue;
    for (const t of p.topics) {
      if (!authors.has(t)) authors.set(t, new Set());
      authors.get(t)!.add(p.authorId);
      posts.set(t, (posts.get(t) ?? 0) + 1);
    }
  }
  return [...authors]
    .filter(([, a]) => a.size >= 2)
    .map(([topic, a]) => ({ topic, authors: a.size, posts: posts.get(topic) ?? 0 }))
    .sort((x, y) => y.authors - x.authors || y.posts - x.posts)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Moderation (admin only; the routes use requireAdmin). All state lives in shared documents
// (abuse_report, post / post_comment moderation marks, moderation_audit), so a decision taken on
// one API instance is seen by every other instance on its next request.
// ---------------------------------------------------------------------------
export const MODERATION_DECISIONS = ['dismiss', 'remove', 'restore'] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

function reportView(r: AbuseReport) {
  return {
    id: r.id,
    reporter: authorCard(r.reporterId),
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt,
    reviewedBy: r.reviewedBy ? authorCard(r.reviewedBy) : null,
    reviewedAt: r.reviewedAt ?? null,
    decision: r.decision ?? null,
    reviewNote: r.reviewNote ?? null,
  };
}

function targetDoc(targetType: 'post' | 'comment' | undefined, targetId: string | undefined): PostDoc | CommentDoc | undefined {
  if (!targetType || !targetId) return undefined;
  const s = store();
  return (targetType === 'post' ? s.posts[targetId] : s.postComments[targetId]) as PostDoc | CommentDoc | undefined;
}

/** Full content for moderators, including hidden and removed content (never shown to members). */
function adminContent(targetType: 'post' | 'comment' | undefined, targetId: string | undefined) {
  const doc = targetDoc(targetType, targetId);
  if (!targetType || !targetId) return { state: 'member_report' as const, content: null };
  if (!doc) return { state: 'missing' as const, content: null };
  const state = doc.deletedAt ? ('deleted_by_author' as const) : (moderationStateOf(targetType, doc) ?? ('visible' as const));
  const p = doc as PostDoc;
  return {
    state,
    content: {
      text: doc.text,
      author: authorCard(doc.authorId),
      createdAt: doc.createdAt,
      editedAt: doc.editedAt ?? null,
      postId: targetType === 'post' ? doc.id : (doc as CommentDoc).postId,
      ...(targetType === 'post' ? { kind: p.kind, attachments: p.attachments, project: p.project ?? null, poll: p.poll ?? null, repostOfId: p.repostOfId ?? null } : {}),
      moderation: doc.moderation ? { ...doc.moderation, by: authorCard(doc.moderation.by) } : null,
    },
  };
}

/**
 * Reports grouped by what was reported (one entry per post, comment or member), newest first.
 * status=pending (default): entries with at least one open report; reviewed: none open; all.
 */
export function listReportsForAdmin(query: { status?: unknown }) {
  const status = query.status === 'reviewed' || query.status === 'all' ? query.status : 'pending';
  const groups = new Map<string, AbuseReport[]>();
  for (const r of durableDb.getAbuseReports()) {
    const key = r.targetType && r.targetId ? `${r.targetType}:${r.targetId}` : `member:${r.reportedMemberId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const audit = Object.values(store().moderationAudit) as any[];
  const items = [...groups.values()]
    .map((reports) => {
      reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const first = reports[0];
      const open = reports.filter((r) => r.status === 'pending');
      const { state, content } = adminContent(first.targetType, first.targetId);
      const ids = new Set(reports.map((r) => r.id));
      return {
        targetType: first.targetType ?? 'member',
        targetId: first.targetId ?? first.reportedMemberId,
        reportedMember: authorCard(first.reportedMemberId),
        state,
        content,
        openReports: open.length,
        distinctReporters: new Set(open.map((r) => r.reporterId)).size,
        latestReportAt: first.createdAt,
        /** Use any of these ids with POST /api/admin/reports/:id; the decision applies to the content. */
        reports: reports.map(reportView),
        audit: audit
          .filter((a) => (first.targetId ? a.targetId === first.targetId : ids.has(a.reportId)))
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((a) => ({ ...a, reviewer: authorCard(a.reviewerId) })),
      };
    })
    .filter((g) => (status === 'all' ? true : status === 'pending' ? g.openReports > 0 : g.openReports === 0))
    .sort((a, b) => b.latestReportAt.localeCompare(a.latestReportAt));
  return { status, items, total: items.length };
}

/**
 * dismiss: close every open report on the content; it becomes visible again if it was auto-hidden.
 * remove:  hide the content from everyone but its author (content kept for audit/restore); close open reports.
 * restore: undo a removal or an auto-hide; close open reports.
 */
export function decideReport(adminId: string, reportId: unknown, body: Record<string, any>) {
  if (typeof reportId !== 'string') throw new SocialError(404, 'REPORT_NOT_FOUND', 'Report not found.');
  const report = durableDb.getAbuseReportById(reportId);
  if (!report) throw new SocialError(404, 'REPORT_NOT_FOUND', 'Report not found.');
  const decision = body.decision as ModerationDecision;
  if (!MODERATION_DECISIONS.includes(decision)) throw bad('decision must be dismiss, remove or restore');
  const note = cleanText(body.note, 1000, 'Note', false);

  const isContent = Boolean(report.targetType && report.targetId);
  if (!isContent && decision !== 'dismiss') {
    throw new SocialError(400, 'UNSUPPORTED_DECISION', 'Member reports can only be dismissed here; use account restrictions for members.');
  }
  const targetType = report.targetType;
  const doc = targetDoc(targetType, report.targetId);
  if (isContent && (!doc || doc.deletedAt) && decision !== 'dismiss') {
    throw new SocialError(409, 'CONTENT_GONE', 'The content was deleted by its author; the report can only be dismissed.');
  }

  const sameTarget = (r: AbuseReport) => (isContent ? r.targetType === targetType && r.targetId === report.targetId : r.id === report.id);
  const open = durableDb.getAbuseReports().filter((r) => sameTarget(r) && r.status === 'pending');
  const previousState = isContent && doc && !doc.deletedAt ? moderationStateOf(targetType!, doc) ?? 'visible' : report.status;

  if (decision === 'dismiss' && open.length === 0) throw new SocialError(409, 'ALREADY_REVIEWED', 'There are no open reports on this content.');
  if (decision === 'remove' && isRemoved(doc)) throw new SocialError(409, 'ALREADY_REMOVED', 'This content is already removed.');
  if (decision === 'restore' && previousState === 'visible') throw new SocialError(409, 'NOT_HIDDEN', 'This content is not hidden or removed.');

  const at = nowIso();
  const s = store();
  if (isContent && doc && !doc.deletedAt) {
    const coll = targetType === 'post' ? s.posts : s.postComments;
    if (decision === 'remove') coll[doc.id] = { ...doc, moderation: { state: 'removed', by: adminId, at, reportId: report.id } };
    else if (decision === 'restore' && doc.moderation) {
      const { moderation: _drop, ...rest } = doc;
      coll[doc.id] = rest;
    }
  }
  const closed = open.length ? open : decision === 'restore' ? [] : [report];
  for (const r of closed) {
    durableDb.updateAbuseReport({
      ...r,
      status: decision === 'remove' ? 'resolved' : 'dismissed',
      reviewedBy: adminId,
      reviewedAt: at,
      decision,
      ...(note ? { reviewNote: note } : {}),
    });
  }
  const newDoc = targetDoc(targetType, report.targetId);
  const newState = isContent && newDoc && !newDoc.deletedAt ? moderationStateOf(targetType!, newDoc) ?? 'visible' : decision === 'remove' ? 'resolved' : 'dismissed';
  const auditId = newId('modaudit');
  s.moderationAudit[auditId] = {
    id: auditId,
    reportId: report.id,
    affectedReportIds: closed.map((r) => r.id),
    targetType: targetType ?? 'member',
    targetId: report.targetId ?? report.reportedMemberId,
    reportedMemberId: report.reportedMemberId,
    decision,
    note: note || null,
    reviewerId: adminId,
    at,
    previousState,
    newState,
  };
  changed();

  // Tell the author what happened when it affects what others can see. Moderator notes are internal.
  if (isContent && doc && !doc.deletedAt) {
    const what = targetType === 'post' ? 'post' : 'comment';
    const postId = targetType === 'post' ? doc.id : (doc as CommentDoc).postId;
    if (decision === 'remove') {
      durableDb.addPostNotification(report.reportedMemberId, 'moderation', postId, `Your ${what} was removed`, `A moderator reviewed reports about your ${what} and removed it for breaking the community guidelines. Only you can still see it.`);
    } else if (previousState !== 'visible' && newState === 'visible') {
      durableDb.addPostNotification(report.reportedMemberId, 'moderation', postId, `Your ${what} is visible again`, `A moderator reviewed your ${what} and restored it. Everyone on Collaborate can see it again.`);
    }
  }
  return { success: true, decision, previousState, newState, auditId, closedReports: closed.map((r) => r.id) };
}

/** A single post for moderators, even when hidden or removed. */
export function getPostForAdmin(adminId: string, postId: unknown) {
  const post = typeof postId === 'string' ? (store().posts[postId] as PostDoc | undefined) : undefined;
  if (!post || post.deletedAt) throw notFound();
  return { ...serializeOne(post, adminId), moderation: moderationStateOf('post', post) };
}
