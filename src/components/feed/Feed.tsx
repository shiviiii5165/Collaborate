'use client';

/**
 * Collaborate social feed UI: composer, post cards, comments, analytics, and the feed list
 * (infinite scroll + impression tracking). Every number shown comes from the API; nothing is
 * mocked. Posts are public to all Collaborate members, so there is deliberately no audience
 * selector anywhere.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  CornerDownRight,
  Edit3,
  ExternalLink,
  FileText,
  Flag,
  FlaskConical,
  Folder,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PenSquare,
  Plus,
  Repeat2,
  Send,
  Share2,
  Sparkles,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Trophy,
  Video,
  X,
} from 'lucide-react';
import type { MemberProfile } from '@/lib/types';
import { IMPRESSION_DWELL_MS, IMPRESSION_FLUSH_INTERVAL_MS, IMPRESSION_VISIBLE_RATIO } from '@/modules/social/constants';
import { ACCEPT, formatBytes, precheck, uploadMedia, type UploadKind } from './mediaUpload';

// ---------------------------------------------------------------------------
// Types & API
// ---------------------------------------------------------------------------
export type PostKind = 'update' | 'project' | 'research' | 'question' | 'achievement' | 'opportunity' | 'poll';
type Attachment = { type: 'image' | 'video' | 'document' | 'link'; url: string; title?: string; mediaId?: string; fileName?: string; size?: number };
type DraftUpload = { localId: string; kind: UploadKind; fileName: string; progress: number; error?: string; controller: AbortController };
type Author = { id: string; fullName: string; headline: string; avatarUrl: string; isVerified: boolean } | null;

export interface FeedPost {
  id: string;
  kind: PostKind;
  text: string;
  topics: string[];
  attachments: Attachment[];
  project: { projectId?: string; title: string; url?: string; technologies: string[] } | null;
  poll: { options: { label: string; votes: number | null }[]; totalVotes: number | null; closesAt: string; closed: boolean; myVote: number | null } | null;
  repostOf: (FeedPost & { unavailable?: undefined }) | { unavailable: true } | null;
  author: Author;
  createdAt: string;
  editedAt: string | null;
  isAuthor: boolean;
  counts: { likes: number; comments: number; reposts: number; shares: number };
  viewer: { liked: boolean; bookmarked: boolean; reposted: boolean };
  reason?: string | null;
  /** Only present for the author: their post is hidden pending review or removed. */
  moderation?: 'hidden_pending_review' | 'removed' | null;
}

interface CommentItem {
  id: string;
  parentId: string | null;
  text: string;
  deleted: boolean;
  hidden?: boolean;
  moderation?: 'hidden_pending_review' | 'removed' | null;
  author: Author;
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  replies?: CommentItem[];
}

async function api<T = any>(url: string, method = 'GET', payload?: unknown): Promise<{ ok: boolean; status: number; data: T & { message?: string; error?: string } }> {
  try {
    const res = await fetch(url, {
      method,
      headers: payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: 'Network error. Check your connection and try again.' } as any };
  }
}

const errorText = (r: { status: number; data: { message?: string; error?: string } }, fallback: string) =>
  r.data?.message || (r.status === 0 ? 'Network error. Check your connection and try again.' : fallback);

const KIND_META: Record<PostKind, { label: string; icon: React.ReactNode; tone: string }> = {
  update: { label: 'Update', icon: <PenSquare size={14} />, tone: 'slate' },
  project: { label: 'Project', icon: <Folder size={14} />, tone: 'indigo' },
  research: { label: 'Research', icon: <FlaskConical size={14} />, tone: 'teal' },
  question: { label: 'Question', icon: <HelpCircle size={14} />, tone: 'amber' },
  achievement: { label: 'Milestone', icon: <Trophy size={14} />, tone: 'gold' },
  opportunity: { label: 'Opportunity', icon: <Briefcase size={14} />, tone: 'green' },
  poll: { label: 'Poll', icon: <ListChecks size={14} />, tone: 'violet' },
};

export const FEED_FILTERS: { id: string; label: string }[] = [
  { id: 'for_you', label: 'For You' },
  { id: 'latest', label: 'Latest' },
  { id: 'research', label: 'Research' },
  { id: 'projects', label: 'Projects' },
  { id: 'discussions', label: 'Discussions' },
  { id: 'opportunities', label: 'Opportunities' },
];

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Avatar({ author, size = 44 }: { author: Author; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initial = (author?.fullName || '?').trim().charAt(0).toUpperCase();
  if (!author?.avatarUrl || failed) {
    return (
      <div className="feed-avatar feed-avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
        {initial}
      </div>
    );
  }
  return <img className="feed-avatar" src={author.avatarUrl} alt="" width={size} height={size} onError={() => setFailed(true)} />;
}

/** Plain text with #topics highlighted. Never rendered as HTML. */
function RichText({ text, onTopic }: { text: string; onTopic?: (t: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 420;
  const shown = long && !expanded ? `${text.slice(0, 400).trimEnd()}…` : text;
  const parts = shown.split(/(#[\p{L}\p{N}][\p{L}\p{N}_+.-]{0,38})/u);
  return (
    <div className="feed-text">
      {parts.map((p, i) =>
        p.startsWith('#') && p.length > 1 ? (
          <button key={i} type="button" className="feed-hashtag" onClick={() => onTopic?.(p.slice(1))}>
            {p}
          </button>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
      {long && (
        <button type="button" className="feed-link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? ' Show less' : ' See more'}
        </button>
      )}
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Attachments({ items }: { items: Attachment[] }) {
  const images = items.filter((a) => a.type === 'image');
  const videos = items.filter((a) => a.type === 'video' && a.mediaId);
  const others = items.filter((a) => a.type !== 'image' && !(a.type === 'video' && a.mediaId));
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  return (
    <>
      {images.length > 0 && (
        <div className={`feed-images feed-images-${Math.min(images.length, 4)}`}>
          {images.map((a) =>
            broken[a.url] ? (
              <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="feed-image-broken">
                <ImageIcon size={18} /> Image unavailable{a.mediaId ? '' : ` · ${hostOf(a.url)}`}
              </a>
            ) : (
              <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                <img src={a.url} alt={a.title || 'Attached image'} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken((b) => ({ ...b, [a.url]: true }))} />
              </a>
            )
          )}
        </div>
      )}
      {videos.map((a) => (
        <video key={a.url} className="feed-video" src={a.url} controls preload="metadata" playsInline aria-label={a.title || a.fileName || 'Attached video'} />
      ))}
      {others.map((a) => (
        <a key={a.url} className="feed-attachment" href={a.url} target="_blank" rel="noopener noreferrer nofollow ugc">
          <span className="feed-attachment-icon">{a.type === 'video' ? <Video size={18} /> : a.type === 'document' ? <FileText size={18} /> : <Link2 size={18} />}</span>
          <span className="feed-attachment-body">
            <span className="feed-attachment-title">{a.title || a.fileName || (a.type === 'video' ? 'Video' : a.type === 'document' ? 'Document' : 'Link')}</span>
            <span className="feed-attachment-host">{a.mediaId ? ['PDF', formatBytes(a.size)].filter(Boolean).join(' · ') : hostOf(a.url)}</span>
          </span>
          <ExternalLink size={14} />
        </a>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
const COMPOSER_KINDS: PostKind[] = ['update', 'project', 'research', 'question', 'achievement', 'opportunity', 'poll'];
const PLACEHOLDER: Record<PostKind, string> = {
  update: 'Share what you are working on…',
  project: 'What did you build, and what do you need help with?',
  research: 'Share a paper, result or research question…',
  question: 'Ask the Collaborate community a question…',
  achievement: 'Share a milestone, award or certification…',
  opportunity: 'Describe the role, internship, collaboration or grant…',
  poll: 'Ask your poll question…',
};

export function Composer({
  currentUser,
  onPosted,
  repostOf,
  onCancel,
}: {
  currentUser: MemberProfile;
  onPosted: (p: FeedPost) => void;
  repostOf?: FeedPost;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(repostOf));
  const [kind, setKind] = useState<PostKind>('update');
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [linkDraft, setLinkDraft] = useState<{ type: Attachment['type']; url: string; title: string } | null>(null);
  const [uploads, setUploads] = useState<DraftUpload[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickKind = useRef<UploadKind>('image');
  const [projectId, setProjectId] = useState('');
  const [projectManual, setProjectManual] = useState({ title: '', url: '' });
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollDays, setPollDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const projects = currentUser.projects || [];
  const MAX = 3000;

  const releaseMedia = (a: Attachment) => {
    // An uploaded file removed from the draft is deleted now (the server's cleanup is the backstop).
    if (a.mediaId) fetch(`/api/media/${a.mediaId}`, { method: 'DELETE' }).catch(() => undefined);
  };

  const reset = (opts: { published?: boolean } = {}) => {
    if (!opts.published) attachments.forEach(releaseMedia);
    uploads.forEach((u) => u.controller.abort());
    setUploads([]);
    setText('');
    setAttachments([]);
    setLinkDraft(null);
    setProjectId('');
    setProjectManual({ title: '', url: '' });
    setPollOptions(['', '']);
    setKind('update');
    setError('');
  };

  const addLink = () => {
    if (!linkDraft) return;
    const url = linkDraft.url.trim();
    if (!/^https:\/\//i.test(url)) {
      setError('Links must start with https://');
      return;
    }
    if (attachments.length >= 4) {
      setError('At most 4 attachments per post.');
      return;
    }
    setAttachments((a) => [...a, { type: linkDraft.type, url, ...(linkDraft.title.trim() ? { title: linkDraft.title.trim() } : {}) }]);
    setLinkDraft(null);
    setError('');
  };

  const activeUploads = uploads.filter((u) => !u.error);
  const slotsLeft = 4 - attachments.length - activeUploads.length;

  const startUpload = async (file: File, kind: UploadKind) => {
    const problem = precheck(file, kind);
    if (problem) return setError(problem);
    if (slotsLeft <= 0) return setError('At most 4 attachments per post.');
    setError('');
    const u: DraftUpload = { localId: `${Date.now()}-${Math.random()}`, kind, fileName: file.name, progress: 0, controller: new AbortController() };
    setUploads((list) => [...list, u]);
    const patch = (p: Partial<DraftUpload>) => setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, ...p } : x)));
    try {
      const m = await uploadMedia(file, kind, (progress) => patch({ progress }), u.controller.signal);
      setUploads((list) => list.filter((x) => x.localId !== u.localId));
      setAttachments((a) => [...a, { type: m.kind, url: m.url, mediaId: m.id, fileName: m.fileName, size: m.size }]);
    } catch (e: any) {
      if (e?.code === 'ABORTED') return setUploads((list) => list.filter((x) => x.localId !== u.localId));
      if (e?.code === 'MEDIA_NOT_CONFIGURED') {
        setUploads((list) => list.filter((x) => x.localId !== u.localId));
        setLinkDraft({ type: kind, url: '', title: '' });
        return setError('File uploads are not available right now. You can attach a link instead.');
      }
      patch({ error: e?.message || 'The file could not be uploaded.' });
    }
  };

  const submit = async () => {
    setError('');
    if (activeUploads.length > 0) return setError('Wait for your uploads to finish before posting.');
    if (!repostOf && kind !== 'poll' && !text.trim()) return setError('Write something before posting.');
    if (text.length > MAX) return setError(`Posts can be at most ${MAX} characters.`);
    const payload: Record<string, unknown> = { text };
    if (repostOf) payload.repostOfId = repostOf.id;
    else {
      payload.kind = kind;
      payload.attachments = attachments.map((a) => (a.mediaId ? { type: a.type, mediaId: a.mediaId, ...(a.title ? { title: a.title } : {}) } : a));
      if (kind === 'project') {
        if (projectId) payload.project = { projectId };
        else if (projectManual.title.trim()) payload.project = { title: projectManual.title.trim(), url: projectManual.url.trim() || undefined };
        else return setError('Pick a project from your profile or name the project.');
      }
      if (kind === 'poll') {
        if (!text.trim()) return setError('Ask a question for your poll.');
        const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
        if (opts.length < 2) return setError('A poll needs at least two options.');
        payload.poll = { options: opts, durationDays: pollDays };
      }
    }
    setBusy(true);
    const r = await api<{ post: FeedPost }>('/api/posts', 'POST', payload);
    setBusy(false);
    if (!r.ok) return setError(errorText(r, 'Your post could not be published. Please try again.'));
    onPosted(r.data.post);
    reset({ published: true });
    if (repostOf) onCancel?.();
    else setOpen(false);
  };

  if (!open && !repostOf) {
    return (
      <div className="feed-card feed-composer-collapsed">
        <Avatar author={{ id: currentUser.id, fullName: currentUser.fullName, headline: '', avatarUrl: currentUser.avatarUrl, isVerified: false }} />
        <button type="button" className="feed-composer-trigger" onClick={() => setOpen(true)}>
          Start a post, share research or ask a question…
        </button>
        <div className="feed-composer-quick">
          {(['project', 'research', 'question', 'poll'] as PostKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`feed-quick feed-tone-${KIND_META[k].tone}`}
              onClick={() => {
                setKind(k);
                setOpen(true);
              }}
            >
              {KIND_META[k].icon}
              <span>{KIND_META[k].label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`feed-card feed-composer ${repostOf ? 'feed-composer-repost' : ''}`}>
      <div className="feed-composer-head">
        <Avatar author={{ id: currentUser.id, fullName: currentUser.fullName, headline: '', avatarUrl: currentUser.avatarUrl, isVerified: false }} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="feed-author-name">{currentUser.fullName}</div>
          <div className="feed-public-note">
            <Globe size={12} /> Visible to everyone on Collaborate
          </div>
        </div>
        <button
          type="button"
          className="feed-icon-btn"
          aria-label="Close composer"
          onClick={() => {
            reset();
            if (repostOf) onCancel?.();
            else setOpen(false);
          }}
        >
          <X size={18} />
        </button>
      </div>

      {!repostOf && (
        <div className="feed-kind-row" role="radiogroup" aria-label="Post type">
          {COMPOSER_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`feed-kind-chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
              {KIND_META[k].icon}
              <span>{KIND_META[k].label}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        className="feed-textarea"
        value={text}
        maxLength={MAX + 200}
        autoFocus
        placeholder={repostOf ? 'Add your thoughts (optional)…' : PLACEHOLDER[kind]}
        onChange={(e) => setText(e.target.value)}
        rows={repostOf ? 3 : 5}
        aria-label="Post text"
      />
      <div className={`feed-char-count ${text.length > MAX ? 'over' : ''}`}>
        {text.length}/{MAX} · add topics with #hashtags
      </div>

      {repostOf && <RepostEmbed post={repostOf} />}

      {!repostOf && kind === 'project' && (
        <div className="feed-subform">
          <label className="feed-label">Project</label>
          {projects.length > 0 && (
            <select className="feed-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Describe a project below —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          {!projectId && (
            <div className="feed-subform-row">
              <input className="feed-input" placeholder="Project name" value={projectManual.title} maxLength={140} onChange={(e) => setProjectManual((p) => ({ ...p, title: e.target.value }))} />
              <input className="feed-input" placeholder="https:// link (optional)" value={projectManual.url} onChange={(e) => setProjectManual((p) => ({ ...p, url: e.target.value }))} />
            </div>
          )}
        </div>
      )}

      {!repostOf && kind === 'poll' && (
        <div className="feed-subform">
          <label className="feed-label">Options</label>
          {pollOptions.map((o, i) => (
            <div key={i} className="feed-subform-row">
              <input
                className="feed-input"
                placeholder={`Option ${i + 1}`}
                value={o}
                maxLength={80}
                onChange={(e) => setPollOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {pollOptions.length > 2 && (
                <button type="button" className="feed-icon-btn" aria-label={`Remove option ${i + 1}`} onClick={() => setPollOptions((opts) => opts.filter((_, j) => j !== i))}>
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
          <div className="feed-subform-row">
            {pollOptions.length < 4 && (
              <button type="button" className="feed-link-btn" onClick={() => setPollOptions((o) => [...o, ''])}>
                <Plus size={14} /> Add option
              </button>
            )}
            <select className="feed-input feed-input-sm" value={pollDays} onChange={(e) => setPollDays(Number(e.target.value))} aria-label="Poll duration">
              {[1, 3, 7, 14].map((d) => (
                <option key={d} value={d}>
                  Runs {d} day{d > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!repostOf && attachments.length > 0 && (
        <div className="feed-draft-attachments">
          {attachments.map((a, i) => (
            <span key={a.url} className="feed-draft-chip">
              {a.type === 'image' ? <ImageIcon size={13} /> : a.type === 'video' ? <Video size={13} /> : a.type === 'document' ? <FileText size={13} /> : <Link2 size={13} />}
              <span>{a.title || a.fileName || hostOf(a.url)}</span>
              {a.mediaId && a.size ? <span className="feed-draft-size">{formatBytes(a.size)}</span> : null}
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => {
                  releaseMedia(a);
                  setAttachments((x) => x.filter((_, j) => j !== i));
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {!repostOf && uploads.length > 0 && (
        <div className="feed-draft-attachments">
          {uploads.map((u) => (
            <span key={u.localId} className={`feed-draft-chip feed-upload-chip ${u.error ? 'failed' : ''}`} title={u.error || u.fileName}>
              {u.kind === 'image' ? <ImageIcon size={13} /> : u.kind === 'video' ? <Video size={13} /> : <FileText size={13} />}
              <span>{u.fileName}</span>
              {u.error ? (
                <span className="feed-upload-error">{u.error}</span>
              ) : (
                <span className="feed-upload-progress" role="progressbar" aria-label={`Uploading ${u.fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
                  <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
                </span>
              )}
              <button
                type="button"
                aria-label={u.error ? 'Dismiss' : 'Cancel upload'}
                onClick={() => {
                  u.controller.abort();
                  setUploads((list) => list.filter((x) => x.localId !== u.localId));
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {!repostOf && linkDraft && (
        <div className="feed-subform">
          <label className="feed-label">Attach a {linkDraft.type} by link</label>
          <div className="feed-subform-row">
            <input className="feed-input" placeholder="https://…" value={linkDraft.url} autoFocus onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })} />
            <input className="feed-input" placeholder="Title (optional)" value={linkDraft.title} maxLength={140} onChange={(e) => setLinkDraft({ ...linkDraft, title: e.target.value })} />
          </div>
          <div className="feed-subform-row">
            <button type="button" className="btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 14px' }} onClick={addLink}>
              Attach
            </button>
            <button type="button" className="feed-link-btn" onClick={() => setLinkDraft(null)}>
              Cancel
            </button>
          </div>
          <div className="feed-hint">Paste a public https link (for example from GitHub, Google Drive, YouTube or arXiv).</div>
        </div>
      )}

      {error && (
        <div className="feed-error" role="alert">
          {error}
        </div>
      )}

      <div className="feed-composer-foot">
        {!repostOf ? (
          <div className="feed-attach-row">
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) startUpload(file, pickKind.current);
              }}
            />
            {(
              [
                ['image', <ImageIcon key="i" size={17} />, 'Image'],
                ['video', <Video key="v" size={17} />, 'Video'],
                ['document', <FileText key="d" size={17} />, 'Document'],
              ] as const
            ).map(([type, icon, label]) => (
              <button
                key={type}
                type="button"
                className="feed-icon-btn"
                title={`Upload ${label.toLowerCase()} (${ACCEPT[type].label})`}
                aria-label={`Upload ${label.toLowerCase()}`}
                disabled={slotsLeft <= 0}
                onClick={() => {
                  pickKind.current = type;
                  if (fileInput.current) {
                    fileInput.current.accept = ACCEPT[type].mime.join(',');
                    fileInput.current.click();
                  }
                }}
              >
                {icon}
              </button>
            ))}
            <button
              type="button"
              className="feed-icon-btn"
              title="Attach a link"
              aria-label="Attach a link"
              disabled={slotsLeft <= 0}
              onClick={() => setLinkDraft({ type: 'link', url: '', title: '' })}
            >
              <Link2 size={17} />
            </button>
          </div>
        ) : (
          <span />
        )}
        <button type="button" className="btn-primary" disabled={busy || activeUploads.length > 0} onClick={submit} aria-busy={busy}>
          {busy ? <Loader2 size={15} className="feed-spin" /> : repostOf ? <Repeat2 size={15} /> : <Send size={15} />}
          <span>{busy ? 'Publishing…' : repostOf ? 'Repost' : 'Post'}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post card pieces
// ---------------------------------------------------------------------------
function RepostEmbed({ post }: { post: FeedPost }) {
  return (
    <div className="feed-embed">
      <div className="feed-embed-head">
        <Avatar author={post.author} size={24} />
        <strong>{post.author?.fullName}</strong>
        <span className="feed-muted">· {timeAgo(post.createdAt)}</span>
      </div>
      {post.text && <RichText text={post.text} />}
      {post.project && <ProjectBlock project={post.project} />}
      {post.attachments.length > 0 && <Attachments items={post.attachments} />}
    </div>
  );
}

function ProjectBlock({ project }: { project: NonNullable<FeedPost['project']> }) {
  return (
    <div className="feed-project">
      <div className="feed-project-icon">
        <Folder size={18} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="feed-project-title">{project.title}</div>
        {project.technologies.length > 0 && (
          <div className="feed-tags">
            {project.technologies.slice(0, 6).map((t) => (
              <span key={t} className="feed-tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {project.url && (
        <a className="btn-secondary feed-project-link" href={project.url} target="_blank" rel="noopener noreferrer nofollow ugc">
          View <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

function PollBlock({ post, onUpdate }: { post: FeedPost; onUpdate: (p: FeedPost) => void }) {
  const poll = post.poll!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const showResults = poll.totalVotes !== null;
  const vote = async (option: number) => {
    if (busy || poll.closed) return;
    setBusy(true);
    setError('');
    const r = await api<{ post: FeedPost }>(`/api/posts/${post.id}/vote`, 'POST', { option });
    setBusy(false);
    if (r.ok) onUpdate(r.data.post);
    else setError(errorText(r, 'Your vote could not be saved.'));
  };
  return (
    <div className="feed-poll">
      {poll.options.map((o, i) => {
        const pct = showResults && poll.totalVotes ? Math.round(((o.votes ?? 0) / poll.totalVotes) * 100) : 0;
        return (
          <button key={i} type="button" className={`feed-poll-option ${poll.myVote === i ? 'mine' : ''}`} disabled={busy || poll.closed} onClick={() => vote(i)}>
            {showResults && <span className="feed-poll-bar" style={{ width: `${pct}%` }} />}
            <span className="feed-poll-label">{o.label}</span>
            {showResults && <span className="feed-poll-pct">{pct}%</span>}
          </button>
        );
      })}
      <div className="feed-muted feed-poll-meta">
        {showResults ? `${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}` : 'Vote to see results'} ·{' '}
        {poll.closed ? 'Poll closed' : `Closes ${new Date(poll.closesAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
        {poll.myVote !== null && !poll.closed && ' · You can change your vote'}
      </div>
      {error && <div className="feed-error">{error}</div>}
    </div>
  );
}

function CommentRow({
  c,
  postId,
  onChanged,
  onReply,
  onViewProfile,
}: {
  c: CommentItem;
  postId: string;
  onChanged: () => void;
  onReply?: (c: CommentItem) => void;
  onViewProfile: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    const r = await api(`/api/comments/${c.id}`, 'PUT', { text: draft });
    setBusy(false);
    if (!r.ok) return setError(errorText(r, 'Could not save your edit.'));
    setEditing(false);
    onChanged();
  };
  const remove = async () => {
    if (!confirm('Delete this comment?')) return;
    const r = await api(`/api/comments/${c.id}`, 'DELETE');
    if (!r.ok) return setError(errorText(r, 'Could not delete the comment.'));
    onChanged();
  };
  const report = async () => {
    const reason = prompt('Why are you reporting this comment? (e.g. spam, harassment)');
    if (!reason?.trim()) return;
    const r = await api(`/api/comments/${c.id}/report`, 'POST', { reason: reason.trim().slice(0, 100) });
    alert(r.ok ? 'Thanks — our moderators will review this comment.' : errorText(r, 'Could not send the report.'));
  };
  if (c.deleted) {
    return <div className="feed-comment feed-comment-deleted">This comment was deleted.</div>;
  }
  if (c.hidden) {
    return <div className="feed-comment feed-comment-deleted">This comment is hidden by moderation.</div>;
  }
  return (
    <div className="feed-comment">
      <button type="button" className="feed-plain" onClick={() => c.author && onViewProfile(c.author.id)} aria-label={`View ${c.author?.fullName}`}>
        <Avatar author={c.author} size={32} />
      </button>
      <div className="feed-comment-body">
        <div className="feed-comment-bubble">
          <div className="feed-comment-head">
            <button type="button" className="feed-plain feed-author-name" onClick={() => c.author && onViewProfile(c.author.id)}>
              {c.author?.fullName}
            </button>
            <span className="feed-muted">
              {timeAgo(c.createdAt)}
              {c.editedAt ? ' · edited' : ''}
            </span>
          </div>
          {editing ? (
            <>
              <textarea className="feed-textarea feed-textarea-sm" value={draft} maxLength={1500} onChange={(e) => setDraft(e.target.value)} rows={2} />
              <div className="feed-subform-row">
                <button type="button" className="btn-primary feed-btn-sm" disabled={busy || !draft.trim()} onClick={save}>
                  Save
                </button>
                <button type="button" className="feed-link-btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="feed-text feed-comment-text">{c.text}</div>
          )}
          {c.moderation && (
            <div className="feed-moderation feed-moderation-sm">
              <Flag size={11} /> {c.moderation === 'removed' ? 'Removed by a moderator. Only you can see it.' : 'Hidden from others while a moderator reviews it.'}
            </div>
          )}
        </div>
        <div className="feed-comment-actions">
          {onReply && (
            <button type="button" className="feed-link-btn" onClick={() => onReply(c)}>
              Reply
            </button>
          )}
          {c.canEdit && !editing && (
            <button type="button" className="feed-link-btn" onClick={() => { setDraft(c.text); setEditing(true); }}>
              Edit
            </button>
          )}
          {c.canDelete && (
            <button type="button" className="feed-link-btn" onClick={remove}>
              Delete
            </button>
          )}
          {!c.canEdit && (
            <button type="button" className="feed-link-btn" onClick={report}>
              Report
            </button>
          )}
        </div>
        {error && <div className="feed-error">{error}</div>}
      </div>
    </div>
  );
}

function Comments({ post, onCount, onViewProfile }: { post: FeedPost; onCount: (n: number) => void; onViewProfile: (id: string) => void }) {
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ comments: CommentItem[] }>(`/api/posts/${post.id}/comments`);
    if (!r.ok) return setLoadError(errorText(r, 'Comments could not be loaded.'));
    setItems(r.data.comments);
    setLoadError('');
    const n = r.data.comments.reduce((acc, c) => acc + (c.deleted ? 0 : 1) + (c.replies || []).filter((x) => !x.deleted).length, 0);
    onCount(n);
  }, [post.id, onCount]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    const r = await api(`/api/posts/${post.id}/comments`, 'POST', { text, parentId: replyTo?.id });
    setBusy(false);
    if (!r.ok) return setError(errorText(r, 'Your comment could not be posted.'));
    setText('');
    setReplyTo(null);
    load();
  };

  return (
    <div className="feed-comments">
      <div className="feed-comment-composer">
        {replyTo && (
          <div className="feed-replying">
            <CornerDownRight size={13} /> Replying to {replyTo.author?.fullName}
            <button type="button" className="feed-link-btn" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </div>
        )}
        <div className="feed-subform-row">
          <textarea
            ref={inputRef}
            className="feed-textarea feed-textarea-sm"
            placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
            value={text}
            maxLength={1500}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Comment"
          />
          <button type="button" className="btn-primary feed-btn-sm" disabled={busy || !text.trim()} onClick={submit} aria-label="Post comment">
            {busy ? <Loader2 size={14} className="feed-spin" /> : <Send size={14} />}
          </button>
        </div>
        {error && <div className="feed-error">{error}</div>}
      </div>
      {loadError && <div className="feed-error">{loadError}</div>}
      {items === null && !loadError && <div className="feed-muted feed-pad">Loading comments…</div>}
      {items?.length === 0 && <div className="feed-muted feed-pad">No comments yet. Start the conversation.</div>}
      {items?.map((c) => (
        <div key={c.id}>
          <CommentRow
            c={c}
            postId={post.id}
            onChanged={load}
            onViewProfile={onViewProfile}
            onReply={(target) => {
              setReplyTo(target);
              inputRef.current?.focus();
            }}
          />
          {(c.replies || []).length > 0 && (
            <div className="feed-replies">
              {c.replies!.map((r) => (
                <CommentRow
                  key={r.id}
                  c={r}
                  postId={post.id}
                  onChanged={load}
                  onViewProfile={onViewProfile}
                  onReply={(target) => {
                    setReplyTo(target);
                    inputRef.current?.focus();
                  }}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AnalyticsModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/api/posts/${postId}/analytics`).then((r) => (r.ok ? setData(r.data) : setError(errorText(r, 'Analytics could not be loaded.'))));
  }, [postId]);
  const metrics: [string, string, React.ReactNode][] = data
    ? [
        ['impressions', 'Impressions', data.impressions],
        ['uniqueReach', 'Unique reach', data.uniqueReach],
        ['likes', 'Likes', data.likes],
        ['comments', 'Comments', data.comments],
        ['shares', 'Shares', data.shares],
        ['reposts', 'Reposts', data.reposts],
        ['engagementRate', 'Engagement rate', data.engagementRate === null ? '—' : `${data.engagementRate}%`],
      ]
    : [];
  return (
    <div className="feed-modal-backdrop" role="dialog" aria-modal="true" aria-label="Post analytics" onClick={onClose}>
      <div className="feed-modal" onClick={(e) => e.stopPropagation()}>
        <div className="feed-modal-head">
          <BarChart3 size={18} color="var(--primary)" />
          <h3>Post analytics</h3>
          <button type="button" className="feed-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {error && <div className="feed-error">{error}</div>}
        {!data && !error && <div className="feed-muted feed-pad">Loading…</div>}
        {data && (
          <>
            <div className="feed-metrics">
              {metrics.map(([key, label, value]) => (
                <div key={key} className="feed-metric" title={data.definitions[key] || ''}>
                  <div className="feed-metric-value">{value}</div>
                  <div className="feed-metric-label">{label}</div>
                </div>
              ))}
            </div>
            {data.engagementRateNote && <div className="feed-hint">Engagement rate: {data.engagementRateNote}</div>}
            <details className="feed-definitions">
              <summary>How these are measured</summary>
              <ul>
                {Object.entries(data.definitions).map(([k, v]) => (
                  <li key={k}>
                    <strong>{metrics.find((m) => m[0] === k)?.[1] ?? k}:</strong> {String(v)}
                  </li>
                ))}
              </ul>
              <div className="feed-hint">Measured since the post was published ({new Date(data.measuredSince).toLocaleString()}).</div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post card
// ---------------------------------------------------------------------------
export function PostCard({
  post,
  currentUser,
  onChange,
  onRemove,
  onPosted,
  onViewProfile,
  onTopic,
  startWithComments = false,
}: {
  post: FeedPost;
  currentUser: MemberProfile;
  onChange: (p: FeedPost) => void;
  onRemove: (id: string) => void;
  onPosted: (p: FeedPost) => void;
  onViewProfile: (id: string) => void;
  onTopic?: (t: string) => void;
  startWithComments?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [repostMenu, setRepostMenu] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [showComments, setShowComments] = useState(startWithComments);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.text);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [analytics, setAnalytics] = useState(false);
  const meta = KIND_META[post.kind];
  const original = post.repostOf && !('unavailable' in post.repostOf && post.repostOf.unavailable) ? (post.repostOf as FeedPost) : null;
  const target = original ?? post; // engagement on a plain repost goes to the original
  const isPlainRepost = Boolean(post.repostOf) && !post.text;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const patchTarget = (fn: (p: FeedPost) => FeedPost) => {
    if (original && isPlainRepost) onChange({ ...post, repostOf: fn(original) });
    else onChange(fn(post));
  };

  const toggleLike = async () => {
    const liked = !target.viewer.liked;
    const before = target;
    // Optimistic, rolled back if the server refuses.
    patchTarget((p) => ({ ...p, viewer: { ...p.viewer, liked }, counts: { ...p.counts, likes: p.counts.likes + (liked ? 1 : -1) } }));
    const r = await api<{ liked: boolean; likes: number }>(`/api/posts/${target.id}/like`, 'POST', { liked });
    if (r.ok) patchTarget((p) => ({ ...p, viewer: { ...p.viewer, liked: r.data.liked }, counts: { ...p.counts, likes: r.data.likes } }));
    else {
      patchTarget(() => before);
      flash(errorText(r, 'Could not save your like.'));
    }
  };

  const toggleBookmark = async () => {
    const bookmarked = !target.viewer.bookmarked;
    const before = target;
    patchTarget((p) => ({ ...p, viewer: { ...p.viewer, bookmarked } }));
    const r = await api(`/api/posts/${target.id}/bookmark`, 'POST', { bookmarked });
    if (!r.ok) {
      patchTarget(() => before);
      flash(errorText(r, 'Could not update your saved posts.'));
    } else flash(bookmarked ? 'Saved. Find it under Saved.' : 'Removed from Saved.');
  };

  const share = async () => {
    const url = `${window.location.origin}/?post=${encodeURIComponent(target.id)}`;
    let copied = false;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Post on Collaborate', url });
        copied = true;
      } else {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) return flash(`Copy this link: ${url}`);
    const r = await api<{ shares: number }>(`/api/posts/${target.id}/share`, 'POST');
    if (r.ok) patchTarget((p) => ({ ...p, counts: { ...p.counts, shares: r.data.shares } }));
    flash('Link copied. Anyone on Collaborate can open it.');
  };

  const repostNow = async () => {
    setRepostMenu(false);
    const r = await api<{ post: FeedPost }>('/api/posts', 'POST', { repostOfId: target.id });
    if (!r.ok) return flash(errorText(r, 'Could not repost.'));
    patchTarget((p) => ({ ...p, viewer: { ...p.viewer, reposted: true }, counts: { ...p.counts, reposts: p.counts.reposts + 1 } }));
    onPosted(r.data.post);
    flash('Reposted to the feed.');
  };

  const saveEdit = async () => {
    setBusy(true);
    const r = await api<{ post: FeedPost }>(`/api/posts/${post.id}`, 'PUT', { text: draft });
    setBusy(false);
    if (!r.ok) return flash(errorText(r, 'Could not save your edit.'));
    onChange({ ...r.data.post, reason: post.reason });
    setEditing(false);
  };

  const remove = async () => {
    setMenuOpen(false);
    if (!confirm('Delete this post? Its likes, comments and saves will be removed too.')) return;
    const r = await api(`/api/posts/${post.id}`, 'DELETE');
    if (!r.ok) return flash(errorText(r, 'Could not delete the post.'));
    onRemove(post.id);
  };

  const report = async () => {
    setMenuOpen(false);
    const reason = prompt('Why are you reporting this post? (e.g. spam, harassment, misleading)');
    if (!reason?.trim()) return;
    const r = await api(`/api/posts/${post.id}/report`, 'POST', { reason: reason.trim().slice(0, 100) });
    flash(r.ok ? 'Thanks — our moderators will review this post.' : errorText(r, 'Could not send the report.'));
  };

  // Stable callback (a ref to the latest patcher) so liking or saving does not reload comments.
  const patchRef = useRef(patchTarget);
  patchRef.current = patchTarget;
  const onCommentCount = useCallback(
    (n: number) => patchRef.current((p) => (p.counts.comments === n ? p : { ...p, counts: { ...p.counts, comments: n } })),
    []
  );

  const shown = isPlainRepost && original ? original : post;

  return (
    <article className="feed-card feed-post" data-post-id={post.id} aria-label={`Post by ${post.author?.fullName}`}>
      {post.repostOf && (
        <div className="feed-repost-banner">
          <Repeat2 size={14} />
          <button type="button" className="feed-plain" onClick={() => post.author && onViewProfile(post.author.id)}>
            {post.isAuthor ? 'You' : post.author?.fullName}
          </button>{' '}
          reposted{post.text ? ' with thoughts' : ''}
        </div>
      )}
      <header className="feed-post-head">
        <button type="button" className="feed-plain" onClick={() => shown.author && onViewProfile(shown.author.id)} aria-label={`View ${shown.author?.fullName}`}>
          <Avatar author={shown.author} />
        </button>
        <div className="feed-post-who">
          <div className="feed-post-name-row">
            <button type="button" className="feed-plain feed-author-name" onClick={() => shown.author && onViewProfile(shown.author.id)}>
              {shown.author?.fullName}
            </button>
            {shown.author?.isVerified && <span className="feed-verified">✓ Verified</span>}
          </div>
          {shown.author?.headline && <div className="feed-headline">{shown.author.headline}</div>}
          <div className="feed-muted">
            {timeAgo(shown.createdAt)}
            {shown.editedAt ? ' · edited' : ''} · <Globe size={11} style={{ verticalAlign: '-1px' }} aria-label="Public" />
          </div>
        </div>
        <div className="feed-post-badges">
          {!post.repostOf && post.kind !== 'update' && (
            <span className={`feed-kind-badge feed-tone-${meta.tone}`}>
              {meta.icon}
              {meta.label}
            </span>
          )}
          <div className="feed-menu-wrap">
            <button type="button" className="feed-icon-btn" aria-label="Post options" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div className="feed-menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                {post.isAuthor ? (
                  <>
                    {!post.repostOf || post.text ? (
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDraft(post.text); setEditing(true); }}>
                        <Edit3 size={14} /> Edit post
                      </button>
                    ) : null}
                    {!post.repostOf && (
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setAnalytics(true); }}>
                        <BarChart3 size={14} /> View analytics
                      </button>
                    )}
                    <button type="button" role="menuitem" className="danger" onClick={remove}>
                      <Trash2 size={14} /> {post.repostOf ? 'Undo repost' : 'Delete post'}
                    </button>
                  </>
                ) : (
                  <button type="button" role="menuitem" onClick={report}>
                    <Flag size={14} /> Report post
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {post.moderation && (
        <div className="feed-moderation" role="status">
          <Flag size={13} />
          {post.moderation === 'removed'
            ? 'A moderator removed this post. Only you can see it.'
            : 'This post was reported and is hidden from others while a moderator reviews it.'}
        </div>
      )}
      {post.reason && <div className="feed-reason"><Sparkles size={12} /> {post.reason}</div>}

      {editing ? (
        <div className="feed-subform">
          <textarea className="feed-textarea" value={draft} maxLength={3200} rows={4} onChange={(e) => setDraft(e.target.value)} aria-label="Edit post" />
          <div className="feed-subform-row">
            <button type="button" className="btn-primary feed-btn-sm" disabled={busy || (!post.repostOf && !draft.trim())} onClick={saveEdit}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="feed-link-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        shown.text && <RichText text={shown.text} onTopic={onTopic} />
      )}

      {!isPlainRepost && post.repostOf && (original ? <RepostEmbed post={original} /> : <div className="feed-embed feed-muted">This post is no longer available.</div>)}
      {isPlainRepost && !original && <div className="feed-embed feed-muted">This post is no longer available.</div>}

      {shown.project && <ProjectBlock project={shown.project} />}
      {shown.poll && <PollBlock post={shown} onUpdate={(p) => (shown === post ? onChange({ ...p, reason: post.reason }) : patchTarget(() => p))} />}
      {shown.attachments.length > 0 && <Attachments items={shown.attachments} />}
      {shown.topics.length > 0 && !shown.text.includes('#') && (
        <div className="feed-tags">
          {shown.topics.map((t) => (
            <button key={t} type="button" className="feed-tag feed-tag-btn" onClick={() => onTopic?.(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {(isPlainRepost ? Boolean(original) : true) && (
        <>
          <div className="feed-counts">
            <span>{target.counts.likes > 0 ? `${target.counts.likes} like${target.counts.likes === 1 ? '' : 's'}` : ''}</span>
            <span className="feed-counts-right">
              {target.counts.comments > 0 && (
                <button type="button" className="feed-plain" onClick={() => setShowComments(true)}>
                  {target.counts.comments} comment{target.counts.comments === 1 ? '' : 's'}
                </button>
              )}
              {target.counts.reposts > 0 && <span>{target.counts.reposts} repost{target.counts.reposts === 1 ? '' : 's'}</span>}
            </span>
          </div>

          <div className="feed-actions">
            <button type="button" className={`feed-action ${target.viewer.liked ? 'active' : ''}`} aria-pressed={target.viewer.liked} onClick={toggleLike}>
              <ThumbsUp size={17} />
              <span>Like</span>
            </button>
            <button type="button" className="feed-action" aria-expanded={showComments} onClick={() => setShowComments((s) => !s)}>
              <MessageSquare size={17} />
              <span>Comment</span>
            </button>
            <div className="feed-menu-wrap">
              <button
                type="button"
                className={`feed-action ${target.viewer.reposted ? 'active' : ''}`}
                disabled={target.isAuthor}
                title={target.isAuthor ? 'You cannot repost your own post' : undefined}
                onClick={() => setRepostMenu((o) => !o)}
                aria-expanded={repostMenu}
              >
                <Repeat2 size={17} />
                <span>Repost</span>
              </button>
              {repostMenu && (
                <div className="feed-menu feed-menu-up" role="menu" onMouseLeave={() => setRepostMenu(false)}>
                  <button type="button" role="menuitem" disabled={target.viewer.reposted} onClick={repostNow}>
                    <Repeat2 size={14} /> {target.viewer.reposted ? 'Already reposted' : 'Repost'}
                  </button>
                  <button type="button" role="menuitem" disabled={target.viewer.reposted} onClick={() => { setRepostMenu(false); setQuoting(true); }}>
                    <PenSquare size={14} /> Repost with your thoughts
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="feed-action" onClick={share}>
              <Share2 size={17} />
              <span>Share</span>
            </button>
            <button type="button" className={`feed-action ${target.viewer.bookmarked ? 'active' : ''}`} aria-pressed={target.viewer.bookmarked} onClick={toggleBookmark}>
              {target.viewer.bookmarked ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
              <span>{target.viewer.bookmarked ? 'Saved' : 'Save'}</span>
            </button>
          </div>
        </>
      )}

      {notice && (
        <div className="feed-notice" role="status">
          {notice}
        </div>
      )}

      {quoting && (
        <div style={{ marginTop: 12 }}>
          <Composer
            currentUser={currentUser}
            repostOf={target}
            onCancel={() => setQuoting(false)}
            onPosted={(p) => {
              patchTarget((x) => ({ ...x, viewer: { ...x.viewer, reposted: true }, counts: { ...x.counts, reposts: x.counts.reposts + 1 } }));
              onPosted(p);
            }}
          />
        </div>
      )}

      {showComments && (isPlainRepost ? original : true) && <Comments post={target} onCount={onCommentCount} onViewProfile={onViewProfile} />}
      {analytics && <AnalyticsModal postId={post.id} onClose={() => setAnalytics(false)} />}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Impression tracking: a post counts once it is at least half on screen for one second.
// Batched; the server dedupes repeat views per member within 30 minutes.
// ---------------------------------------------------------------------------
function useImpressions() {
  const pending = useRef(new Set<string>());
  const sent = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const observer = useRef<IntersectionObserver | null>(null);

  const flush = useCallback((keepalive = false) => {
    if (pending.current.size === 0) return;
    const postIds = [...pending.current];
    pending.current.clear();
    postIds.forEach((id) => sent.current.add(id));
    fetch('/api/feed/impressions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postIds }), keepalive }).catch(() => {
      postIds.forEach((id) => sent.current.delete(id));
    });
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.postId;
          if (!id || sent.current.has(id)) continue;
          if (e.isIntersecting && e.intersectionRatio >= IMPRESSION_VISIBLE_RATIO) {
            if (!timers.current.has(id)) {
              timers.current.set(
                id,
                setTimeout(() => {
                  timers.current.delete(id);
                  if (document.visibilityState === 'visible') pending.current.add(id);
                }, IMPRESSION_DWELL_MS)
              );
            }
          } else {
            const t = timers.current.get(id);
            if (t) clearTimeout(t);
            timers.current.delete(id);
          }
        }
      },
      { threshold: [0, IMPRESSION_VISIBLE_RATIO] }
    );
    // Pending impressions are also sent when the tab is hidden and when the list unmounts.
    const interval = setInterval(() => flush(), IMPRESSION_FLUSH_INTERVAL_MS);
    const onHide = () => document.visibilityState === 'hidden' && flush(true);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      observer.current?.disconnect();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
      timers.current.forEach((t) => clearTimeout(t));
      flush(true);
    };
  }, [flush]);

  return useCallback((el: HTMLElement | null) => {
    if (el && observer.current) observer.current.observe(el);
  }, []);
}

// ---------------------------------------------------------------------------
// Post list (used by Home, Profile posts and Saved)
// ---------------------------------------------------------------------------
export function PostList({
  currentUser,
  filter,
  authorId,
  q,
  onViewProfile,
  onTopic,
  prepend,
  emptyState,
  onMeta,
}: {
  currentUser: MemberProfile;
  filter: string;
  authorId?: string;
  q?: string;
  onViewProfile: (id: string) => void;
  onTopic?: (t: string) => void;
  /** Posts created in this session, shown at the top immediately. */
  prepend?: FeedPost[];
  emptyState?: React.ReactNode;
  onMeta?: (m: { ranking: string; total: number }) => void;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const track = useImpressions();
  const reqId = useRef(0);

  const load = useCallback(
    async (reset: boolean, cur: string | null) => {
      const id = ++reqId.current;
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ filter, limit: '10' });
      if (authorId) params.set('authorId', authorId);
      if (q) params.set('q', q);
      if (!reset && cur) params.set('cursor', cur);
      const r = await api<{ posts: FeedPost[]; nextCursor: string | null; ranking: string; total: number }>(`/api/feed?${params}`);
      if (id !== reqId.current) return; // a newer request superseded this one
      setLoading(false);
      if (!r.ok) return setError(errorText(r, 'The feed could not be loaded.'));
      setPosts((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((p) => p.id));
        return [...base, ...r.data.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(r.data.nextCursor);
      setDone(!r.data.nextCursor);
      onMeta?.({ ranking: r.data.ranking, total: r.data.total });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, authorId, q]
  );

  useEffect(() => {
    setPosts([]);
    setDone(false);
    load(true, null);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && cursor) load(false, cursor);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, done, load]);

  const extra = (prepend || []).filter((p) => !posts.some((x) => x.id === p.id));
  const all = [...extra, ...posts];
  const update = (p: FeedPost) => setPosts((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list]));
  const removed = (id: string) => setPosts((list) => list.filter((x) => x.id !== id));

  return (
    <div className="feed-list">
      {all.map((p) => (
        <div key={p.id} ref={track} data-post-id={p.repostOf && !p.text && !('unavailable' in p.repostOf) ? (p.repostOf as FeedPost).id : p.id}>
          <PostCard
            post={p}
            currentUser={currentUser}
            onChange={update}
            onRemove={removed}
            onPosted={(np) => setPosts((list) => [np, ...list])}
            onViewProfile={onViewProfile}
            onTopic={onTopic}
          />
        </div>
      ))}
      {loading && (
        <div className="feed-card feed-skeleton" aria-busy="true" aria-label="Loading posts">
          <div className="feed-skel-row" />
          <div className="feed-skel-line" />
          <div className="feed-skel-line short" />
        </div>
      )}
      {error && (
        <div className="feed-card feed-error-card" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-secondary feed-btn-sm" onClick={() => load(posts.length === 0, cursor)}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && all.length === 0 && (emptyState ?? <div className="feed-card feed-empty">No posts yet.</div>)}
      {!done && !loading && cursor && (
        <button type="button" className="btn-secondary feed-load-more" onClick={() => load(false, cursor)}>
          Load more
        </button>
      )}
      <div ref={sentinel} aria-hidden="true" />
      {done && all.length > 0 && <div className="feed-muted feed-end">You are all caught up.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home feed
// ---------------------------------------------------------------------------
export function HomeFeed({
  currentUser,
  searchQuery,
  onClearSearch,
  onViewProfile,
}: {
  currentUser: MemberProfile;
  searchQuery: string;
  onClearSearch: () => void;
  onViewProfile: (id: string) => void;
}) {
  const [filter, setFilter] = useState('for_you');
  const [topic, setTopic] = useState('');
  const [created, setCreated] = useState<FeedPost[]>([]);
  const [meta, setMeta] = useState<{ ranking: string; total: number } | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const q = [debouncedSearch, topic ? `#${topic}` : ''].filter(Boolean).join(' ');

  useEffect(() => {
    setCreated([]);
  }, [filter, q]);

  return (
    <div className="feed-home">
      <Composer currentUser={currentUser} onPosted={(p) => setCreated((c) => [p, ...c])} />

      <div className="feed-filter-bar" role="tablist" aria-label="Feed filters">
        {FEED_FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`feed-filter ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {(q || (filter === 'for_you' && meta?.ranking === 'chronological_fallback')) && (
        <div className="feed-info-row">
          {q ? (
            <>
              <span>
                Posts matching <strong>{q}</strong>
                {meta ? ` · ${meta.total} found` : ''}
              </span>
              <button
                type="button"
                className="feed-link-btn"
                onClick={() => {
                  setTopic('');
                  onClearSearch();
                }}
              >
                Clear
              </button>
            </>
          ) : (
            <span>
              <Sparkles size={13} /> Showing the newest posts. Add skills and interests to your profile and For You will rank posts by relevance to your work.
            </span>
          )}
        </div>
      )}

      <PostList
        key={`${filter}|${q}`}
        currentUser={currentUser}
        filter={filter}
        q={q}
        prepend={created}
        onMeta={setMeta}
        onViewProfile={onViewProfile}
        onTopic={(t) => setTopic(t)}
        emptyState={
          <div className="feed-card feed-empty">
            <PenSquare size={30} color="var(--text-muted)" />
            <div className="feed-empty-title">{q ? 'No posts match your search' : 'No posts here yet'}</div>
            <p>{q ? 'Try a different word or topic.' : 'Be the first: share what you are building, a research result or a question for the community.'}</p>
          </div>
        }
      />
    </div>
  );
}

/** Profile "Posts" tab: the member's own posts, newest first. */
export function ProfilePosts({ currentUser, authorId, isSelf, onViewProfile }: { currentUser: MemberProfile; authorId: string; isSelf: boolean; onViewProfile: (id: string) => void }) {
  const [created, setCreated] = useState<FeedPost[]>([]);
  return (
    <div className="feed-home">
      {isSelf && <Composer currentUser={currentUser} onPosted={(p) => setCreated((c) => [p, ...c])} />}
      <PostList
        currentUser={currentUser}
        filter="author"
        authorId={authorId}
        prepend={created}
        onViewProfile={onViewProfile}
        emptyState={<div className="feed-card feed-empty">{isSelf ? 'You have not posted yet.' : 'No posts yet.'}</div>}
      />
    </div>
  );
}

/** A single post opened from a shared link or a notification. */
export function SinglePost({ postId, currentUser, onViewProfile, onBack }: { postId: string; currentUser: MemberProfile; onViewProfile: (id: string) => void; onBack: () => void }) {
  const [post, setPost] = useState<FeedPost | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setPost(null);
    setError('');
    api<{ post: FeedPost }>(`/api/posts/${encodeURIComponent(postId)}`).then((r) => (r.ok ? setPost(r.data.post) : setError(errorText(r, 'This post is not available.'))));
  }, [postId]);
  const track = useImpressions();
  return (
    <div className="feed-home">
      <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start', fontSize: '0.8rem' }} onClick={onBack}>
        ← Back to feed
      </button>
      {error && <div className="feed-card feed-empty">{error}</div>}
      {!post && !error && <div className="feed-card feed-skeleton"><div className="feed-skel-row" /><div className="feed-skel-line" /></div>}
      {post && (
        <div ref={track} data-post-id={post.id}>
          <PostCard post={post} currentUser={currentUser} onChange={setPost} onRemove={onBack} onPosted={() => undefined} onViewProfile={onViewProfile} startWithComments />
        </div>
      )}
    </div>
  );
}

/** Right-rail card: topics several different members posted about this week. Hidden when there are none. */
export function TrendingCard({ onTopic }: { onTopic: (t: string) => void }) {
  const [topics, setTopics] = useState<{ topic: string; authors: number; posts: number }[] | null>(null);
  useEffect(() => {
    api<{ topics: any[] }>('/api/feed/trending').then((r) => setTopics(r.ok ? r.data.topics : []));
  }, []);
  const list = useMemo(() => topics ?? [], [topics]);
  if (!list.length) return null;
  return (
    <div className="people-card feed-trending">
      <h2 className="feed-trending-title">
        <TrendingUp size={16} color="var(--primary)" /> Trending on Collaborate
      </h2>
      <div className="feed-muted" style={{ marginBottom: 8 }}>Topics several members posted about this week</div>
      {list.map((t) => (
        <button key={t.topic} type="button" className="feed-trending-item" onClick={() => onTopic(t.topic)}>
          <span className="feed-trending-topic">#{t.topic}</span>
          <span className="feed-muted">
            {t.posts} post{t.posts === 1 ? '' : 's'} · {t.authors} members
          </span>
        </button>
      ))}
    </div>
  );
}
