/**
 * Collaborate. by AI Tathastu — Shared Contracts Package
 * @package @collaborate/contracts
 *
 * Defines the canonical data schemas, domain entities, and API contracts
 * shared between the Next.js frontend (Vercel) and Fastify backend (Render).
 */

export type UserPlan = 'free' | 'premium';

export type VerificationCategory = 'identity' | 'institution' | 'organization';

export type ConnectionStatus =
  | 'not_connected'
  | 'request_sent'
  | 'request_received'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'removed'
  | 'blocked';

export interface ProjectItem {
  id: string;
  title: string;
  featured?: boolean;
  description: string;
  tags: string[];
  stars?: number;
  forks?: number;
  demoUrl?: string;
  imageUrl?: string;
  links?: string[];
  sourceOrigin?: 'collaborate' | 'tathastu_core';
  /** Imported item the member edited in Collaborate (the AI Tathastu source is unchanged). */
  locallyEdited?: boolean;
}

export interface ExperienceItem {
  id: string;
  role: string;
  company: string;
  period: string;
  bullets: string[];
  sourceOrigin?: 'collaborate' | 'tathastu_core';
  locallyEdited?: boolean;
}

export interface EducationItem {
  id: string;
  institution: string;
  period: string;
  degree: string;
  score: string;
  sourceOrigin?: 'collaborate' | 'tathastu_core';
  locallyEdited?: boolean;
}

// ---------------------------------------------------------------------------
// Profile ownership (Phase 2). Collaborate-authored and AI Tathastu-imported data
// are stored separately; MemberProfile.skills/projects/experience/education hold
// the deterministic merge of the two (see src/modules/profile/ownership.ts).
// ---------------------------------------------------------------------------

export interface ImportedSkill {
  name: string;
  category: string | null;
  evidenceStrength: number | null;
  verified: boolean;
  verificationStatus: string | null;
  sources: string[];
  /** AI Tathastu's evidence-based 0-100 assessment; null/absent = not assessed (older rows lack it). */
  proficiency?: number | null;
  level?: string | null;
}

/** What the member is working towards (AI Tathastu "eris" scope). Used to find people who can help. */
export interface ImportedGoals {
  targetRole: { id: string; label: string } | null;
  /** Skills the target role still needs from the member's evidence, highest priority first. */
  needs: { skill: string; priority: 'High' | 'Medium' | 'Low'; state: string; expectedLevel: string | null }[];
  /** False when AI Tathastu had too little evidence to assess; needs is then empty (not "no gaps"). */
  assessed: boolean;
  collaborationIntents: string[];
}

export interface ImportedAchievement {
  type: 'achievement' | 'certification' | 'publication';
  title: string;
  issuer: string | null;
  date: string | null;
  url: string | null;
}

export interface ImportedErisReadiness {
  score: number;
  role: string | null;
  gaps: unknown[];
  computedAt: string | null;
}

/** Normalized, consent-filtered copy of the latest accepted ProfessionalProjectionV1. */
export interface ImportedTathastuProfile {
  schema: 'ProfessionalProjectionV1';
  version: 1;
  sourceSubject: string;
  generatedAt: string;
  consentUpdatedAt: string | null;
  syncedAt: string;
  scopes: Record<string, boolean>;
  masked: string[];
  identity: {
    name: string | null;
    headline: string | null;
    avatarUrl: string | null;
    location: string | null;
    careerRoleLabel: string | null;
    /** AI Tathastu career-direction id (e.g. "ml_engineer"); absent on older rows. */
    careerRoleId?: string | null;
  };
  /** Goals (target role, open needs, intents); null/absent = not shared. */
  goals?: ImportedGoals | null;
  /** null = section not shared by the member. */
  skills: ImportedSkill[] | null;
  erisReadiness: ImportedErisReadiness | null;
  projects: ProjectItem[] | null;
  experience: ExperienceItem[] | null;
  education: EducationItem[] | null;
  achievements: ImportedAchievement[] | null;
  /** Recent activity from connected sources (refreshed weekly by AI Tathastu). Optional for older rows. */
  activity?: ImportedActivity | null;
}

export interface ImportedActivity {
  connectedSources: string[];
  githubRepositories: number;
  recentRepositories: { name: string; url: string | null; stars: number | null; languages: string[]; lastCommitAt: string | null }[];
  profileUpdatedAt: string | null;
}

export interface LocalProfileSections {
  skills: string[];
  projects: ProjectItem[];
  experience: ExperienceItem[];
  education: EducationItem[];
  /** Imported entries the member chose to hide in Collaborate (skills: lower-cased names; others: ids). */
  hiddenImported: { skills: string[]; projects: string[]; experience: string[]; education: string[] };
  /** Member edits of imported entries, keyed by imported id. Never written back to AI Tathastu. */
  importedOverrides: {
    projects: Record<string, ProjectItem>;
    experience: Record<string, ExperienceItem>;
    education: Record<string, EducationItem>;
  };
  /** Locally entered counters used when the matching section is not imported. */
  metrics: { achievements?: number; publications?: number };
}

/** Values Collaborate filled from the import into otherwise empty identity fields. */
export type ImportedIdentityFills = Partial<Record<'headline' | 'avatarUrl' | 'location' | 'statusBadge', string>>;

export interface ActivityItem {
  id: string;
  type: 'github' | 'leetcode' | 'project' | 'publication';
  title: string;
  timeAgo: string;
  /** ISO timestamp of the activity; when present, timeAgo is recomputed on every read. */
  at?: string;
  url?: string;
  sourceOrigin?: 'collaborate' | 'tathastu_core';
}

export interface MemberMetrics {
  projects: number;
  skills: number;
  achievements: number;
  githubContributions: string;
  leetcodeProblems: string;
  publications: number;
}

export interface SocialLinks {
  github?: string;
  linkedin?: string;
  leetcode?: string;
  portfolio?: string;
}

export interface TathastuSyncSettings {
  autoSyncProjects: boolean;
  autoSyncSkills: boolean;
  autoSyncAchievements: boolean;
}

export interface NotificationPreferences {
  connections: boolean;
  messages: boolean;
  verifications: boolean;
  recommendations: boolean;
  securityAlerts: boolean;
}

export interface MemberProfile {
  id: string;
  email: string;
  fullName: string;
  headline: string;
  avatarUrl: string;
  bannerUrl: string;
  isVerified: boolean;
  verifiedCategory?: VerificationCategory;
  verifiedAt?: string;
  plan: UserPlan;
  planExpiresAt?: string;
  statusBadges: string[];
  location: string;
  about: string;
  contextTags: string[];
  socialLinks: SocialLinks;
  metrics: MemberMetrics;
  skills: string[];
  projects: ProjectItem[];
  experience: ExperienceItem[];
  education: EducationItem[];
  recentActivity: ActivityItem[];
  aiSpecializations: string[];
  collaborationInterests: string[];
  discoverable: boolean;
  profileVisibility: 'public' | 'connections_only' | 'private';
  contactVisibility: 'connections_only' | 'hidden';
  isLinkedWithTathastu: boolean;
  tathastuSyncStatus: 'synced' | 'draft' | 'pending_conflict' | 'unlinked';
  tathastuSyncSettings: TathastuSyncSettings;
  tathastuDraftProposal?: Partial<MemberProfile>;
  notificationPreferences?: NotificationPreferences;
  isUnder18?: boolean;
  safeguardingApproved?: boolean;
  institutionDomain?: string;
  isDemo?: boolean;
  role?: 'member' | 'admin';
  isRestricted?: boolean;
  deactivated?: boolean;
  tathastu_user_id?: string;
  /**
   * Legacy (pre-Phase 2): raw projection as received. Migrated into importedProfile on first
   * touch and then removed. In API responses this key carries only the sanitized
   * TathastuProfileView produced by src/modules/profile/public-member.ts.
   */
  tathastuProfile?: any;
  tathastuLastSyncedAt?: string;
  importedProfile?: ImportedTathastuProfile | null;
  localProfile?: LocalProfileSections;
  importedIdentity?: ImportedIdentityFills;
  /** True once the member explicitly chose whether to appear in discovery. */
  discoveryChoiceMade?: boolean;
  /** When the current AI Tathastu link was established; revocations sent before it are stale. */
  tathastuLinkedAt?: string;
  /** Created automatically from AI Tathastu (private until the member turns on visibility). */
  autoProvisioned?: boolean;
  /** AI Tathastu subjects this member disconnected; automatic re-creation is refused for them. */
  unlinkedTathastuSubjects?: string[];
  /** Collaborate-owned recommendation controls. */
  recommendationPreferences?: {
    /** Never show me in other members' recommendations (search/discovery follow `discoverable`). */
    hideFromRecommendations?: boolean;
    /** Members I dismissed; never recommended to me again. */
    dismissedMemberIds?: string[];
  };
}

export interface ConnectionRecord {
  id: string;
  requesterId: string;
  recipientId: string;
  status: ConnectionStatus;
  introMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
}

export interface Conversation {
  id: string;
  participantIds: [string, string];
  lastMessage?: {
    content: string;
    timestamp: string;
    senderId: string;
  };
  unreadCounts: Record<string, number>;
  updatedAt: string;
}

export interface VerificationRequest {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  category: VerificationCategory;
  evidenceSummary: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewerNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface VerificationAuditLog {
  id: string;
  requestId: string;
  memberId: string;
  action: 'approved' | 'rejected' | 'revoked';
  reviewer: string;
  category: VerificationCategory;
  notes: string;
  timestamp: string;
}

export interface AbuseReport {
  id: string;
  reporterId: string;
  reportedMemberId: string;
  reason: string;
  details: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
}

export interface ProfileViewLedgerEntry {
  id: string;
  viewerId: string;
  targetId: string;
  dateKey: string; // YYYY-MM-DD
  viewedAt: string;
}

export interface RecommendationMatch {
  member: MemberProfile;
  /** Relative ranking value (0-100) within the result set; not a probability. */
  matchScore: number;
  reason: string;
  sharedInterests: string[];
  mutualCount: number;
  /** Evidence-backed explanation (src/modules/intelligence/matching.ts). */
  explanation?: unknown;
  categories?: string[];
}

export interface ProfileStatsResponse {
  projectsPublished: number;
  skillsListed: number;
  acceptedConnections: number;
  profileViewsUsedToday: number;
  dailyViewQuota: number;
  viewsRemainingToday: number;
  profileViewsReceived: number;
  tier: UserPlan;
  isVerified: boolean;
  role: 'member' | 'admin';
}
