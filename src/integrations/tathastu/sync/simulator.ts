// Sync Event Simulator for Future AI Tathastu Core Synchronization
// Simulates the 10 synchronization events specified in Phase P3 Section 16.
import { durableDb } from '@/lib/db/index';
import { getTathastuAdapter, TathastuSyncEvent, TathastuSyncEventType } from '../index';

export interface SyncSimulationReport {
  eventId: string;
  eventType: TathastuSyncEventType;
  sourcePersonId: string;
  success: boolean;
  message: string;
  preservedLocalOverrides?: string[];
  stateBefore?: any;
  stateAfter?: any;
}

export class TathastuSyncSimulator {
  public static async simulateEvent(
    eventType: TathastuSyncEventType,
    sourcePersonId: string,
    payload?: any
  ): Promise<SyncSimulationReport> {
    const adapter = getTathastuAdapter();
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const event: TathastuSyncEvent = {
      eventId,
      eventType,
      sourcePersonId,
      timestamp: new Date().toISOString(),
      payload,
    };

    // 1. Let the adapter process the event
    const adapterResult = await adapter.processSyncEvent(event);

    // 2. Perform durable store mutations for simulation
    let message = adapterResult.actionTaken;
    let preservedOverrides: string[] = adapterResult.preservedLocalOverrides || [];

    // Find if a local Collaborate member is linked to this external subject
    const mapping = durableDb.getMappingByExternalSub('aitathastu_oidc', sourcePersonId);
    const member = mapping ? durableDb.getMemberById(mapping.memberId) : null;

    switch (eventType) {
      case 'new_eligible_member': {
        message = `Discovered new eligible Core member: ${sourcePersonId}. Eligible for directory discovery if consent granted.`;
        break;
      }

      case 'profile_updated': {
        if (member) {
          // Preserve local overrides: never overwrite custom headline or about if modified locally
          preservedOverrides = ['headline', 'about'];
          if (payload?.profile?.skills) {
            const skillSet = new Set(member.skills);
            for (const s of payload.profile.skills) {
              skillSet.add(typeof s === 'string' ? s : s.name);
            }
            member.skills = Array.from(skillSet);
          }
          durableDb.saveMember(member);
          message = `Updated member ${member.id} while preserving custom headline and bio overrides.`;
        }
        break;
      }

      case 'new_confirmed_project': {
        if (member && payload?.project) {
          const exists = member.projects.some((p) => p.title === payload.project.title);
          if (!exists) {
            member.projects.push({
              id: payload.project.id || `proj_${Date.now()}`,
              title: payload.project.title,
              description: payload.project.description || '',
              tags: payload.project.tags || [],
              sourceOrigin: 'tathastu_core',
              featured: false,
            });
            durableDb.saveMember(member);
          }
          message = `Merged verified Core project into portfolio for member ${member.id}.`;
        }
        break;
      }

      case 'approved_skill_updated': {
        if (member && payload?.skillName) {
          if (!member.skills.includes(payload.skillName)) {
            member.skills.push(payload.skillName);
            durableDb.saveMember(member);
          }
          message = `Added approved skill ${payload.skillName} to member ${member.id}.`;
        }
        break;
      }

      case 'visibility_changed': {
        if (member && payload?.discoverable !== undefined) {
          member.discoverable = Boolean(payload.discoverable);
          durableDb.saveMember(member);
          message = `Updated discoverability for member ${member.id} to ${member.discoverable}.`;
        }
        break;
      }

      case 'consent_revoked': {
        if (member) {
          // Remove Tathastu synced projects, revert sync status
          member.projects = member.projects.filter((p) => p.sourceOrigin !== 'tathastu_core');
          member.tathastuSyncStatus = 'unlinked';
          member.isLinkedWithTathastu = false;
          durableDb.saveMember(member);
          message = `Consent revoked by user. Quarantined Core projects removed; Collaborate account preserved.`;
        }
        break;
      }

      case 'user_unlinked': {
        if (member) {
          member.isLinkedWithTathastu = false;
          member.tathastuSyncStatus = 'unlinked';
          if (mapping) durableDb.removeMapping(mapping.id);
          durableDb.saveMember(member);
          message = `User unlinked cleanly. Collaborate account remains active independently.`;
        }
        break;
      }

      case 'source_record_deleted': {
        if (member) {
          member.isLinkedWithTathastu = false;
          member.tathastuSyncStatus = 'unlinked';
          durableDb.saveMember(member);
          message = `Upstream Core record deleted. Retained Collaborate member record without data loss.`;
        }
        break;
      }

      case 'user_deactivated': {
        if (member) {
          member.isLinkedWithTathastu = false;
          durableDb.saveMember(member);
          message = `Upstream Core account deactivated. Collaborate account preserved.`;
        }
        break;
      }

      case 'conflicting_local_override': {
        if (member) {
          preservedOverrides = ['headline', 'about'];
          message = `Conflict resolved: Local member overrides take precedence over remote Core values.`;
        }
        break;
      }
    }

    return {
      eventId,
      eventType,
      sourcePersonId,
      success: true,
      message,
      preservedLocalOverrides: preservedOverrides,
    };
  }
}
