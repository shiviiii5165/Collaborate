import assert from 'assert';

// Test the validation logic directly
function validateBackendBaseUrl(envUrl) {
  if (!envUrl || envUrl.trim().length === 0) {
    throw new Error(
      'Missing required environment variable: COLLABORATE_BACKEND_URL must be configured.'
    );
  }

  const trimmed = envUrl.trim().replace(/^['"]|['"]$/g, '');

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new Error(
      'Malformed environment variable: COLLABORATE_BACKEND_URL must start with http:// or https:// (e.g. https://backend-host.onrender.com)'
    );
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      'Malformed environment variable: COLLABORATE_BACKEND_URL is not a valid absolute URL.'
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      'Malformed environment variable: COLLABORATE_BACKEND_URL must use http: or https: protocol.'
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      'Malformed environment variable: COLLABORATE_BACKEND_URL must not contain embedded user credentials.'
    );
  }

  return trimmed.replace(/\/+$/, '');
}

console.log('--- GATEWAY URL VALIDATION TEST SUITE ---');

// Test 1: Missing URL
assert.throws(
  () => validateBackendBaseUrl(''),
  (err) => {
    assert(err.message.includes('Missing required environment variable'));
    return true;
  },
  'Should fail when missing'
);
console.log('✅ Passed: Missing URL rejected with clear error');

// Test 2: Missing protocol (e.g. collaborate-1-am72.onrender.com)
assert.throws(
  () => validateBackendBaseUrl('collaborate-1-am72.onrender.com'),
  (err) => {
    assert(err.message.includes('must start with http:// or https://'));
    assert(!err.message.includes('collaborate-1-am72')); // doesn't leak raw input
    return true;
  },
  'Should fail when protocol is missing'
);
console.log('✅ Passed: Missing protocol rejected with clear error and no leaks');

// Test 3: Embedded user credentials (e.g. with secret token)
assert.throws(
  () => validateBackendBaseUrl('https://user:SUPER_SECRET_TOKEN@collaborate-1-am72.onrender.com'),
  (err) => {
    assert(err.message.includes('must not contain embedded user credentials'));
    assert(!err.message.includes('SUPER_SECRET_TOKEN')); // MUST NOT leak secret!
    return true;
  },
  'Should reject URLs with credentials and not leak the credentials'
);
console.log('✅ Passed: Embedded secrets rejected without leaking secret in error');

// Test 4: Valid URL with trailing slash
const validWithSlash = validateBackendBaseUrl('https://collaborate-1-am72.onrender.com/');
assert.strictEqual(validWithSlash, 'https://collaborate-1-am72.onrender.com');
console.log('✅ Passed: Valid URL with trailing slash stripped correctly');

// Test 5: Valid URL with quotes
const validWithQuotes = validateBackendBaseUrl('"https://collaborate-1-am72.onrender.com"');
assert.strictEqual(validWithQuotes, 'https://collaborate-1-am72.onrender.com');
console.log('✅ Passed: Valid URL wrapped in quotes handled correctly');

// Test 6: Local development URL (http://127.0.0.1:4099)
const validLocal = validateBackendBaseUrl('http://127.0.0.1:4099');
assert.strictEqual(validLocal, 'http://127.0.0.1:4099');
console.log('✅ Passed: Local HTTP development URL accepted');

console.log('ALL URL VALIDATION CHECKS PASSED (6/6)');
