/**
 * Profile ownership: Collaborate-authored data vs. AI Tathastu-imported data.
 *
 * Storage
 *   member.localProfile     Collaborate-authored sections, hides and edits of imported items.
 *   member.importedProfile  normalized, consent-filtered copy of the latest accepted projection
 *                           (null when nothing is imported).
 *   member.importedIdentity identity values Collaborate filled from the import.
 *
 * Effective profile (member.skills / projects / experience / education / metrics), always
 * recomputed by recomputeEffectiveProfile():
 *   1. Local entries first, in the member's order.
 *   2. Then imported entries that are not hidden and do not duplicate a local entry
 *      (local wins on a case-insensitive title, name or institution match).
 *   3. An imported entry the member edited shows the member's version (locallyEdited: true).
 *
 * Rules
 *   - An import never modifies localProfile.
 *   - Withdrawing a scope (section null) or revoking clears only importedProfile and
 *     identity fills that still hold the imported value. Local data is never touched.
 *   - Clearing is idempotent.
 *   - Collaborate-owned fields (collaborationInterests, aiSpecializations, discoverable,
 *     profileVisibility, contactVisibility, socialLinks, about) are never imported.
 */
import crypto from 'crypto';
import type {
  EducationItem,
  ExperienceItem,
  ImportedTathastuProfile,
  LocalProfileSections,
  MemberProfile,
  ProjectItem,
} from '@collaborate/contracts';
import type { ProfessionalProjectionV1 } from '@/integrations/tathastu/contract/projection-v1';
import { parseProjectionV1 } from '@/integrations/tathastu/contract/projection-v1';

const IMPORTED_PREFIX = 'ait:';
const DEFAULT_AVATARS = ['', '/images/rahul_avatar.jpg', '/images/default_avatar.svg'];
const PLACEHOLDER_HEADLINES = ['', 'New Member | Collaborate Professional', 'AI/ML Builder | Tathastu Member'];

const lc = (s: string) => s.trim().toLowerCase();
const shortHash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
export const isImportedId = (id: string | undefined) => Boolean(id && id.startsWith(IMPORTED_PREFIX));

function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function emptyLocal(): LocalProfileSections {
  return {
    skills: [],
    projects: [],
    experience: [],
    education: [],
    hiddenImported: { skills: [], projects: [], experience: [], education: [] },
    importedOverrides: { projects: {}, experience: {}, education: {} },
    metrics: {},
  };
}

// ---------------------------------------------------------------------------
// Normalization: validated projection -> ImportedTathastuProfile
// ---------------------------------------------------------------------------

export function normalizeProjection(p: ProfessionalProjectionV1, now = new Date()): ImportedTathastuProfile {
  // Defence in depth: AI Tathastu already nulls withheld sections, but a section listed as
  // masked or with its scope switched off is treated as withheld no matter what it contains.
  const shared = (section: string, scope = section) =>
    !p.privacy.masked.includes(section) && p.privacy.scopes[scope] !== false;

  const loc = p.identity.location;
  const location = loc ? [loc.city, loc.country].filter(Boolean).join(', ') || null : null;

  const projects: ProjectItem[] | null =
    shared('projects') && p.projects
      ? p.projects.map((pr) => {
          const links = pr.links.map(safeUrl).filter((l): l is string => Boolean(l));
          return {
            id: `${IMPORTED_PREFIX}proj:${pr.key}`,
            title: pr.title,
            description: pr.description ?? '',
            tags: pr.technologies,
            featured: false,
            demoUrl: links[0],
            links,
            sourceOrigin: 'tathastu_core' as const,
          };
        })
      : null;

  const experience: ExperienceItem[] | null =
    shared('experience') && p.experience
      ? p.experience
          .filter((e) => e.role || e.organization)
          .map((e) => ({
            id: `${IMPORTED_PREFIX}exp:${shortHash(`${e.organization}|${e.role}|${e.dates}`)}`,
            role: e.role ?? '',
            company: e.organization ?? '',
            period: e.dates ?? '',
            bullets: e.description ? [e.description] : [],
            sourceOrigin: 'tathastu_core' as const,
          }))
      : null;

  const education: EducationItem[] | null =
    shared('education') && p.education
      ? p.education
          .filter((e) => e.institution || e.degree)
          .map((e) => ({
            id: `${IMPORTED_PREFIX}edu:${shortHash(`${e.institution}|${e.degree}|${e.fieldOfStudy}|${e.dates}`)}`,
            institution: e.institution ?? '',
            degree: [e.degree, e.fieldOfStudy].filter(Boolean).join(', '),
            period: e.dates ?? '',
            score: e.grade ?? '',
            sourceOrigin: 'tathastu_core' as const,
          }))
      : null;

  const skillsShared = shared('skills') && p.skills;
  return {
    schema: 'ProfessionalProjectionV1',
    version: 1,
    sourceSubject: p.identity.id,
    generatedAt: new Date(p.generatedAt).toISOString(),
    consentUpdatedAt: p.privacy.consentUpdatedAt,
    syncedAt: now.toISOString(),
    scopes: { ...p.privacy.scopes },
    masked: [...p.privacy.masked],
    identity: {
      name: p.identity.name,
      headline: p.identity.headline,
      avatarUrl: safeUrl(p.identity.avatarUrl),
      location,
      careerRoleLabel: p.identity.careerRole?.label ?? p.identity.careerRoleOther ?? null,
    },
    skills: skillsShared
      ? p.skills!.items.map((s) => ({
          name: s.name,
          category: s.category,
          evidenceStrength: s.evidenceStrength,
          verified: s.verified,
          verificationStatus: s.verificationStatus,
          sources: s.sources,
        }))
      : null,
    erisReadiness:
      skillsShared && shared('skills.erisReadiness', 'eris') && p.skills!.erisReadiness
        ? {
            score: p.skills!.erisReadiness.score,
            role: p.skills!.erisReadiness.role,
            gaps: p.skills!.erisReadiness.gaps,
            computedAt: p.skills!.erisReadiness.computedAt,
          }
        : null,
    projects,
    experience,
    education,
    achievements:
      shared('achievements') && p.achievements
        ? p.achievements.map((a) => ({
            type: a.type,
            title: a.title,
            issuer: a.issuer,
            date: a.date,
            url: safeUrl(a.url),
          }))
        : null,
  };
}

// ---------------------------------------------------------------------------
// Legacy migration (members stored before Phase 2)
// ---------------------------------------------------------------------------

/**
 * Splits a pre-Phase 2 member's mixed sections into local and imported. Only entries that are
 * provably imported (they match a projection that still validates) are classified as imported;
 * anything ambiguous stays local, so the migration can never delete member-authored data.
 */
export function ensureOwnershipModel(member: MemberProfile): void {
  if (member.localProfile) {
    if (member.tathastuProfile !== undefined) delete member.tathastuProfile;
    return;
  }
  const local = emptyLocal();
  let imported: ImportedTathastuProfile | null = null;

  const legacyRaw = member.tathastuProfile;
  if (legacyRaw && member.tathastu_user_id) {
    try {
      const parsed = parseProjectionV1(legacyRaw);
      if (parsed.identity.id === member.tathastu_user_id) {
        imported = normalizeProjection(parsed, new Date(member.tathastuLastSyncedAt || Date.now()));
      }
    } catch {
      imported = null; // legacy/fictional shape: keep everything local
    }
  }

  const importedSkillNames = new Set((imported?.skills ?? []).map((s) => lc(s.name)));
  local.skills = (member.skills || []).filter((s) => !importedSkillNames.has(lc(s)));

  // Projects tagged tathastu_core are provably imported. They never become local data; if the
  // legacy projection is unusable they are dropped and return on the next accepted sync.
  local.projects = (member.projects || [])
    .filter((p) => p.sourceOrigin !== 'tathastu_core')
    .map((p) => ({ ...p, sourceOrigin: 'collaborate' as const }));

  const expKey = (e: ExperienceItem) => `${lc(e.company || '')}|${lc(e.role || '')}`;
  const importedExp = new Set((imported?.experience ?? []).map(expKey));
  local.experience = (member.experience || []).filter((e) => !importedExp.has(expKey(e)));

  const eduKey = (e: EducationItem) => lc(e.institution || '');
  const importedEdu = new Set((imported?.education ?? []).map(eduKey));
  local.education = (member.education || []).filter((e) => !importedEdu.has(eduKey(e)));

  if (!imported?.achievements) {
    local.metrics = {
      achievements: member.metrics?.achievements ?? 0,
      publications: member.metrics?.publications ?? 0,
    };
  }

  member.localProfile = local;
  member.importedProfile = imported;
  member.importedIdentity = member.importedIdentity ?? {};
  delete member.tathastuProfile;
  recomputeEffectiveProfile(member);
}

// ---------------------------------------------------------------------------
// Effective profile
// ---------------------------------------------------------------------------

function mergeSection<T extends { id: string }>(
  localItems: T[],
  importedItems: T[] | null | undefined,
  hidden: string[],
  overrides: Record<string, T>,
  sameAs: (a: T, b: T) => boolean
): T[] {
  const hiddenSet = new Set(hidden);
  const out: T[] = localItems.map((i) => ({ ...i }));
  for (const item of importedItems ?? []) {
    if (hiddenSet.has(item.id)) continue;
    const override = overrides[item.id];
    const shown = override ? ({ ...override, id: item.id, sourceOrigin: 'tathastu_core', locallyEdited: true } as T) : { ...item };
    if (localItems.some((l) => sameAs(l, shown))) continue;
    out.push(shown);
  }
  return out;
}

export function recomputeEffectiveProfile(member: MemberProfile): void {
  const local = member.localProfile ?? emptyLocal();
  const imp = member.importedProfile ?? null;

  const hiddenSkills = new Set(local.hiddenImported.skills);
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const s of [...local.skills, ...(imp?.skills ?? []).map((x) => x.name).filter((n) => !hiddenSkills.has(lc(n)))]) {
    if (!s || seen.has(lc(s))) continue;
    seen.add(lc(s));
    skills.push(s);
  }
  member.skills = skills;

  member.projects = mergeSection(local.projects, imp?.projects, local.hiddenImported.projects, local.importedOverrides.projects, (a, b) => lc(a.title) === lc(b.title));
  member.experience = mergeSection(
    local.experience,
    imp?.experience,
    local.hiddenImported.experience,
    local.importedOverrides.experience,
    (a, b) => lc(a.company) === lc(b.company) && lc(a.role) === lc(b.role)
  );
  member.education = mergeSection(
    local.education,
    imp?.education,
    local.hiddenImported.education,
    local.importedOverrides.education,
    (a, b) => lc(a.institution) === lc(b.institution) && lc(a.degree) === lc(b.degree)
  );

  const achievements = imp?.achievements;
  member.metrics = {
    ...(member.metrics || { githubContributions: '0', leetcodeProblems: '0', projects: 0, skills: 0, achievements: 0, publications: 0 }),
    projects: member.projects.length,
    skills: member.skills.length,
    achievements: achievements ? achievements.filter((a) => a.type !== 'publication').length : local.metrics.achievements ?? 0,
    publications: achievements ? achievements.filter((a) => a.type === 'publication').length : local.metrics.publications ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Import / revoke
// ---------------------------------------------------------------------------

/** True when `incoming` is not newer than what is already stored (it must be ignored). */
export function isStaleProjection(member: MemberProfile, incomingGeneratedAt: string): boolean {
  const current = member.importedProfile?.generatedAt;
  if (!current) return false;
  return Date.parse(incomingGeneratedAt) <= Date.parse(current);
}

function fillIdentity(member: MemberProfile, field: 'headline' | 'avatarUrl' | 'location', value: string | null) {
  const fills = (member.importedIdentity ??= {});
  const current = (member[field] as string) ?? '';
  const previouslyImported = fills[field] !== undefined && fills[field] === current;
  const isPlaceholder =
    field === 'headline' ? PLACEHOLDER_HEADLINES.includes(current.trim()) : field === 'avatarUrl' ? DEFAULT_AVATARS.includes(current) : current.trim() === '';

  if (!(isPlaceholder || previouslyImported)) {
    // The member owns this value now; stop tracking it as imported.
    if (fills[field] !== undefined && fills[field] !== current) delete fills[field];
    return;
  }
  if (value) {
    member[field] = value;
    fills[field] = value;
  } else if (previouslyImported) {
    member[field] = '';
    delete fills[field];
  }
}

function setRoleBadge(member: MemberProfile, label: string | null) {
  const fills = (member.importedIdentity ??= {});
  const prev = fills.statusBadge;
  let badges = (member.statusBadges || []).filter((b) => b !== prev);
  if (label) {
    if (!badges.includes(label)) badges = [label, ...badges.filter((b) => b !== 'New Member')];
    fills.statusBadge = label;
  } else {
    delete fills.statusBadge;
  }
  member.statusBadges = badges;
}

/**
 * Stores a validated projection as the member's imported data. The caller must have verified
 * that the projection belongs to this member and is not stale (isStaleProjection).
 */
export function applyImportedProjection(member: MemberProfile, projection: ProfessionalProjectionV1, now = new Date()): void {
  ensureOwnershipModel(member);
  if (projection.identity.id !== member.tathastu_user_id) {
    throw new Error('PROJECTION_SUBJECT_MISMATCH: projection does not belong to this member.');
  }
  const imported = normalizeProjection(projection, now);
  member.importedProfile = imported;
  fillIdentity(member, 'headline', imported.identity.headline);
  fillIdentity(member, 'avatarUrl', imported.identity.avatarUrl);
  fillIdentity(member, 'location', imported.identity.location);
  setRoleBadge(member, imported.identity.careerRoleLabel);
  member.tathastuLastSyncedAt = imported.syncedAt;
  member.tathastuSyncStatus = 'synced';
  recomputeEffectiveProfile(member);
}

/** Removes every imported section and identity fill. Local data is untouched. Idempotent. */
export function clearImportedProfile(member: MemberProfile): void {
  ensureOwnershipModel(member);
  member.importedProfile = null;
  const fills = member.importedIdentity ?? {};
  for (const field of ['headline', 'avatarUrl', 'location'] as const) {
    if (fills[field] !== undefined && member[field] === fills[field]) member[field] = '';
    delete fills[field];
  }
  setRoleBadge(member, null);
  member.importedIdentity = {};
  member.tathastuLastSyncedAt = undefined;
  recomputeEffectiveProfile(member);
}

// ---------------------------------------------------------------------------
// Local edits (PUT /api/profiles)
// ---------------------------------------------------------------------------

type SectionKey = 'projects' | 'experience' | 'education';

function sameContent(a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) {
  return keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}
const CONTENT_KEYS: Record<SectionKey, string[]> = {
  projects: ['title', 'description', 'tags', 'demoUrl', 'imageUrl', 'featured'],
  experience: ['role', 'company', 'period', 'bullets'],
  education: ['institution', 'degree', 'period', 'score'],
};

function applySectionEdit(member: MemberProfile, key: SectionKey, submitted: any[]) {
  const local = member.localProfile!;
  const importedItems: { id: string }[] = (member.importedProfile?.[key] as any[]) ?? [];
  const importedById = new Map(importedItems.map((i) => [i.id, i]));
  const submittedIds = new Set<string>();
  const nextLocal: any[] = [];
  const overrides: Record<string, any> = { ...local.importedOverrides[key] };

  for (const raw of submitted) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (isImportedId(id)) {
      const source = importedById.get(id);
      if (!source) continue; // imported entry no longer shared/linked: never re-add it as local data
      submittedIds.add(id);
      const { locallyEdited: _e, sourceOrigin: _s, ...content } = raw;
      if (sameContent(content, source as any, CONTENT_KEYS[key])) delete overrides[id];
      else overrides[id] = { ...content, id };
      continue;
    }
    const { locallyEdited: _e, ...rest } = raw;
    nextLocal.push({
      ...rest,
      id: id || `${key.slice(0, 4)}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      sourceOrigin: 'collaborate',
    });
  }

  const hidden = new Set(local.hiddenImported[key]);
  for (const id of importedById.keys()) {
    if (submittedIds.has(id)) hidden.delete(id);
    else hidden.add(id);
  }
  local[key] = nextLocal as any;
  local.hiddenImported[key] = [...hidden];
  local.importedOverrides[key] = overrides;
}

/**
 * Applies a member's edit of their effective profile. Imported entries the member keeps are
 * left imported, removed ones become hidden, edited ones become local overrides. Entries
 * without an imported id are Collaborate-authored.
 */
export function applyLocalProfileEdit(
  member: MemberProfile,
  updates: Partial<Pick<MemberProfile, 'skills' | 'projects' | 'experience' | 'education'>> & { metrics?: Record<string, unknown> }
): void {
  ensureOwnershipModel(member);
  const local = member.localProfile!;

  if (Array.isArray(updates.skills)) {
    const submitted = updates.skills.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim());
    const submittedSet = new Set(submitted.map(lc));
    const importedNames = (member.importedProfile?.skills ?? []).map((s) => s.name);
    const importedSet = new Set(importedNames.map(lc));
    const previousLocal = new Set(local.skills.map(lc));
    local.skills = submitted.filter((s) => !importedSet.has(lc(s)) || previousLocal.has(lc(s)));
    const hidden = new Set(local.hiddenImported.skills.filter((s) => !submittedSet.has(s)));
    for (const n of importedNames) if (!submittedSet.has(lc(n))) hidden.add(lc(n));
    local.hiddenImported.skills = [...hidden];
  }
  for (const key of ['projects', 'experience', 'education'] as const) {
    if (Array.isArray(updates[key])) applySectionEdit(member, key, updates[key] as any[]);
  }
  if (updates.metrics && typeof updates.metrics === 'object') {
    const m = updates.metrics as Record<string, unknown>;
    if (typeof m.achievements === 'number') local.metrics.achievements = m.achievements;
    if (typeof m.publications === 'number') local.metrics.publications = m.publications;
  }
  recomputeEffectiveProfile(member);
}

/** Identity fields the member set themselves are no longer tracked as imported. */
export function releaseIdentityFills(member: MemberProfile, changed: string[]): void {
  const fills = member.importedIdentity;
  if (!fills) return;
  for (const f of changed) {
    if ((f === 'headline' || f === 'avatarUrl' || f === 'location') && fills[f] !== undefined && member[f] !== fills[f]) delete fills[f];
  }
}
