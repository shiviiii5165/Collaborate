import { DirectMessage, Conversation } from '@/lib/types';
import { queryNeon, withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';
import { ConnectionsRepository } from './connections';
import crypto from 'crypto';

export class MessagesRepository {
  public static async sendMessage(
    senderId: string,
    recipientId: string,
    content: string
  ): Promise<DirectMessage> {
    // 1. Enforce accepted connection
    const areConnected = await ConnectionsRepository.areConnected(senderId, recipientId);
    if (!areConnected) {
      throw new Error('Must be accepted connections to exchange direct messages');
    }

    // 2. Enforce safety block check
    const isBlocked = await ConnectionsRepository.isBlocked(senderId, recipientId);
    if (isBlocked) {
      throw new Error('Cannot deliver message: user is blocked');
    }

    if (isNeonConfigured()) {
      return await withNeonTransaction(async (client) => {
        const [p1, p2] = [senderId, recipientId].sort();

        // Find or create conversation
        let convRes = await client.query(
          `SELECT id FROM conversations WHERE participant_one = $1 AND participant_two = $2`,
          [p1, p2]
        );

        let convId: string;
        if (convRes.rows.length === 0) {
          convId = `conv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          await client.query(
            `INSERT INTO conversations (
               id, participant_one, participant_two, last_message_content, 
               last_message_timestamp, last_message_sender, unread_count_one, 
               unread_count_two, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [convId, p1, p2, content, senderId]
          );
        } else {
          convId = convRes.rows[0].id;
          await client.query(
            `UPDATE conversations SET 
               last_message_content = $1, 
               last_message_timestamp = CURRENT_TIMESTAMP, 
               last_message_sender = $2, 
               updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [content, senderId, convId]
          );
        }

        // Insert direct message
        const msgId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const msgRes = await client.query(
          `INSERT INTO direct_messages (id, conversation_id, sender_id, recipient_id, content, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'delivered', CURRENT_TIMESTAMP)
           RETURNING *`,
          [msgId, convId, senderId, recipientId, content]
        );

        const r = msgRes.rows[0];
        return {
          id: r.id,
          conversationId: r.conversation_id,
          senderId: r.sender_id,
          recipientId: r.recipient_id,
          content: r.content,
          timestamp: new Date(r.created_at).toISOString(),
          status: r.status as any,
        };
      });
    }

    assertDatabaseAvailable();
    throw new Error('Database unavailable');
  }

  public static async getMessages(conversationId: string): Promise<DirectMessage[]> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT * FROM direct_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [conversationId]
      );
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        senderId: r.sender_id,
        recipientId: r.recipient_id,
        content: r.content,
        timestamp: new Date(r.created_at).toISOString(),
        status: r.status as any,
      }));
    }
    assertDatabaseAvailable();
    return [];
  }

  public static async getMissedMessages(
    recipientId: string,
    lastEventId: string
  ): Promise<DirectMessage[]> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT * FROM direct_messages WHERE recipient_id = $1 AND id > $2 ORDER BY created_at ASC`,
        [recipientId, lastEventId]
      );
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        senderId: r.sender_id,
        recipientId: r.recipient_id,
        content: r.content,
        timestamp: new Date(r.created_at).toISOString(),
        status: r.status as any,
      }));
    }
    assertDatabaseAvailable();
    return [];
  }

  public static async getNewMessagesForRecipient(
    recipientId: string,
    sinceTimestamp: string
  ): Promise<DirectMessage[]> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT * FROM direct_messages WHERE recipient_id = $1 AND created_at > $2 ORDER BY created_at ASC`,
        [recipientId, sinceTimestamp]
      );
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        senderId: r.sender_id,
        recipientId: r.recipient_id,
        content: r.content,
        timestamp: new Date(r.created_at).toISOString(),
        status: r.status as any,
      }));
    }
    assertDatabaseAvailable();
    return [];
  }
}
