// MockTathastuAdapter - Replaceable Mock Core Integration for Development and Testing
import {
  ITathastuIntegrationAdapter,
  LegacyHarnessProjection,
  TathastuSyncEvent,
} from '../contract/types';
import { validateProfessionalProjection } from '../contract/validator';
import { MOCK_CORE_PERSONAS } from '../fixtures/personas';

export class MockTathastuAdapter implements ITathastuIntegrationAdapter {
  public readonly mode = 'mock' as const;

  public async fetchProjection(sourcePersonId: string): Promise<LegacyHarnessProjection> {
    const raw = MOCK_CORE_PERSONAS[sourcePersonId] || MOCK_CORE_PERSONAS['core_person_rahul'];
    if (!raw) {
      throw new Error(`Mock Tathastu Core persona not found: ${sourcePersonId}`);
    }

    // Validate against contract to guarantee strict compliance
    const validated = validateProfessionalProjection(JSON.parse(JSON.stringify(raw)));
    return validated;
  }

  public async getEligibleDiscoveryMembers(): Promise<LegacyHarnessProjection[]> {
    return Object.values(MOCK_CORE_PERSONAS).filter(
      (p) => p.permissions.importApproved && p.permissions.discoverable
    );
  }

  public async processSyncEvent(event: TathastuSyncEvent): Promise<{
    handled: boolean;
    actionTaken: string;
    affectedMemberId?: string;
    preservedLocalOverrides?: string[];
  }> {
    switch (event.eventType) {
      case 'new_eligible_member':
        return {
          handled: true,
          actionTaken: `Discovered new eligible Core member ${event.sourcePersonId}`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'profile_updated':
        return {
          handled: true,
          actionTaken: `Updated source fields for ${event.sourcePersonId} while preserving local overrides`,
          affectedMemberId: event.sourcePersonId,
          preservedLocalOverrides: ['headline', 'about', 'customProjects'],
        };

      case 'new_confirmed_project':
        return {
          handled: true,
          actionTaken: `Merged verified project from Core into member portfolio`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'approved_skill_updated':
        return {
          handled: true,
          actionTaken: `Synced verified skill endorsements from Core`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'visibility_changed':
        return {
          handled: true,
          actionTaken: `Updated projection visibility flag to ${event.payload?.permissions?.discoverable ? 'discoverable' : 'hidden'}`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'consent_revoked':
        return {
          handled: true,
          actionTaken: `Quarantined and removed Core-projected fields following user consent revocation`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'user_unlinked':
        return {
          handled: true,
          actionTaken: `Severed Core link; preserved standalone Collaborate account and messaging history`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'source_record_deleted':
        return {
          handled: true,
          actionTaken: `Source record deleted upstream; retained Collaborate member record independently`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'user_deactivated':
        return {
          handled: true,
          actionTaken: `Upstream Core account deactivated; Collaborate account remains independently accessible`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'conflicting_local_override':
        return {
          handled: true,
          actionTaken: `Detected conflict; preserved user's custom Collaborate headline and bio overrides`,
          affectedMemberId: event.sourcePersonId,
          preservedLocalOverrides: ['headline', 'about'],
        };

      case 'duplicate_event_delivery':
        return {
          handled: true,
          actionTaken: `Deduplicated event ${event.eventId} idempotently without state duplication`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'out_of_order_event_delivery':
        return {
          handled: false,
          actionTaken: `Rejected stale out-of-order sync event for ${event.sourcePersonId}`,
          affectedMemberId: event.sourcePersonId,
        };

      case 'invalid_source_identity':
        return {
          handled: false,
          actionTaken: `Rejected event: source identity ${event.sourcePersonId} is invalid or unrecognized`,
        };

      case 'invalid_projection_schema':
        return {
          handled: false,
          actionTaken: `Rejected event: payload violates ProfessionalProjectionV1 contract schema`,
        };

      case 'temporary_source_outage':
        return {
          handled: false,
          actionTaken: `Core source outage detected; Collaborate continues in resilient standalone mode`,
        };

      default:
        return {
          handled: false,
          actionTaken: `Unknown sync event type: ${event.eventType}`,
        };
    }
  }
}
