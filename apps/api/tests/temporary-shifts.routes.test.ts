import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { LocalAuthService } from '../src/modules/auth/auth.service.js';
import type { BusinessOperations } from '../src/modules/business/business.service.js';
import type { MarketplaceOperations } from '../src/modules/marketplace/marketplace.service.js';

describe('temporary shifts feature flag', () => {
  it('rejects publishing before parsing or invoking the legacy business flow when disabled', async () => {
    const auth = new LocalAuthService();
    const business = await auth.register({ role: 'BUSINESS', name: 'Empresa', email: 'empresa-m0@example.com', password: 'ClaveSegura1', dniOrRuc: '20123456789' });
    const createShift = vi.fn();
    const app = createApp({ authService: auth, businessService: { createShift } as unknown as BusinessOperations, temporaryShiftsEnabled: false });

    const response = await request(app)
      .post('/api/business/shifts')
      .set('Authorization', `Bearer ${business.token}`)
      .send({ malformed: true });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'TEMPORARY_SHIFTS_DISABLED' });
    expect(createShift).not.toHaveBeenCalled();
  });

  it('rejects applications before reading the shift or invoking the legacy marketplace flow when disabled', async () => {
    const auth = new LocalAuthService();
    const worker = await auth.register({ role: 'WORKER', name: 'Trabajadora', email: 'trabajadora-m0@example.com', password: 'ClaveSegura1', dniOrRuc: '87654321' });
    const applyToShift = vi.fn();
    const app = createApp({ authService: auth, marketplaceService: { applyToShift } as unknown as MarketplaceOperations, temporaryShiftsEnabled: false });

    const response = await request(app)
      .post('/api/shifts/shift-legado/applications')
      .set('Authorization', `Bearer ${worker.token}`)
      .send({ malformed: true });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'TEMPORARY_SHIFTS_DISABLED' });
    expect(applyToShift).not.toHaveBeenCalled();
  });

  it('keeps the historical test workflow available when explicitly enabled', async () => {
    const auth = new LocalAuthService();
    const worker = await auth.register({ role: 'WORKER', name: 'Prueba', email: 'prueba-m0@example.com', password: 'ClaveSegura1', dniOrRuc: '76543210' });
    const applyToShift = vi.fn(async (workerId: string, shiftId: string) => ({ id: 'application-1', workerId, shiftId }));
    const app = createApp({ authService: auth, marketplaceService: { applyToShift } as unknown as MarketplaceOperations, temporaryShiftsEnabled: true });

    const response = await request(app)
      .post('/api/shifts/shift-legado/applications')
      .set('Authorization', `Bearer ${worker.token}`)
      .send({ answers: [] });

    expect(response.status).toBe(201);
    expect(applyToShift).toHaveBeenCalledWith(worker.userId, 'shift-legado', []);
  });
});
