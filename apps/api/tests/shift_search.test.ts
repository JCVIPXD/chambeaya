import { describe, expect, it } from 'vitest';

import { filterShifts, type SearchableShift } from '../src/modules/marketplace/shift_search.js';

const shifts: SearchableShift[] = [
  { id: 'shift-la-mar', role: 'Mozo de Salón', businessName: 'Restaurante La Mar', industry: 'HOSPITALITY', location: 'Miraflores', workerPayCents: 9000, urgent: true, matchScore: 98 },
  { id: 'shift-cafe', role: 'Barista', businessName: 'Café del Cielo', industry: 'HOSPITALITY', location: 'Barranco', workerPayCents: 9900, urgent: false, matchScore: 95 },
  { id: 'shift-eventos', role: 'Azafata', businessName: 'Eventos Perú', industry: 'EVENTS', location: 'San Isidro', workerPayCents: 11000, urgent: true, matchScore: 76 },
  { id: 'shift-remote', role: 'Asistente virtual', businessName: 'CUMPLE Online', industry: 'RETAIL', location: 'Lima', workerPayCents: 13000, urgent: false, matchScore: 82, modality: 'REMOTO' },
];

describe('filterShifts', () => {
  it('returns urgent hospitality shifts matching a minimum worker pay', () => {
    const results = filterShifts(shifts, { industry: 'HOSPITALITY', urgentOnly: true, minPayCents: 9000 });

    expect(results.map((shift) => shift.id)).toEqual(['shift-la-mar']);
  });

  it('filters by work modality when the offer provides it', () => {
    const results = filterShifts(shifts, { modality: 'REMOTO' });
    expect(results.map((shift) => shift.id)).toEqual(['shift-remote']);
  });
});
