// Versioned Integration Contract: ProfessionalProjectionV1
// Collaborate by AI Tathastu <-> AI Tathastu Core Integration Boundary

export interface EducationRecord {
  id: string;
  institution: string;
  period: string;
  degree: string;
  score?: string;
  verified?: boolean;
}

export interface ApprovedSkillRecord {
  id: string;
  name: string;
  category: 'ml_ai' | 'framework' | 'language' | 'tool' | 'theory';
  verifiedLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  endorsementCount?: number;
  confirmedByCore: boolean;
}

export interface ApprovedProjectRecord {
  id: string;
  title: string;
  featured?: boolean;
  description: string;
  tags: string[];
  stars?: number;
  forks?: number;
  demoUrl?: string;
  repositoryUrl?: string;
  imageUrl?: string;
  sourceOrigin: 'ai_tathastu_core';
  verifiedEvidenceUrl?: string;
}

export interface ApprovedAchievementRecord {
  id: string;
  title: string;
  issuer: string;
  issuedAt: string;
  credentialId?: string;
  badgeUrl?: string;
}

export interface ApprovedLink {
  id: string;
  label: string;
  url: string;
  category: 'github' | 'linkedin' | 'portfolio' | 'huggingface' | 'kaggle' | 'other';
}

export interface ProjectionPermissions {
  importApproved: boolean;
  discoverable: boolean;
  allowedFieldPaths: string[]; // e.g. ["profile.education", "profile.skills", "profile.projects"]
  consentVersion: string; // e.g. "v1.0-20261009"
  consentGrantedAt: string;
}

export interface ProfessionalProjectionV1 {
  schemaVersion: "1.0";
  source: "ai-tathastu";
  sourcePersonId: string;
  sourceVersion: string;
  updatedAt: string;

  profile: {
    displayName: string;
    headline?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    location?: string;
    about?: string;
    education: EducationRecord[];
    skills: ApprovedSkillRecord[];
    projects: ApprovedProjectRecord[];
    achievements: ApprovedAchievementRecord[];
    interests: string[];
    portfolioLinks: ApprovedLink[];
  };

  permissions: ProjectionPermissions;

  // Quarantined fields that must NEVER cross into Collaborate
  quarantinedPrivateData: string[];
}

export type TathastuSyncEventType =
  | 'new_eligible_member'
  | 'profile_updated'
  | 'new_confirmed_project'
  | 'approved_skill_updated'
  | 'visibility_changed'
  | 'consent_revoked'
  | 'user_unlinked'
  | 'source_record_deleted'
  | 'user_deactivated'
  | 'conflicting_local_override'
  | 'duplicate_event_delivery'
  | 'out_of_order_event_delivery'
  | 'invalid_source_identity'
  | 'invalid_projection_schema'
  | 'temporary_source_outage';

export interface TathastuSyncEvent {
  eventId: string;
  eventType: TathastuSyncEventType;
  sourcePersonId: string;
  timestamp: string;
  payload?: Partial<ProfessionalProjectionV1>;
  details?: Record<string, any>;
}

export interface ITathastuIntegrationAdapter {
  readonly mode: 'mock' | 'live';
  fetchProjection(sourcePersonId: string): Promise<ProfessionalProjectionV1>;
  getEligibleDiscoveryMembers(): Promise<ProfessionalProjectionV1[]>;
  processSyncEvent(event: TathastuSyncEvent): Promise<{
    handled: boolean;
    actionTaken: string;
    affectedMemberId?: string;
    preservedLocalOverrides?: string[];
  }>;
}
