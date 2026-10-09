import { NextRequest, NextResponse } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';
import { FederationService } from '@/modules/federation/client';
import { IdentityService } from '@/modules/identity/service';

import { TathastuSyncSimulator } from '@/integrations/tathastu/sync/simulator';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const userId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');

  if (action === 'get_projection') {
    const sourcePersonId = searchParams.get('sourcePersonId') || 'core_person_rahul';
    const projection = await FederationService.fetchApprovedProjection(sourcePersonId);
    return NextResponse.json(projection);
  }

  const member = durableDb.getMemberById(userId);
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  return NextResponse.json({
    isLinked: member.isLinkedWithTathastu,
    syncStatus: member.tathastuSyncStatus,
    syncSettings: member.tathastuSyncSettings,
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const { action, syncSettings, sourcePersonId, eventType, payload } = body;
    const userId = session ? session.userId : (body.userId || 'usr_rahul');

    if (action === 'simulate_sync_event') {
      const report = await TathastuSyncSimulator.simulateEvent(
        eventType || 'profile_updated',
        sourcePersonId || 'core_person_rahul',
        payload
      );
      return NextResponse.json({ success: true, report });
    }

    const member = durableDb.getMemberById(userId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (action === 'one_click_import') {
      const personId = sourcePersonId || 'core_person_rahul';
      const projection = await FederationService.fetchApprovedProjection(personId);
      const updated = await FederationService.syncProjectionToMember(userId, projection, syncSettings);
      return NextResponse.json({
        success: true,
        message: 'Successfully generated profile draft from AI Tathastu Core',
        member: updated,
      });
    }

    if (action === 'update_sync_settings') {
      member.tathastuSyncSettings = syncSettings;
      durableDb.saveMember(member);
      return NextResponse.json({ success: true, syncSettings: member.tathastuSyncSettings });
    }

    if (action === 'revoke_link') {
      await IdentityService.unlinkAccount(userId);
      return NextResponse.json({
        success: true,
        message: 'Tathastu Core link revoked. Collaborate account remains active independently.',
      });
    }

    return NextResponse.json({ error: 'Unknown federation action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Federation action failed' }, { status: 500 });
  }
}
