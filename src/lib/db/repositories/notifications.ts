import { queryNeon, withNeonTransaction, isNeonConfigured, assertDatabaseAvailable } from '../neon';
import crypto from 'crypto';

export interface AppNotification {
  id: string;
  recipientId: string;
  actorId?: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export class NotificationsRepository {
  public static async addNotification(
    recipientId: string,
    type: string,
    title: string,
    body: string,
    actorId?: string
  ): Promise<AppNotification> {
    if (isNeonConfigured()) {
      const id = `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const res = await queryNeon<any>(
        `INSERT INTO notifications (id, recipient_id, actor_id, notification_type, title, body, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, CURRENT_TIMESTAMP)
         RETURNING *`,
        [id, recipientId, actorId || null, type, title, body]
      );
      const r = res[0];
      return {
        id: r.id,
        recipientId: r.recipient_id,
        actorId: r.actor_id || undefined,
        type: r.notification_type,
        title: r.title,
        body: r.body,
        isRead: Boolean(r.is_read),
        createdAt: new Date(r.created_at).toISOString(),
      };
    }
    assertDatabaseAvailable();
    throw new Error('Database unavailable');
  }

  public static async getForUser(recipientId: string): Promise<AppNotification[]> {
    if (isNeonConfigured()) {
      const rows = await queryNeon<any>(
        `SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [recipientId]
      );
      return rows.map((r) => ({
        id: r.id,
        recipientId: r.recipient_id,
        actorId: r.actor_id || undefined,
        type: r.notification_type,
        title: r.title,
        body: r.body,
        isRead: Boolean(r.is_read),
        createdAt: new Date(r.created_at).toISOString(),
      }));
    }
    assertDatabaseAvailable();
    return [];
  }

  public static async markAllRead(recipientId: string): Promise<void> {
    if (isNeonConfigured()) {
      await queryNeon(
        `UPDATE notifications SET is_read = TRUE WHERE recipient_id = $1`,
        [recipientId]
      );
      return;
    }
    assertDatabaseAvailable();
  }
}
