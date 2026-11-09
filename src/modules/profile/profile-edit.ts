/**
 * Allow-list for PUT /api/profiles.
 *
 * The route used to merge the whole request body into the member record minus a deny-list, so any field
 * not on that list (recentActivity, institutionDomain, isDemo, future fields) could be written with any
 * type and any size. Members are held in memory by every API instance and re-serialized on writes, so an
 * oversized value was also a cheap denial-of-service lever. Now only these fields are accepted, each with
 * a type and a size limit; anything else is ignored. Profile sections (skills, projects, experience,
 * education, metrics) keep going through the ownership pipeline (applyLocalProfileEdit).
 */
export class ProfileEditError extends Error {}

const LIMITS = { fullName: 100, headline: 200, location: 120, about: 4000, url: 500, tag: 60, tags: 30 } as const;
const PROFILE_VISIBILITIES = ['public', 'connections_only', 'private'];
const CONTACT_VISIBILITIES = ['connections_only', 'hidden'];
const SOCIAL_KEYS = ['github', 'linkedin', 'leetcode', 'portfolio'] as const;
const NOTIFICATION_KEYS = ['connections', 'messages', 'verifications', 'recommendations', 'securityAlerts'] as const;
const SYNC_KEYS = ['autoSyncProjects', 'autoSyncSkills', 'autoSyncAchievements'] as const;
export const SECTION_KEYS = ['skills', 'projects', 'experience', 'education', 'metrics'] as const;
const MAX_SECTION_ITEMS = 100;

function text(field: string, value: unknown, max: number, { required = false } = {}): string {
  if (typeof value !== 'string') throw new ProfileEditError(`${field} must be text`);
  const v = value.trim();
  if (required && !v) throw new ProfileEditError(`${field} can't be empty`);
  if (v.length > max) throw new ProfileEditError(`${field} must be ${max} characters or fewer`);
  return v;
}

/** http(s) URL, or '' to clear. `allowRelative` also accepts a same-site path such as /images/avatar.jpg. */
function url(field: string, value: unknown, { allowRelative = false } = {}): string {
  const v = text(field, value, LIMITS.url);
  if (!v) return '';
  if (allowRelative && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\')) return v;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new ProfileEditError(`${field} must be a web address starting with https://`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new ProfileEditError(`${field} must be a web address starting with https://`);
  if (parsed.username || parsed.password) throw new ProfileEditError(`${field} must not contain a username or password`);
  return parsed.href;
}

function tagList(field: string, value: unknown): string[] {
  if (!Array.isArray(value)) throw new ProfileEditError(`${field} must be a list`);
  if (value.length > LIMITS.tags) throw new ProfileEditError(`${field} can have at most ${LIMITS.tags} entries`);
  return [...new Set(value.map((t) => text(field, t, LIMITS.tag)).filter(Boolean))];
}

function booleans(field: string, value: unknown, keys: readonly string[], base: Record<string, unknown> | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileEditError(`${field} must be an object`);
  const out: Record<string, boolean> = { ...((base as Record<string, boolean>) || {}) };
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') throw new ProfileEditError(`${field}.${k} must be true or false`);
    out[k] = v;
  }
  return out;
}

/**
 * Returns the validated plain-field updates and the section updates. Throws ProfileEditError (→ 400)
 * on a wrong type or an over-long value. Fields not listed here are ignored.
 */
export function sanitizeProfileUpdates(raw: Record<string, unknown>, current: { notificationPreferences?: unknown; tathastuSyncSettings?: unknown; socialLinks?: unknown }) {
  const plain: Record<string, unknown> = {};
  const sections: Record<string, unknown> = {};

  if ('fullName' in raw) plain.fullName = text('fullName', raw.fullName, LIMITS.fullName, { required: true });
  if ('headline' in raw) plain.headline = text('headline', raw.headline, LIMITS.headline);
  if ('location' in raw) plain.location = text('location', raw.location, LIMITS.location);
  if ('about' in raw) plain.about = text('about', raw.about, LIMITS.about);
  if ('avatarUrl' in raw) plain.avatarUrl = url('avatarUrl', raw.avatarUrl, { allowRelative: true });
  if ('bannerUrl' in raw) plain.bannerUrl = url('bannerUrl', raw.bannerUrl, { allowRelative: true });
  for (const f of ['contextTags', 'aiSpecializations', 'collaborationInterests'] as const) if (f in raw) plain[f] = tagList(f, raw[f]);
  if ('discoverable' in raw) {
    if (typeof raw.discoverable !== 'boolean') throw new ProfileEditError('discoverable must be true or false');
    plain.discoverable = raw.discoverable;
  }
  if ('profileVisibility' in raw) {
    if (!PROFILE_VISIBILITIES.includes(raw.profileVisibility as string)) throw new ProfileEditError('Invalid profile visibility');
    plain.profileVisibility = raw.profileVisibility;
  }
  if ('contactVisibility' in raw) {
    if (!CONTACT_VISIBILITIES.includes(raw.contactVisibility as string)) throw new ProfileEditError('Invalid contact visibility');
    plain.contactVisibility = raw.contactVisibility;
  }
  if ('socialLinks' in raw) {
    const s = raw.socialLinks;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new ProfileEditError('socialLinks must be an object');
    const links: Record<string, string> = {};
    for (const k of SOCIAL_KEYS) {
      const v = (s as Record<string, unknown>)[k];
      if (v === undefined || v === null) continue;
      const clean = url(`socialLinks.${k}`, v);
      if (clean) links[k] = clean;
    }
    plain.socialLinks = links;
  }
  if ('notificationPreferences' in raw) plain.notificationPreferences = booleans('notificationPreferences', raw.notificationPreferences, NOTIFICATION_KEYS, current.notificationPreferences as Record<string, unknown>);
  if ('tathastuSyncSettings' in raw) plain.tathastuSyncSettings = booleans('tathastuSyncSettings', raw.tathastuSyncSettings, SYNC_KEYS, current.tathastuSyncSettings as Record<string, unknown>);

  for (const key of SECTION_KEYS) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (key === 'metrics') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProfileEditError('metrics must be an object');
    } else if (!Array.isArray(v) || v.length > MAX_SECTION_ITEMS) {
      throw new ProfileEditError(`${key} must be a list of at most ${MAX_SECTION_ITEMS} entries`);
    }
    sections[key] = v;
  }
  return { plain, sections };
}
