import { NextRequest, NextResponse } from 'next/server';
import { durableDb, getKolkataDateKey } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';
import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { z } from 'zod';

const SettingsUpdateSchema = z.object({
  action: z.enum([
    'update_privacy',
    'update_notifications',
    'update_federation_sync',
    'change_password',
    'restrict_account',
    'export_data',
  ]),
  privacy: z
    .object({
      discoverable: z.boolean().optional(),
      profileVisibility: z.enum(['public', 'connections_only', 'private']).optional(),
      contactVisibility: z.enum(['connections_only', 'hidden']).optional(),
    })
    .optional(),
  notificationPreferences: z
    .object({
      connections: z.boolean(),
      messages: z.boolean(),
      verifications: z.boolean(),
      recommendations: z.boolean(),
      securityAlerts: z.boolean(),
    })
    .optional(),
  tathastuSyncSettings: z
    .object({
      autoSyncProjects: z.boolean(),
      autoSyncSkills: z.boolean(),
      autoSyncAchievements: z.boolean(),
    })
    .optional(),
  passwordChange: z
    .object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    })
    .optional(),
  isRestricted: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    const isFixturesAllowed = process.env.COLLABORATE_ENABLE_FIXTURES === 'true';
    const targetUserId = session ? session.userId : isFixturesAllowed ? 'usr_rahul' : null;

    if (!targetUserId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const member = durableDb.getMemberById(targetUserId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const credential = durableDb.getCredential(member.id);
    const mapping = durableDb.getMappingByMemberId('aitathastu_oidc', member.id);

    // Compute remaining quota
    const todayKey = getKolkataDateKey();
    const viewsToday = durableDb.getDistinctDailyViews(member.id, todayKey);
    const uniqueViewIds = new Set(viewsToday.map((v) => v.targetId));
    const quotaRemaining = member.plan === 'premium' ? 999999 : Math.max(0, 3 - uniqueViewIds.size);

    return NextResponse.json({
      success: true,
      settings: {
        profile: {
          id: member.id,
          fullName: member.fullName,
          email: member.email,
          headline: member.headline,
          location: member.location,
          role: member.role || 'member',
          isVerified: member.isVerified,
          verifiedCategory: member.verifiedCategory,
        },
        privacy: {
          discoverable: member.discoverable,
          profileVisibility: member.profileVisibility,
          contactVisibility: member.contactVisibility,
          isUnder18: Boolean(member.isUnder18),
          safeguardingApproved: Boolean(member.safeguardingApproved),
          isRestricted: Boolean(member.isRestricted),
        },
        notifications: member.notificationPreferences || {
          connections: true,
          messages: true,
          verifications: true,
          recommendations: true,
          securityAlerts: true,
        },
        federation: {
          isLinkedWithTathastu: member.isLinkedWithTathastu,
          tathastuSyncStatus: member.tathastuSyncStatus,
          tathastuSyncSettings: member.tathastuSyncSettings,
          externalSubjectId: mapping?.externalSubjectId || null,
          provider: mapping?.provider || null,
          linkedAt: mapping?.createdAt || null,
        },
        membership: {
          plan: member.plan,
          planExpiresAt: member.planExpiresAt || null,
          quotaRemaining,
          quotaLimit: member.plan === 'premium' ? 'unlimited' : 3,
          distinctProfilesViewedToday: uniqueViewIds.size,
          todayKey,
        },
        security: {
          hasPassword: Boolean(credential),
          activeSession: {
            authenticated: true,
            authType: mapping ? 'oidc_federated' : 'password_credentials',
            hostOnlyCookie: true,
            sameSite: 'lax',
          },
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession(req);
    const isFixturesAllowed = process.env.COLLABORATE_ENABLE_FIXTURES === 'true';
    const targetUserId = session ? session.userId : isFixturesAllowed ? 'usr_rahul' : null;

    if (!targetUserId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const member = durableDb.getMemberById(targetUserId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const body = await req.json();
    const validated = SettingsUpdateSchema.parse(body);

    switch (validated.action) {
      case 'update_privacy': {
        if (validated.privacy) {
          if (validated.privacy.discoverable !== undefined) {
            member.discoverable = validated.privacy.discoverable;
          }
          if (validated.privacy.profileVisibility !== undefined) {
            member.profileVisibility = validated.privacy.profileVisibility;
          }
          if (validated.privacy.contactVisibility !== undefined) {
            member.contactVisibility = validated.privacy.contactVisibility;
          }
          durableDb.saveMember(member);
        }
        return NextResponse.json({
          success: true,
          message: 'Privacy and discoverability settings updated successfully.',
          privacy: {
            discoverable: member.discoverable,
            profileVisibility: member.profileVisibility,
            contactVisibility: member.contactVisibility,
          },
        });
      }

      case 'update_notifications': {
        if (validated.notificationPreferences) {
          member.notificationPreferences = validated.notificationPreferences;
          durableDb.saveMember(member);
        }
        return NextResponse.json({
          success: true,
          message: 'Notification preferences updated.',
          notifications: member.notificationPreferences,
        });
      }

      case 'update_federation_sync': {
        if (validated.tathastuSyncSettings) {
          member.tathastuSyncSettings = validated.tathastuSyncSettings;
          durableDb.saveMember(member);
        }
        return NextResponse.json({
          success: true,
          message: 'AI Tathastu Core sync preferences saved.',
          tathastuSyncSettings: member.tathastuSyncSettings,
        });
      }

      case 'change_password': {
        if (!validated.passwordChange) {
          return NextResponse.json({ error: 'Password change payload required' }, { status: 400 });
        }
        const { currentPassword, newPassword } = validated.passwordChange;

        const credential = durableDb.getCredential(member.id);
        if (credential) {
          const isValid = verifyPassword(currentPassword, credential.passwordHash, credential.salt);
          if (!isValid) {
            return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
          }
        } else {
          // If seeded mock account without credential entry yet
          if (member.email === 'rahulsharma@gmail.com' && currentPassword !== 'rahul1234') {
            return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
          }
        }

        const { hash, salt } = hashPassword(newPassword);
        durableDb.setCredential(member.id, hash, salt);

        durableDb.addNotification(
          member.id,
          'system',
          'Password Changed',
          'Your account password was updated successfully. If you did not make this change, contact support immediately.',
          'usr_admin'
        );

        return NextResponse.json({
          success: true,
          message: 'Password updated successfully.',
        });
      }

      case 'restrict_account': {
        member.isRestricted = Boolean(validated.isRestricted);
        durableDb.saveMember(member);
        return NextResponse.json({
          success: true,
          message: member.isRestricted
            ? 'Account restricted. Your profile is temporarily hidden from directory discovery.'
            : 'Account restriction lifted.',
          isRestricted: member.isRestricted,
        });
      }

      case 'export_data': {
        // Collect all member data for compliance
        const memberConnections = durableDb
          .getAllConnections()
          .filter((c) => c.requesterId === member.id || c.recipientId === member.id);
        const memberMessages = durableDb.messages.filter(
          (m: any) => m.senderId === member.id || m.recipientId === member.id
        );
        const memberNotifications = durableDb.getNotificationsForUser(member.id);

        return NextResponse.json({
          success: true,
          export: {
            exportTimestamp: new Date().toISOString(),
            profile: member,
            connections: memberConnections,
            messages: memberMessages,
            notifications: memberNotifications,
          },
        });
      }

      default:
        return NextResponse.json({ error: 'Unrecognized action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Settings update failed' },
      { status: error.name === 'ZodError' ? 422 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { password, confirmation } = body;

    if (confirmation !== 'DELETE MY ACCOUNT') {
      return NextResponse.json(
        { error: "Confirmation phrase mismatch. Type 'DELETE MY ACCOUNT' to proceed." },
        { status: 400 }
      );
    }

    const member = durableDb.getMemberById(session.userId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Verify password if credential exists
    const credential = durableDb.getCredential(member.id);
    if (credential) {
      const isValid = verifyPassword(password || '', credential.passwordHash, credential.salt);
      if (!isValid) {
        return NextResponse.json({ error: 'Password verification failed' }, { status: 400 });
      }
    }

    // Unlink Tathastu mapping if present
    const mapping = durableDb.getMappingByMemberId('aitathastu_oidc', member.id);
    if (mapping) {
      durableDb.removeMapping(mapping.id);
    }

    // Soft-deactivate/anonymize member record to avoid cascading message breaks
    member.profileVisibility = 'private';
    member.discoverable = false;
    member.headline = 'Deactivated Account';
    member.about = 'This Collaborate account has been deleted by the user.';
    member.isRestricted = true;
    member.isLinkedWithTathastu = false;
    member.tathastuSyncStatus = 'unlinked';
    durableDb.saveMember(member);

    return NextResponse.json({
      success: true,
      message: 'Account deleted and deactivated successfully.',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Deletion failed' }, { status: 500 });
  }
}
