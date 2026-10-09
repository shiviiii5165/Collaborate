import { NextRequest } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const { searchParams } = new URL(req.url);
  const userId = session ? session.userId : (searchParams.get('userId') || 'usr_rahul');

  // Verify Origin if provided
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return new Response('Invalid Origin', { status: 403 });
  }

  let isClosed = false;
  let lastCheckedTime = new Date().toISOString();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: any) => {
        if (isClosed) return;
        controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Initial heartbeat
      sendEvent('connected', { userId, status: 'ready', timestamp: new Date().toISOString() });

      const interval = setInterval(() => {
        if (isClosed) {
          clearInterval(interval);
          return;
        }

        // Check for new messages since lastCheckedTime
        const newMsgs = durableDb.messages.filter(
          (m) => m.recipientId === userId && m.timestamp > lastCheckedTime
        );

        if (newMsgs.length > 0) {
          for (const msg of newMsgs) {
            sendEvent('message', msg);
          }
          lastCheckedTime = new Date().toISOString();
        } else {
          // Send ping heartbeat every 15s to keep connection alive
          sendEvent('ping', { time: Date.now() });
        }
      }, 2000);

      req.signal.addEventListener('abort', () => {
        isClosed = true;
        clearInterval(interval);
      });
    },
    cancel() {
      isClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
