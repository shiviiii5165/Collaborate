// LiveTathastuAdapter — the live side of the harness adapter interface.
//
// AI Tathastu has NO service-level read API: there is no endpoint where an app can read an arbitrary
// person's profile, list "eligible discovery members" or acknowledge events with a shared credential.
// Its only data paths for Collaborate are (1) GET /api/integrations/v1/profile with the USER's own
// 15-minute access token, obtained during a consented sign-in (TathastuSsoService), and (2) signed
// profile.updated / link.revoked webhooks (POST /api/webhooks/tathastu).
//
// An earlier version called invented /v1/federation/* endpoints on a host that doesn't exist
// (api.aitathastu.com) and sent the OAuth CLIENT SECRET as a Bearer token. That would have leaked the
// secret to whoever served that hostname. This adapter now refuses without any network call, so no
// credential can ever be transmitted from here. Callers already handle the refusal: live mode asks the
// member to sign in again (ReauthorizationRequiredError), and the simulator is test-harness only.
import {
  ITathastuIntegrationAdapter,
  LegacyHarnessProjection,
  TathastuSyncEvent,
} from '../contract/types';

export class LiveCoreApiUnsupportedError extends Error {
  constructor(operation: string) {
    super(
      `LIVE_CORE_UNSUPPORTED: AI Tathastu has no service-level API for ${operation}. ` +
        'Profiles are imported with the member\'s own access token at sign-in, and updates arrive as signed webhooks.'
    );
    this.name = 'LiveCoreApiUnsupportedError';
  }
}

export class LiveTathastuAdapter implements ITathastuIntegrationAdapter {
  public readonly mode = 'live' as const;

  public async fetchProjection(_sourcePersonId: string): Promise<LegacyHarnessProjection> {
    throw new LiveCoreApiUnsupportedError('reading another person\'s profile');
  }

  public async getEligibleDiscoveryMembers(): Promise<LegacyHarnessProjection[]> {
    throw new LiveCoreApiUnsupportedError('listing discovery members');
  }

  public async processSyncEvent(_event: TathastuSyncEvent): Promise<{
    handled: boolean;
    actionTaken: string;
    affectedMemberId?: string;
    preservedLocalOverrides?: string[];
  }> {
    throw new LiveCoreApiUnsupportedError('acknowledging events');
  }
}
