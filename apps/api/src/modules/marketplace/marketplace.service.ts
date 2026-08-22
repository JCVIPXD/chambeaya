import { PrismaClient, type Company, type Shift } from '@prisma/client';

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

export interface MarketplaceOperations {
  listAvailableShifts(filter?: ShiftSearchFilter): Promise<DemoShift[]> | DemoShift[];
  acceptShift(workerId: string, shiftId: string): Promise<DemoShift> | DemoShift;
  activeShift(workerId: string): Promise<DemoShift | null> | DemoShift | null;
  updateAvailability(isAvailable: boolean): Promise<{ isAvailable: boolean }> | { isAvailable: boolean };
  wallet(): Promise<unknown> | unknown;
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

export class DemoMarketplaceService implements MarketplaceOperations {
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

type PublishedShift = Shift & { company: Company };

export class DatabaseMarketplaceService implements MarketplaceOperations {
  constructor(private readonly prisma = new PrismaClient()) {}
  private readonly activeShifts = new Map<string, DemoShift>();

  async listAvailableShifts(filter: ShiftSearchFilter = {}) {
    const shifts = await this.prisma.shift.findMany({
      where: { status: 'PUBLISHED', endsAt: { gt: new Date() } },
      include: { company: true },
      orderBy: [{ rescueActive: 'desc' }, { startsAt: 'asc' }],
    });
    return filterShifts(shifts.map(toMarketplaceShift), filter);
  }

  async acceptShift(workerId: string, shiftId: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id: shiftId, status: 'PUBLISHED', endsAt: { gt: new Date() } },
      include: { company: true },
    });
    if (!shift) throw new MarketplaceError('SHIFT_UNAVAILABLE', 409);
    const accepted = {
      ...toMarketplaceShift(shift),
      status: 'ASSIGNED' as const,
      workerId,
      checkInCredential: `LOCAL-CUMPLE-${shift.id.toUpperCase()}`,
    };
    this.activeShifts.set(workerId, accepted);
    return accepted;
  }

  activeShift(workerId: string) {
    return this.activeShifts.get(workerId) ?? null;
  }

  updateAvailability(isAvailable: boolean) {
    return { isAvailable };
  }

  wallet() {
    return {
      balanceCents: 20_000,
      movements: [
        { id: 'payment-la-mar', description: 'Restaurante La Mar', amountCents: 9000, status: 'RELEASED' },
        { id: 'payment-eventos', description: 'Eventos Perú', amountCents: 11_000, status: 'PENDING' },
      ],
    };
  }
}

function toMarketplaceShift(shift: PublishedShift): DemoShift {
  const now = Date.now();
  const startsSoon = shift.startsAt.getTime() > now && shift.startsAt.getTime() - now <= 24 * 60 * 60 * 1000;
  return {
    id: shift.id,
    role: shift.title,
    businessName: shift.company.name,
    dateLabel: formatSchedule(shift.startsAt, shift.endsAt),
    location: shift.location,
    rateCents: shift.payCents,
    feeCents: 0,
    workerPayCents: shift.payCents,
    status: 'PUBLISHED',
    industry: industryFor(shift.company.industry),
    urgent: shift.rescueActive || startsSoon,
    matchScore: 90,
  };
}

function industryFor(value: string | null): ShiftIndustry {
  const normalized = value?.toLocaleLowerCase() ?? '';
  if (normalized.includes('retail') || normalized.includes('venta')) return 'RETAIL';
  if (normalized.includes('evento')) return 'EVENTS';
  if (normalized.includes('rest') || normalized.includes('alimento') || normalized.includes('gastron')) return 'FOOD_SERVICE';
  return 'HOSPITALITY';
}

function formatSchedule(startsAt: Date, endsAt: Date) {
  const date = new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Lima',
  }).format(startsAt).replace('.', '');
  const time = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Lima',
  });
  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${time.format(startsAt)} – ${time.format(endsAt)}`;
}
