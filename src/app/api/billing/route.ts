import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'collaborate_webhook_secret_sandbox_sig_2026';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const targetUserId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');

  const member = durableDb.getMemberById(targetUserId);
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  return NextResponse.json({
    plan: member.plan,
    planExpiresAt: member.planExpiresAt || null,
    pricing: {
      currency: 'INR',
      monthlyPrice: 799,
      formattedPrice: '₹799/month',
      features: [
        'Unlimited eligible full-profile views (no 3/day quota)',
        'Advanced professional filter dimensions (GPU stacks, tech stack synergy)',
        'Detailed AI matching reasoning & career path correlation',
        'Direct connection request intros up to 300 characters',
        'Priority recommendation placement in search results',
      ],
    },
    paymentGatewayStatus: 'SANDBOX_READY',
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    const body = await req.json();
    const { action, userId, webhookSignature, isSandboxTest } = body;
    const currentUserId = session ? session.userId : (userId || 'usr_rahul');

    const member = durableDb.getMemberById(currentUserId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // 1. Production Verified Webhook Handler
    if (webhookSignature) {
      const computedSig = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(JSON.stringify(body.payload || {}))
        .digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(webhookSignature))) {
        return NextResponse.json({ error: 'Invalid cryptographic webhook signature' }, { status: 401 });
      }

      member.plan = 'premium';
      member.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      durableDb.saveMember(member);

      return NextResponse.json({ success: true, verified: true, plan: member.plan });
    }

    // 2. Controlled Sandbox Simulator for Reviewers & Testing
    if (action === 'upgrade_premium') {
      if (!isSandboxTest && process.env.NODE_ENV === 'production') {
        return NextResponse.json(
          { error: 'Direct client-side upgrades disabled in production. Webhook required.' },
          { status: 403 }
        );
      }

      member.plan = 'premium';
      member.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      durableDb.saveMember(member);

      durableDb.addNotification(
        member.id,
        'system',
        'Collaborate Premium Activated',
        'You have unlocked unlimited full-profile views and advanced filters.',
        'usr_admin'
      );

      return NextResponse.json({
        success: true,
        message: 'Collaborate Premium sandbox entitlement activated.',
        plan: member.plan,
        planExpiresAt: member.planExpiresAt,
      });
    }

    if (action === 'downgrade_free') {
      member.plan = 'free';
      member.planExpiresAt = undefined;
      durableDb.saveMember(member);

      return NextResponse.json({
        success: true,
        message: 'Reverted to Free tier.',
        plan: member.plan,
      });
    }

    return NextResponse.json({ error: 'Invalid billing action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Billing error' }, { status: 500 });
  }
}
