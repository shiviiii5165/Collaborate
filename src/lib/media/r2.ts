/**
 * Media object storage (Cloudflare R2, S3-compatible). Only media bytes live here; every
 * record about a file (owner, type, which post uses it) is a `media_object` document in Postgres.
 *
 * The bucket stays private. Browsers upload with short-lived signed PUT URLs and read with
 * short-lived signed GET URLs, issued only after the API has checked the session.
 *
 * Configuration (read-only; values are set by the operator in the hosting environment):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT
 *
 * Tests install a fake with setMediaStore(); nothing here ever runs against a real bucket in tests.
 */
export interface StoredObjectInfo {
  size: number;
  contentType?: string;
}

export interface MediaStore {
  presignPut(key: string, contentType: string, size: number, expiresSeconds: number): Promise<string>;
  presignGet(key: string, expiresSeconds: number, opts: { contentType: string; downloadName?: string }): Promise<string>;
  head(key: string): Promise<StoredObjectInfo | null>;
  /** First `bytes` bytes of the object (for content sniffing). */
  readPrefix(key: string, bytes: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

export function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET_NAME?.trim();
  const endpoint = env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

class R2MediaStore implements MediaStore {
  private clientPromise: Promise<{ s3: any; sdk: any; presign: any }> | null = null;
  constructor(private readonly cfg: R2Config) {}

  private client() {
    this.clientPromise ??= (async () => {
      const sdk = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const s3 = new sdk.S3Client({
        region: 'auto',
        endpoint: this.cfg.endpoint,
        // https://<account>.r2.cloudflarestorage.com/<bucket>/<key> (one host for CORS and TLS).
        forcePathStyle: true,
        credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey },
        // R2 does not accept the SDK's default CRC32 checksums on presigned PUTs.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      return { s3, sdk, presign: getSignedUrl };
    })();
    return this.clientPromise;
  }

  async presignPut(key: string, contentType: string, size: number, expiresSeconds: number) {
    const { s3, sdk, presign } = await this.client();
    // Content-Type and Content-Length are signed: the browser must upload exactly what was declared.
    const cmd = new sdk.PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType, ContentLength: size });
    return presign(s3, cmd, { expiresIn: expiresSeconds, signableHeaders: new Set(['content-type', 'content-length']) });
  }

  async presignGet(key: string, expiresSeconds: number, opts: { contentType: string; downloadName?: string }) {
    const { s3, sdk, presign } = await this.client();
    const cmd = new sdk.GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: opts.downloadName ? `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, '_')}"` : 'inline',
      ResponseCacheControl: 'private, max-age=300',
    });
    return presign(s3, cmd, { expiresIn: expiresSeconds });
  }

  async head(key: string) {
    const { s3, sdk } = await this.client();
    try {
      const r = await s3.send(new sdk.HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async readPrefix(key: string, bytes: number) {
    const { s3, sdk } = await this.client();
    const r = await s3.send(new sdk.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await r.Body.transformToByteArray());
  }

  async delete(key: string) {
    const { s3, sdk } = await this.client();
    await s3.send(new sdk.DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

let override: MediaStore | null | undefined;
let cached: { cfgKey: string; store: MediaStore } | null = null;

/** The configured store, or null when R2 is not configured (media routes then answer 503). */
export function getMediaStore(): MediaStore | null {
  if (override !== undefined) return override;
  const cfg = readR2Config();
  if (!cfg) return null;
  const cfgKey = `${cfg.endpoint}|${cfg.bucket}|${cfg.accessKeyId}`;
  if (!cached || cached.cfgKey !== cfgKey) cached = { cfgKey, store: new R2MediaStore(cfg) };
  return cached.store;
}

/** Tests only: install a fake store (null = "not configured"; undefined = back to env config). */
export function setMediaStore(store: MediaStore | null | undefined): void {
  override = store;
}
