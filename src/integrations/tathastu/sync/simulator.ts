// Sync Event Simulator for Future AI Tathastu Core Synchronization
// Simulates the 10 synchronization events specified in Phase P3 Section 16.
import { durableDb } from '@/lib/db/index';
import { getTathastuAdapter, TathastuSyncEvent, TathastuSyncEventType } from '../index';
import { FederationService } from '@/modules/federation/client';
import { TathastuSsoService } from '@/modules/identity/tathastu-sso';

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

      // Events that change imported data re-import the harness projection through the same
      // validated ownership pipeline production uses (never by editing the merged fields).
      case 'profile_updated':
      case 'new_confirmed_project':
      case 'approved_skill_updated': {
        if (member) {
          preservedOverrides = ['headline', 'about', 'local skills', 'local projects'];
          const projection = (await FederationService.fetchApprovedProjection(sourcePersonId)) as any;
          projection.generatedAt = new Date().toISOString();
          TathastuSsoService.importProjection(member, projection);
          await durableDb.saveMemberAsync(member);
          message = `Re-imported AI Tathastu data for member ${member.id}; Collaborate-authored data preserved.`;
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

      case 'consent_revoked':
      case 'user_unlinked':
      case 'source_record_deleted':
      case 'user_deactivated': {
        if (member) {
          TathastuSsoService.unlinkAndPurge(member);
          await durableDb.saveMemberAsync(member);
          message = `AI Tathastu link removed and imported data deleted; Collaborate account and its own data preserved.`;
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

      case 'duplicate_event_delivery': {
        const targetEventId = payload?.duplicateOfEventId || eventId;
        message = `Idempotent delivery check: Event ${targetEventId} was previously processed; duplicate execution suppressed without state corruption.`;
        return {
          eventId,
          eventType,
          sourcePersonId,
          success: true,
          message,
          preservedLocalOverrides: preservedOverrides,
        };
      }

      case 'out_of_order_event_delivery': {
        message = `Out-of-order event delivery rejected: Event timestamp ${payload?.eventTimestamp || 'stale'} is older than current member revision.`;
        return {
          eventId,
          eventType,
          sourcePersonId,
          success: false,
          message,
          preservedLocalOverrides: preservedOverrides,
        };
      }

      case 'invalid_source_identity': {
        message = `Event rejected: Source person identity '${sourcePersonId}' does not conform to Tathastu Core URN format or is unauthorized.`;
        return {
          eventId,
          eventType,
          sourcePersonId,
          success: false,
          message,
        };
      }

      case 'invalid_projection_schema': {
        message = `Event rejected: Payload violates ProfessionalProjectionV1 schema contract (${payload?.errorDetails || 'missing required fields'}).`;
        return {
          eventId,
          eventType,
          sourcePersonId,
          success: false,
          message,
        };
      }

      case 'temporary_source_outage': {
        message = `Upstream Core unavailable (503 Service Unavailable / Timeout). Collaborate resilient circuit breaker activated; local operations continue unaffected.`;
        return {
          eventId,
          eventType,
          sourcePersonId,
          success: false,
          message,
        };
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
