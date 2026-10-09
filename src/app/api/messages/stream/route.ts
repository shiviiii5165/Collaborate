import { NextRequest } from 'next/server';
import { durableDb } from '@/lib/db/index';
import { getSession } from '@/lib/auth/session';
import { isNeonConfigured } from '@/lib/db/neon';
import { MessagesRepository } from '@/lib/db/repositories/messages';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return new Response('Unauthorized: Valid session cookie required for real-time stream', { status: 401 });
  }
  const userId = session.userId;
  const { searchParams } = new URL(req.url);

  // Verify Origin if provided
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return new Response('Invalid Origin', { status: 403 });
  }

  // Check Last-Event-ID for missed event replay on reconnect
  const lastEventId = req.headers.get('last-event-id') || searchParams.get('sinceId');
  let isClosed = false;
  let lastCheckedTime = new Date().toISOString();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any, id?: string) => {
        if (isClosed) return;
        const idHeader = id ? `id: ${id}\n` : '';
        controller.enqueue(new TextEncoder().encode(`${idHeader}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Initial heartbeat
      sendEvent('connected', { userId, status: 'ready', timestamp: new Date().toISOString() });

      // Replay any missed messages if lastEventId was provided
      if (lastEventId) {
        if (isNeonConfigured()) {
          try {
            const missed = await MessagesRepository.getMissedMessages(userId, lastEventId);
            for (const msg of missed) {
              sendEvent('message', msg, msg.id);
            }
          } catch (err) {
            console.error('Error fetching missed messages from Neon:', err);
          }
        } else {
          const missed = durableDb.messages.filter(
            (m) => m.recipientId === userId && m.id > lastEventId
          );
          for (const msg of missed) {
            sendEvent('message', msg, msg.id);
          }
        }
      }

      const interval = setInterval(async () => {
        if (isClosed) {
          clearInterval(interval);
          return;
        }

        // Check for new messages since lastCheckedTime
        let newMsgs: any[] = [];
        if (isNeonConfigured()) {
          try {
            newMsgs = await MessagesRepository.getNewMessagesForRecipient(userId, lastCheckedTime);
          } catch (err) {
            console.error('Error checking new messages from Neon:', err);
          }
        } else {
          newMsgs = durableDb.messages.filter(
            (m) => m.recipientId === userId && m.timestamp > lastCheckedTime
          );
        }

        if (newMsgs.length > 0) {
          for (const msg of newMsgs) {
            sendEvent('message', msg, msg.id);
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
