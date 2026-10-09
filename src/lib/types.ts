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
  sourceOrigin?: 'collaborate' | 'tathastu_core';
}

export interface ExperienceItem {
  id: string;
  role: string;
  company: string;
  period: string;
  bullets: string[];
}

export interface EducationItem {
  id: string;
  institution: string;
  period: string;
  degree: string;
  score: string;
}

export interface ActivityItem {
  id: string;
  type: 'github' | 'leetcode' | 'project' | 'publication';
  title: string;
  timeAgo: string;
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
  isUnder18?: boolean;
  role?: 'member' | 'admin';
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
  matchScore: number;
  reason: string;
  sharedInterests: string[];
  mutualCount: number;
}
