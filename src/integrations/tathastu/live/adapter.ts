// LiveTathastuAdapter - Production Contract-Ready Core Integration Adapter
// Designed to be activated when AI Tathastu Core services and credentials are live.
import {
  ITathastuIntegrationAdapter,
  LegacyHarnessProjection,
  TathastuSyncEvent,
} from '../contract/types';
import { validateProfessionalProjection } from '../contract/validator';

export class LiveTathastuAdapter implements ITathastuIntegrationAdapter {
  public readonly mode = 'live' as const;
  private readonly baseUrl: string;
  private readonly serviceToken?: string;

  constructor() {
    this.baseUrl = process.env.TATHASTU_CORE_API_URL || 'https://api.aitathastu.com';
    this.serviceToken = process.env.TATHASTU_CORE_SERVICE_TOKEN;
  }

  public async fetchProjection(sourcePersonId: string): Promise<LegacyHarnessProjection> {
    const token = this.serviceToken || process.env.AI_TATHASTU_CLIENT_SECRET;
    if (!token) {
      throw new Error(
        'LIVE_CORE_NOT_CONFIGURED: TATHASTU_CORE_SERVICE_TOKEN or AI_TATHASTU_CLIENT_SECRET is required for LiveTathastuAdapter.'
      );
    }

    const endpoint = process.env.AI_TATHASTU_PROFILE_URL || `${this.baseUrl}/api/integrations/v1/profile`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'X-Collaborate-Contract-Version': '1.0',
        'X-Source-Person-Id': sourcePersonId,
      },
    });

    if (!response.ok) {
      // Try federation fallback if v1 endpoint returned 404
      const fallbackUrl = `${this.baseUrl}/v1/federation/projections/${encodeURIComponent(sourcePersonId)}`;
      const fbRes = await fetch(fallbackUrl, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (fbRes.ok) {
        const rawFb = await fbRes.json();
        return validateProfessionalProjection(rawFb);
      }
      throw new Error(`Live Tathastu Core projection fetch failed: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    return validateProfessionalProjection(raw);
  }


  public async getEligibleDiscoveryMembers(): Promise<LegacyHarnessProjection[]> {
    if (!this.serviceToken) {
      throw new Error(
        'LIVE_CORE_NOT_CONFIGURED: TATHASTU_CORE_SERVICE_TOKEN is required for LiveTathastuAdapter.'
      );
    }

    const response = await fetch(`${this.baseUrl}/v1/federation/discovery/eligible`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Accept': 'application/json',
        'X-Collaborate-Contract-Version': '1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Live Tathastu Core discovery fetch failed: ${response.status} ${response.statusText}`);
    }

    const rawList = await response.json();
    if (!Array.isArray(rawList)) {
      throw new Error('Expected array of eligible discovery members');
    }

    return rawList.map((item) => validateProfessionalProjection(item));
  }

  public async processSyncEvent(event: TathastuSyncEvent): Promise<{
    handled: boolean;
    actionTaken: string;
    affectedMemberId?: string;
    preservedLocalOverrides?: string[];
  }> {
    if (!this.serviceToken) {
      throw new Error('LIVE_CORE_NOT_CONFIGURED: TATHASTU_CORE_SERVICE_TOKEN is required.');
    }

    // In production, acknowledge webhook / event back to Core
    const ackRes = await fetch(`${this.baseUrl}/v1/federation/events/${encodeURIComponent(event.eventId)}/ack`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ receivedAt: new Date().toISOString() }),
    });

    return {
      handled: ackRes.ok,
      actionTaken: `Processed live event ${event.eventType} for ${event.sourcePersonId}`,
      affectedMemberId: event.sourcePersonId,
    };
  }
}
