import { filterShifts, type ShiftIndustry, type ShiftSearchFilter } from './shift_search.js';

export type DemoShiftStatus = 'PUBLISHED' | 'ASSIGNED';

export interface DemoShift {
  id: string;
  role: string;
  businessName: string;
  dateLabel: string;
  location: string;
  rateCents: number;
  feeCents: number;
  workerPayCents: number;
  status: DemoShiftStatus;
  workerId?: string;
  checkInCredential?: string;
  industry: ShiftIndustry;
  urgent: boolean;
  matchScore: number;
}

export class MarketplaceError extends Error {
  constructor(
    public readonly code: 'SHIFT_NOT_FOUND' | 'SHIFT_UNAVAILABLE',
    public readonly statusCode: number,
  ) {
    super(code);
  }
}

export function splitPaymentCents(rateCents: number, feePercent: number) {
  const feeCents = Math.round((rateCents * feePercent) / 100);
  return { feeCents, workerPayCents: rateCents - feeCents };
}

export class DemoMarketplaceService {
  private readonly shifts: DemoShift[];
  private isAvailable = true;

  constructor() {
    const firstPayment = splitPaymentCents(10000, 10);
    const secondPayment = splitPaymentCents(12000, 10);
    this.shifts = [
      {
        id: 'shift-la-mar', role: 'Mozo de Salón', businessName: 'Restaurante La Mar',
        dateLabel: 'Hoy · 18:00 – 00:00', location: 'Miraflores, Lima', rateCents: 10000,
        ...firstPayment, status: 'PUBLISHED', industry: 'HOSPITALITY', urgent: true, matchScore: 98,
      },
      {
        id: 'shift-eventos-peru', role: 'Ayudante de Cocina', businessName: 'Eventos Perú',
        dateLabel: 'Sábado · 10:00 – 18:00', location: 'San Isidro, Lima', rateCents: 12000,
        ...secondPayment, status: 'PUBLISHED', industry: 'EVENTS', urgent: false, matchScore: 88,
      },
    ];
  }

  listAvailableShifts(filter: ShiftSearchFilter = {}) {
    return filterShifts(this.shifts.filter((shift) => shift.status === 'PUBLISHED'), filter);
  }

  acceptShift(workerId: string, shiftId: string) {
    const shift = this.shifts.find((candidate) => candidate.id === shiftId);
    if (!shift) throw new MarketplaceError('SHIFT_NOT_FOUND', 404);
    if (shift.status !== 'PUBLISHED') throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);

    shift.status = 'ASSIGNED';
    shift.workerId = workerId;
    shift.checkInCredential = `DEMO-CUMPLE-${shift.id.toUpperCase()}`;
    return shift;
  }

  activeShift(workerId: string) {
    return this.shifts.find((shift) => shift.workerId === workerId && shift.status === 'ASSIGNED') ?? null;
  }

  updateAvailability(isAvailable: boolean) {
    this.isAvailable = isAvailable;
    return { isAvailable: this.isAvailable };
  }

  wallet() {
    return {
      balanceCents: 20000,
      movements: [
        { id: 'payment-la-mar', description: 'Restaurante La Mar', amountCents: 9000, status: 'RELEASED' },
        { id: 'payment-eventos', description: 'Eventos Perú', amountCents: 11000, status: 'PENDING' },
      ],
    };
  }
}
