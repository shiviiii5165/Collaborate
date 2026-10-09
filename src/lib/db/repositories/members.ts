import { MemberProfile } from '@/lib/types';
import { queryNeon, withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';

export class MembersRepository {
  public static async findById(id: string): Promise<MemberProfile | null> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT m.*, p.* 
         FROM members m 
         LEFT JOIN professional_profiles p ON m.id = p.member_id 
         WHERE m.id = $1`,
        [id]
      );
      if (rows.length === 0) return null;
      return this.mapRowToMember(rows[0]);
    }
    assertDatabaseAvailable();
    return null;
  }

  public static async findByEmail(email: string): Promise<MemberProfile | null> {
    const cleanEmail = email.toLowerCase().trim();
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT m.*, p.* 
         FROM members m 
         LEFT JOIN professional_profiles p ON m.id = p.member_id 
         WHERE LOWER(m.email) = $1`,
        [cleanEmail]
      );
      if (rows.length === 0) return null;
      return this.mapRowToMember(rows[0]);
    }
    assertDatabaseAvailable();
    return null;
  }

  public static async saveMember(member: MemberProfile): Promise<void> {
    if (isNeonConfigured()) {
      await withNeonTransaction(async (client) => {
        // Upsert member
        await client.query(
          `INSERT INTO members (id, email, full_name, role, plan, plan_expires_at, is_verified, verified_category, verified_at, is_under_18, safeguarding_approved, institution_domain, is_demo, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             email = EXCLUDED.email,
             full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             plan = EXCLUDED.plan,
             plan_expires_at = EXCLUDED.plan_expires_at,
             is_verified = EXCLUDED.is_verified,
             verified_category = EXCLUDED.verified_category,
             verified_at = EXCLUDED.verified_at,
             is_under_18 = EXCLUDED.is_under_18,
             safeguarding_approved = EXCLUDED.safeguarding_approved,
             institution_domain = EXCLUDED.institution_domain,
             is_demo = EXCLUDED.is_demo,
             updated_at = CURRENT_TIMESTAMP`,
          [
            member.id,
            member.email.toLowerCase().trim(),
            member.fullName,
            member.role || 'member',
            member.plan || 'free',
            member.planExpiresAt || null,
            Boolean(member.isVerified),
            member.verifiedCategory || null,
            member.verifiedAt || null,
            Boolean(member.isUnder18),
            Boolean(member.safeguardingApproved),
            member.institutionDomain || null,
            Boolean(member.isDemo),
          ]
        );

        // Upsert profile
        await client.query(
          `INSERT INTO professional_profiles (
             member_id, headline, about, avatar_url, banner_url, location, 
             status_badges, context_tags, social_links, metrics, skills, 
             ai_specializations, collaboration_interests, discoverable, 
             profile_visibility, contact_visibility, is_linked_with_tathastu, 
             tathastu_sync_status, tathastu_sync_settings, is_demo, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP
           )
           ON CONFLICT (member_id) DO UPDATE SET
             headline = EXCLUDED.headline,
             about = EXCLUDED.about,
             avatar_url = EXCLUDED.avatar_url,
             banner_url = EXCLUDED.banner_url,
             location = EXCLUDED.location,
             status_badges = EXCLUDED.status_badges,
             context_tags = EXCLUDED.context_tags,
             social_links = EXCLUDED.social_links,
             metrics = EXCLUDED.metrics,
             skills = EXCLUDED.skills,
             ai_specializations = EXCLUDED.ai_specializations,
             collaboration_interests = EXCLUDED.collaboration_interests,
             discoverable = EXCLUDED.discoverable,
             profile_visibility = EXCLUDED.profile_visibility,
             contact_visibility = EXCLUDED.contact_visibility,
             is_linked_with_tathastu = EXCLUDED.is_linked_with_tathastu,
             tathastu_sync_status = EXCLUDED.tathastu_sync_status,
             tathastu_sync_settings = EXCLUDED.tathastu_sync_settings,
             is_demo = EXCLUDED.is_demo,
             updated_at = CURRENT_TIMESTAMP`,
          [
            member.id,
            member.headline || '',
            member.about || '',
            member.avatarUrl || '/images/rahul_avatar.jpg',
            member.bannerUrl || '/images/campus_banner.jpg',
            member.location || '',
            JSON.stringify(member.statusBadges || []),
            JSON.stringify(member.contextTags || []),
            JSON.stringify(member.socialLinks || {}),
            JSON.stringify(member.metrics || {}),
            JSON.stringify(member.skills || []),
            JSON.stringify(member.aiSpecializations || []),
            JSON.stringify(member.collaborationInterests || []),
            member.discoverable ?? true,
            member.profileVisibility || 'public',
            member.contactVisibility || 'connections_only',
            Boolean(member.isLinkedWithTathastu),
            member.tathastuSyncStatus || 'unlinked',
            JSON.stringify(member.tathastuSyncSettings || {}),
            Boolean(member.isDemo),
          ]
        );
      });
      return;
    }
    assertDatabaseAvailable();
  }

  private static mapRowToMember(row: any): MemberProfile {
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      headline: row.headline || '',
      avatarUrl: row.avatar_url || '/images/rahul_avatar.jpg',
      bannerUrl: row.banner_url || '/images/campus_banner.jpg',
      isVerified: Boolean(row.is_verified),
      verifiedCategory: row.verified_category || undefined,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : undefined,
      plan: row.plan || 'free',
      planExpiresAt: row.plan_expires_at ? new Date(row.plan_expires_at).toISOString() : undefined,
      statusBadges: typeof row.status_badges === 'string' ? JSON.parse(row.status_badges) : (row.status_badges || []),
      location: row.location || '',
      about: row.about || '',
      contextTags: typeof row.context_tags === 'string' ? JSON.parse(row.context_tags) : (row.context_tags || []),
      socialLinks: typeof row.social_links === 'string' ? JSON.parse(row.social_links) : (row.social_links || {}),
      metrics: typeof row.metrics === 'string' ? JSON.parse(row.metrics) : (row.metrics || {}),
      skills: typeof row.skills === 'string' ? JSON.parse(row.skills) : (row.skills || []),
      projects: [],
      experience: [],
      education: [],
      recentActivity: [],
      aiSpecializations: typeof row.ai_specializations === 'string' ? JSON.parse(row.ai_specializations) : (row.ai_specializations || []),
      collaborationInterests: typeof row.collaboration_interests === 'string' ? JSON.parse(row.collaboration_interests) : (row.collaboration_interests || []),
      discoverable: Boolean(row.discoverable),
      profileVisibility: row.profile_visibility || 'public',
      contactVisibility: row.contact_visibility || 'connections_only',
      isLinkedWithTathastu: Boolean(row.is_linked_with_tathastu),
      tathastuSyncStatus: row.tathastu_sync_status || 'unlinked',
      tathastuSyncSettings: typeof row.tathastu_sync_settings === 'string' ? JSON.parse(row.tathastu_sync_settings) : (row.tathastu_sync_settings || {}),
      isUnder18: Boolean(row.is_under_18),
      safeguardingApproved: Boolean(row.safeguarding_approved),
      institutionDomain: row.institution_domain || undefined,
      isDemo: Boolean(row.is_demo),
      role: row.role || 'member',
    };
  }
}
