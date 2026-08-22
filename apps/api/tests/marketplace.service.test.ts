import { describe, expect, it } from 'vitest';

import { DemoMarketplaceService, splitPaymentCents } from '../src/modules/marketplace/marketplace.service.js';

describe('DemoMarketplaceService', () => {
  it('assigns a published shift and generates a development check-in credential', () => {
    const service = new DemoMarketplaceService();

    const accepted = service.acceptShift('worker-demo', 'shift-la-mar');

    expect(accepted.status).toBe('ASSIGNED');
    expect(accepted.checkInCredential).toMatch(/^DEMO-CUMPLE-/);
  });

  it('rejects accepting an already assigned shift', () => {
    const service = new DemoMarketplaceService();
    service.acceptShift('worker-a', 'shift-la-mar');

    expect(() => service.acceptShift('worker-b', 'shift-la-mar')).toThrow('SHIFT_UNAVAILABLE');
  });

  it('computes a worker payment entirely in cents', () => {
    expect(splitPaymentCents(10000, 10)).toEqual({ feeCents: 1000, workerPayCents: 9000 });
  });
});
