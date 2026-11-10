/**
 * The only shapes in which member records leave the API.
 *
 *   toPublicMember(member, ctx)  another member's profile (discovery, recommendations,
 *                                profile view, saved list). An explicit allow-list: a field
 *                                added to MemberProfile later is NOT exposed until listed here.
 *   toSelfMember(member)         the signed-in member's own record (auth/me, settings flows).
 *
 * Never exposed to other members: email, external identity (tathastu_user_id, mappings),
 * the imported projection's provenance and scopes, local ownership bookkeeping,
 * notification preferences, billing expiry, safeguarding and moderation flags.
 * socialLinks (contact information) follow contactVisibility.
 */
import type { MemberProfile } from '@collaborate/contracts';
import { ensureOwnershipModel, isCodingActivityAchievement, timeAgo } from './ownership';

const freshActivity = (items: MemberProfile['recentActivity']) =>
  (items || []).map((a) => (a.at ? { ...a, timeAgo: timeAgo(a.at) } : { ...a }));

export interface ViewerContext {
  viewerId?: string | null;
  isConnected?: boolean;
  isAdmin?: boolean;
}

/**
 * Sanitized view of imported data the UI uses for "not shared" states, verified badges and the
 * career-direction section. The legacy ERIS readiness score is deliberately NOT exposed: it is a
 * v2 coverage number the current Career Intelligence Engine (v3) no longer displays.
 */
export interface TathastuProfileView {
  skills: { items: { name: string; category: string | null; verified: boolean; evidenceStrength: number | null; level: string | null }[] } | null;
  projects: [] | null;
  experience: [] | null;
  education: [] | null;
  achievements: { type: 'achievement' | 'certification' | 'publication'; title: string; issuer: string | null; date: string | null; url: string | null }[] | null;
  /** null = activity not shared. */
  activity: {
    githubRepositories: number;
    coding: { source: 'leetcode' | 'hackerrank'; solved: { total: number | null; easy: number | null; medium: number | null; hard: number | null }; contest: { rating: number; attended: number | null; topPercentage: number | null } | null }[] | null;
  } | null;
  /** Shared under AI Tathastu's goals ("eris") consent; null = not shared or no target role. */
  careerDirection: {
    label: string;
    /** Skills the v3 engine assessed at Proficient or Advanced from evidence. */
    strengths: string[];
    /** Owner only: highest-priority open competencies. Never shown to other members. */
    developmentAreas: string[] | null;
    assessed: boolean;
    assessedAt: string | null;
  } | null;
  syncedAt: string;
}

const STRONG_LEVELS = new Set(['proficient', 'advanced']);

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function withOwnership(member: MemberProfile): MemberProfile {
  if (member.localProfile) return member;
  // Legacy record: derive the ownership model on a copy so a read never writes.
  const copy = structuredClone(member);
  ensureOwnershipModel(copy);
  return copy;
}

export function tathastuProfileView(member: MemberProfile, opts: { isSelf?: boolean } = {}): TathastuProfileView | undefined {
  const imp = member.importedProfile;
  if (!imp) return undefined;
  const hiddenSkills = new Set(member.localProfile?.hiddenImported.skills ?? []);
  const visibleSkills = (imp.skills ?? []).filter((s) => !hiddenSkills.has(s.name.trim().toLowerCase()));
  const goals = imp.goals;
  const label = goals?.targetRole?.label ?? null;
  return {
    skills: imp.skills
      ? { items: imp.skills.map((s) => ({ name: s.name, category: s.category, verified: s.verified, evidenceStrength: s.evidenceStrength, level: s.level ?? null })) }
      : null,
    projects: imp.projects ? [] : null,
    experience: imp.experience ? [] : null,
    education: imp.education ? [] : null,
    achievements: imp.achievements
      ? imp.achievements
          .filter((a) => !isCodingActivityAchievement(a))
          .map((a) => ({ type: a.type, title: a.title, issuer: a.issuer, date: a.date, url: a.url }))
      : null,
    activity: imp.activity
      ? {
          githubRepositories: imp.activity.githubRepositories,
          // Rows imported before coding stats existed: unknown (null), not "none".
          coding: imp.activity.coding ? imp.activity.coding.map((c) => ({ source: c.source, solved: { ...c.solved }, contest: c.contest ? { ...c.contest } : null })) : null,
        }
      : null,
    careerDirection:
      goals && label
        ? {
            label,
            strengths: visibleSkills
              .filter((s) => s.level && STRONG_LEVELS.has(s.level.toLowerCase()))
              .sort((a, b) => (b.proficiency ?? 0) - (a.proficiency ?? 0))
              .slice(0, 6)
              .map((s) => s.name),
            developmentAreas: opts.isSelf && goals.assessed ? goals.needs.slice(0, 4).map((n) => n.skill) : null,
            assessed: goals.assessed,
            assessedAt: goals.assessedAt ?? null,
          }
        : null,
    syncedAt: imp.syncedAt,
  };
}

export type PublicMember = ReturnType<typeof toPublicMember>;

export function toPublicMember(raw: MemberProfile, ctx: ViewerContext = {}) {
  const m = withOwnership(raw);
  const isSelf = Boolean(ctx.viewerId && ctx.viewerId === m.id);
  const contactVisible = isSelf || ctx.isAdmin || (m.contactVisibility === 'connections_only' && Boolean(ctx.isConnected));

  return {
    id: m.id,
    fullName: m.fullName,
    headline: m.headline,
    avatarUrl: m.avatarUrl,
    bannerUrl: m.bannerUrl,
    isVerified: Boolean(m.isVerified),
    verifiedCategory: m.verifiedCategory,
    plan: m.plan,
    statusBadges: [...(m.statusBadges || [])],
    location: m.location,
    about: m.about,
    contextTags: (m.contextTags || []).filter((t) => !EMAIL_LIKE.test(t)),
    socialLinks: contactVisible ? { ...(m.socialLinks || {}) } : {},
    metrics: { ...m.metrics },
    skills: [...(m.skills || [])],
    projects: (m.projects || []).map((p) => ({ ...p })),
    experience: (m.experience || []).map((e) => ({ ...e })),
    education: (m.education || []).map((e) => ({ ...e })),
    recentActivity: freshActivity(m.recentActivity),
    aiSpecializations: [...(m.aiSpecializations || [])],
    collaborationInterests: [...(m.collaborationInterests || [])],
    discoverable: Boolean(m.discoverable),
    profileVisibility: m.profileVisibility,
    contactVisibility: m.contactVisibility,
    isLinkedWithTathastu: Boolean(m.isLinkedWithTathastu),
    tathastuProfile: tathastuProfileView(m, { isSelf }),
  };
}

/** The member's own record. Strips raw/internal bookkeeping only; the member may see their own data. */
export function toSelfMember(raw: MemberProfile) {
  const m = withOwnership(raw);
  const { tathastuProfile: _legacy, localProfile: _local, importedIdentity: _fills, unlinkedTathastuSubjects: _gone, ...rest } = m;
  return {
    ...rest,
    recentActivity: freshActivity(m.recentActivity),
    tathastuProfile: tathastuProfileView(m, { isSelf: true }),
  };
}

/**
 * Domains reserved for testing and documentation (RFC 2606 / RFC 6761) plus the internal domain the
 * live integration tests register under (`*@test.collaborate.internal`). Accounts on them are not
 * real people and are never shown to other members.
 */
const SYNTHETIC_EMAIL_DOMAIN = /@(?:[^@]+\.)?(?:internal|test|example|invalid|localhost|example\.(?:com|org|net))$/i;

/** True for demo personas and accounts created by automated tests. */
export function isSyntheticAccount(m: Pick<MemberProfile, 'email' | 'isDemo'>): boolean {
  return Boolean(m.isDemo) || SYNTHETIC_EMAIL_DOMAIN.test((m.email || '').trim());
}

/** Member-to-member visibility gate shared by discovery, recommendations and saved lists. */
export function isVisibleInDiscovery(candidate: MemberProfile, viewer: MemberProfile | null, isConnected: boolean): boolean {
  if (candidate.deactivated || candidate.isRestricted || candidate.role === 'admin') return false;
  // A synthetic account is hidden from everyone except other synthetic accounts (test runs).
  if (isSyntheticAccount(candidate) && !(viewer && isSyntheticAccount(viewer))) return false;
  if (!candidate.discoverable) return false;
  if (candidate.profileVisibility === 'private') return false;
  if (candidate.profileVisibility === 'connections_only' && !isConnected) return false;
  // Safeguarding: under-18 accounts are only shown to other under-18 or safeguarding-approved viewers.
  if (candidate.isUnder18 && !(viewer && (viewer.isUnder18 || viewer.safeguardingApproved))) return false;
  return true;
}
