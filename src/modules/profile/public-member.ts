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
import { ensureOwnershipModel } from './ownership';

export interface ViewerContext {
  viewerId?: string | null;
  isConnected?: boolean;
  isAdmin?: boolean;
}

/** Sanitized view of imported data the UI uses for "not shared" states and verified badges. */
export interface TathastuProfileView {
  skills: { items: { name: string; category: string | null; verified: boolean; evidenceStrength: number | null }[]; erisReadiness: unknown } | null;
  projects: [] | null;
  experience: [] | null;
  education: [] | null;
  achievements: [] | null;
  syncedAt: string;
}

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function withOwnership(member: MemberProfile): MemberProfile {
  if (member.localProfile) return member;
  // Legacy record: derive the ownership model on a copy so a read never writes.
  const copy = structuredClone(member);
  ensureOwnershipModel(copy);
  return copy;
}

export function tathastuProfileView(member: MemberProfile): TathastuProfileView | undefined {
  const imp = member.importedProfile;
  if (!imp) return undefined;
  return {
    skills: imp.skills
      ? {
          items: imp.skills.map((s) => ({ name: s.name, category: s.category, verified: s.verified, evidenceStrength: s.evidenceStrength })),
          erisReadiness: imp.erisReadiness,
        }
      : null,
    projects: imp.projects ? [] : null,
    experience: imp.experience ? [] : null,
    education: imp.education ? [] : null,
    achievements: imp.achievements ? [] : null,
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
    recentActivity: (m.recentActivity || []).map((a) => ({ ...a })),
    aiSpecializations: [...(m.aiSpecializations || [])],
    collaborationInterests: [...(m.collaborationInterests || [])],
    discoverable: Boolean(m.discoverable),
    profileVisibility: m.profileVisibility,
    contactVisibility: m.contactVisibility,
    isLinkedWithTathastu: Boolean(m.isLinkedWithTathastu),
    tathastuProfile: tathastuProfileView(m),
  };
}

/** The member's own record. Strips raw/internal bookkeeping only; the member may see their own data. */
export function toSelfMember(raw: MemberProfile) {
  const m = withOwnership(raw);
  const { tathastuProfile: _legacy, localProfile: _local, importedIdentity: _fills, ...rest } = m;
  return {
    ...rest,
    tathastuProfile: tathastuProfileView(m),
  };
}

/** Member-to-member visibility gate shared by discovery, recommendations and saved lists. */
export function isVisibleInDiscovery(candidate: MemberProfile, viewer: MemberProfile | null, isConnected: boolean): boolean {
  if (candidate.deactivated || candidate.isRestricted || candidate.role === 'admin') return false;
  if (!candidate.discoverable) return false;
  if (candidate.profileVisibility === 'private') return false;
  if (candidate.profileVisibility === 'connections_only' && !isConnected) return false;
  // Safeguarding: under-18 accounts are only shown to other under-18 or safeguarding-approved viewers.
  if (candidate.isUnder18 && !(viewer && (viewer.isUnder18 || viewer.safeguardingApproved))) return false;
  return true;
}
