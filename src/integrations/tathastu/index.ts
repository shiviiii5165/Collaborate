// Factory and Adapter Selector for AI Tathastu Core Integration
import { ITathastuIntegrationAdapter } from './contract/types';
import { MockTathastuAdapter } from './mock/adapter';
import { LiveTathastuAdapter } from './live/adapter';

export * from './contract/types';
export * from './contract/validator';
export * from './client';
export * from './fixtures/personas';
export * from './mock/adapter';
export * from './live/adapter';

let cachedAdapter: ITathastuIntegrationAdapter | null = null;

export function getTathastuAdapter(): ITathastuIntegrationAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const mode = process.env.TATHASTU_INTEGRATION_MODE || 'mock';

  // In production, require explicit mock override if mock mode is used
  if (mode === 'live') {
    cachedAdapter = new LiveTathastuAdapter();
  } else {
    cachedAdapter = new MockTathastuAdapter();
  }

  return cachedAdapter;
}

// For testing purposes: allows resetting the singleton
export function resetTathastuAdapter(): void {
  cachedAdapter = null;
}
