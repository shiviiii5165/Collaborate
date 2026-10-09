import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId') || 'usr_rahul';

  const member = db.members.get(userId);
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
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId, plan, webhookSecret } = body;

    // Simulate verified webhook event or manual test upgrade
    const member = db.members.get(userId || 'usr_rahul');
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    if (action === 'upgrade_premium') {
      member.plan = 'premium';
      member.planExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      return NextResponse.json({
        success: true,
        message: 'Successfully upgraded to Collaborate Premium!',
        plan: member.plan,
        planExpiresAt: member.planExpiresAt,
      });
    }

    if (action === 'downgrade_free') {
      member.plan = 'free';
      member.planExpiresAt = undefined;
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
