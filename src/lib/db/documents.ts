/**
 * Mapping between the in-memory DatabaseState and rows of `collaborate_documents`
 * (collection, id, doc). Pure functions: used by the runtime store (src/lib/db/index.ts)
 * and by the one-time backfill (scripts/backfill_documents.ts).
 *
 * Granularity is chosen so that writes which must not race share a document:
 *   - one document per member, connection, conversation, message, ...
 *   - the profile-view ledger is one document per (viewer, day), so two instances recording
 *     views for the same viewer at once conflict instead of both exceeding the daily quota.
 *
 * Webhook delivery state is NOT a document: it lives in the `webhook_events` table, where
 * claims are atomic SQL statements.
 */

export type DocKey = string; // `${collection}\u0000${id}`

export const COLLECTIONS = [
  'member',
  'credential',
  'identity_mapping',
  'connection',
  'conversation',
  'message',
  'verification_request',
  'verification_audit',
  'abuse_report',
  'profile_view_day',
  'block',
  'notification',
  'saved_members',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const docKey = (collection: string, id: string): DocKey => `${collection}\u0000${id}`;
export const splitKey = (key: DocKey): [string, string] => {
  const i = key.indexOf('\u0000');
  return [key.slice(0, i), key.slice(i + 1)];
};

/** Minimal structural view of the store state (see DatabaseState in ./index.ts). */
export interface DocumentState {
  members: Record<string, any>;
  credentials: Record<string, any>;
  identityMappings: Record<string, any>;
  connections: Record<string, any>;
  conversations: Record<string, any>;
  messages: any[];
  verificationRequests: Record<string, any>;
  verificationAuditLogs: any[];
  abuseReports: Record<string, any>;
  profileViewLedger: any[];
  blockedUsers: string[];
  notifications: any[];
  savedMembers?: Record<string, string[]>;
  webhookEvents?: Record<string, any>;
}

export function emptyDocumentState(): DocumentState {
  return {
    members: {},
    credentials: {},
    identityMappings: {},
    connections: {},
    conversations: {},
    messages: [],
    verificationRequests: {},
    verificationAuditLogs: [],
    abuseReports: {},
    profileViewLedger: [],
    blockedUsers: [],
    notifications: [],
    savedMembers: {},
    webhookEvents: {},
  };
}

/** Every document the state currently holds, serialized. */
export function enumerateDocuments(state: DocumentState): Map<DocKey, string> {
  const out = new Map<DocKey, string>();
  const put = (c: Collection, id: string, doc: unknown) => out.set(docKey(c, id), JSON.stringify(doc));

  for (const [id, v] of Object.entries(state.members)) put('member', id, v);
  for (const [id, v] of Object.entries(state.credentials)) put('credential', id, v);
  for (const [id, v] of Object.entries(state.identityMappings)) put('identity_mapping', id, v);
  for (const [id, v] of Object.entries(state.connections)) put('connection', id, v);
  for (const [id, v] of Object.entries(state.conversations)) put('conversation', id, v);
  for (const m of state.messages) put('message', m.id, m);
  for (const [id, v] of Object.entries(state.verificationRequests)) put('verification_request', id, v);
  for (const a of state.verificationAuditLogs) put('verification_audit', a.id, a);
  for (const [id, v] of Object.entries(state.abuseReports)) put('abuse_report', id, v);
  for (const n of state.notifications) put('notification', n.id, n);
  for (const key of state.blockedUsers) put('block', key, { key });
  for (const [userId, ids] of Object.entries(state.savedMembers || {})) put('saved_members', userId, { ids });

  const days = new Map<string, any[]>();
  for (const e of state.profileViewLedger) {
    const id = `${e.viewerId}|${e.dateKey}`;
    if (!days.has(id)) days.set(id, []);
    days.get(id)!.push(e);
  }
  for (const [id, entries] of days) put('profile_view_day', id, { entries });
  return out;
}

function upsertById(arr: any[], doc: any | null, id: string) {
  const idx = arr.findIndex((x) => x.id === id);
  if (doc === null) {
    if (idx !== -1) arr.splice(idx, 1);
  } else if (idx === -1) arr.push(doc);
  else arr[idx] = doc;
}

/** Applies one stored document (null = deleted) to the state. Unknown collections are ignored. */
export function applyDocument(state: DocumentState, collection: string, id: string, doc: any | null): void {
  const rec = (target: Record<string, any>) => {
    if (doc === null) delete target[id];
    else target[id] = doc;
  };
  switch (collection) {
    case 'member':
      return rec(state.members);
    case 'credential':
      return rec(state.credentials);
    case 'identity_mapping':
      return rec(state.identityMappings);
    case 'connection':
      return rec(state.connections);
    case 'conversation':
      return rec(state.conversations);
    case 'verification_request':
      return rec(state.verificationRequests);
    case 'abuse_report':
      return rec(state.abuseReports);
    case 'message':
      upsertById(state.messages, doc, id);
      if (doc) state.messages.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      return;
    case 'verification_audit':
      return upsertById(state.verificationAuditLogs, doc, id);
    case 'notification':
      return upsertById(state.notifications, doc, id);
    case 'block': {
      const i = state.blockedUsers.indexOf(id);
      if (doc === null) {
        if (i !== -1) state.blockedUsers.splice(i, 1);
      } else if (i === -1) state.blockedUsers.push(id);
      return;
    }
    case 'saved_members': {
      state.savedMembers ??= {};
      if (doc === null) delete state.savedMembers[id];
      else state.savedMembers[id] = Array.isArray(doc.ids) ? doc.ids : [];
      return;
    }
    case 'profile_view_day': {
      const [viewerId, dateKey] = id.split('|');
      state.profileViewLedger = state.profileViewLedger.filter((e) => !(e.viewerId === viewerId && e.dateKey === dateKey));
      if (doc && Array.isArray(doc.entries)) state.profileViewLedger.push(...doc.entries);
      return;
    }
    default:
      return;
  }
}
