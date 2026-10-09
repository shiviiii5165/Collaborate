/**
 * Supabase & Production PostgreSQL TLS Security Configuration
 *
 * Enforces strict Certificate Authority (CA) validation and full TLS hostname verification.
 * Disallows rejectUnauthorized: false in all production and staging environments.
 * Fails closed on any TLS handshake, certificate expiry, or MITM anomaly.
 */

import fs from 'fs';
import path from 'path';

// Supabase Root 2021 CA Certificate (Official Root for *.pooler.supabase.com & *.supabase.co)
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`.trim();

export interface SslOptions {
  ca?: string;
  rejectUnauthorized: boolean;
  servername?: string;
}

export function getPostgresSslOptions(connectionString: string): SslOptions | boolean {
  // If explicitly disabled for local unencrypted postgres (e.g., localhost dev test)
  if (
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1')
  ) {
    if (!connectionString.includes('sslmode=require')) {
      return false;
    }
  }

  try {
    const parsed = new URL(connectionString);
    const hostname = parsed.hostname;

    // Check if custom CA provided via environment variables
    const customCa = process.env.DATABASE_SSL_CA || process.env.SUPABASE_SSL_CA;
    if (customCa && customCa.trim().length > 0) {
      return {
        ca: customCa.trim(),
        rejectUnauthorized: true,
        servername: hostname,
      };
    }

    // Supabase pooler or direct host
    if (hostname.includes('supabase.com') || hostname.includes('supabase.co')) {
      // Load from cert file if accessible, or fallback to embedded verified Supabase Root CA
      let caCert = SUPABASE_ROOT_CA;
      const certFilePath = path.join(__dirname, 'certs', 'supabase-root-ca.pem');
      try {
        if (fs.existsSync(certFilePath)) {
          caCert = fs.readFileSync(certFilePath, 'utf8').trim();
        }
      } catch {
        // Fallback to embedded SUPABASE_ROOT_CA
      }

      return {
        ca: caCert,
        rejectUnauthorized: true,
        servername: hostname,
      };
    }

    // Default cloud PostgreSQL (e.g. Neon, AWS RDS, Render PostgreSQL)
    // Uses Node system trust store with strict rejectUnauthorized: true
    return {
      rejectUnauthorized: true,
      servername: hostname,
    };
  } catch {
    // If URL parsing fails, fail closed with rejectUnauthorized: true
    return {
      ca: SUPABASE_ROOT_CA,
      rejectUnauthorized: true,
    };
  }
}
