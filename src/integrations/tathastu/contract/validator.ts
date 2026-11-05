// Runtime Validator for LegacyHarnessProjection
import { LegacyHarnessProjection } from './types';

export class ContractValidationError extends Error {
  public validationErrors: string[];
  constructor(message: string, errors: string[]) {
    super(message);
    this.name = 'ContractValidationError';
    this.validationErrors = errors;
  }
}

export function validateProfessionalProjection(data: any): LegacyHarnessProjection {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    throw new ContractValidationError('Invalid payload: expected an object', ['Payload is not an object']);
  }

  if (data.schemaVersion !== '1.0') {
    errors.push(`Invalid schemaVersion: expected "1.0", received "${data.schemaVersion}"`);
  }

  if (data.source !== 'ai-tathastu') {
    errors.push(`Invalid source: expected "ai-tathastu", received "${data.source}"`);
  }

  if (!data.sourcePersonId || typeof data.sourcePersonId !== 'string') {
    errors.push('Missing or invalid sourcePersonId');
  }

  if (!data.sourceVersion || typeof data.sourceVersion !== 'string') {
    errors.push('Missing or invalid sourceVersion');
  }

  if (!data.updatedAt || isNaN(Date.parse(data.updatedAt))) {
    errors.push('Missing or invalid updatedAt timestamp');
  }

  if (!data.profile || typeof data.profile !== 'object') {
    errors.push('Missing or invalid profile object');
  } else {
    const p = data.profile;
    if (!p.displayName || typeof p.displayName !== 'string') {
      errors.push('profile.displayName is required');
    }
    if (p.education !== undefined && !Array.isArray(p.education)) {
      errors.push('profile.education must be an array when provided');
    }
    if (p.skills !== undefined && !Array.isArray(p.skills)) {
      errors.push('profile.skills must be an array when provided');
    }
    if (p.projects !== undefined && !Array.isArray(p.projects)) {
      errors.push('profile.projects must be an array when provided');
    }
    if (p.achievements !== undefined && !Array.isArray(p.achievements)) {
      errors.push('profile.achievements must be an array when provided');
    }

    // Default missing arrays to empty arrays to prevent downstream undefined access
    p.education = Array.isArray(p.education) ? p.education : [];
    p.skills = Array.isArray(p.skills) ? p.skills : [];
    p.projects = Array.isArray(p.projects) ? p.projects : [];
    p.achievements = Array.isArray(p.achievements) ? p.achievements : [];
    p.interests = Array.isArray(p.interests) ? p.interests : [];
    p.portfolioLinks = Array.isArray(p.portfolioLinks) ? p.portfolioLinks : [];

  }

  if (!data.permissions || typeof data.permissions !== 'object') {
    errors.push('Missing or invalid permissions object');
  } else {
    const perm = data.permissions;
    if (typeof perm.importApproved !== 'boolean') {
      errors.push('permissions.importApproved must be a boolean');
    }
    if (typeof perm.discoverable !== 'boolean') {
      errors.push('permissions.discoverable must be a boolean');
    }
  }

  if (errors.length > 0) {
    throw new ContractValidationError(
      `ProfessionalProjectionV1 validation failed: ${errors.join('; ')}`,
      errors
    );
  }

  return data as LegacyHarnessProjection;
}
