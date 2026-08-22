export type ShiftIndustry = 'HOSPITALITY' | 'FOOD_SERVICE' | 'RETAIL' | 'EVENTS';

export interface SearchableShift {
  id: string;
  role: string;
  businessName: string;
  industry: ShiftIndustry;
  location: string;
  workerPayCents: number;
  urgent: boolean;
  matchScore: number;
}

export interface ShiftSearchFilter {
  query?: string;
  industry?: ShiftIndustry;
  minPayCents?: number;
  urgentOnly?: boolean;
  recommendedOnly?: boolean;
}

export function filterShifts(shifts: readonly SearchableShift[], filter: ShiftSearchFilter) {
  const query = filter.query?.trim().toLocaleLowerCase();
  return [...shifts]
      .filter((shift) => !query || [shift.role, shift.businessName, shift.location, shift.industry].join(' ').toLocaleLowerCase().includes(query))
      .filter((shift) => !filter.industry || shift.industry === filter.industry)
      .filter((shift) => !filter.minPayCents || shift.workerPayCents >= filter.minPayCents)
      .filter((shift) => !filter.urgentOnly || shift.urgent)
      .filter((shift) => !filter.recommendedOnly || shift.matchScore >= 80)
      .sort((left, right) => Number(right.urgent) - Number(left.urgent) || right.matchScore - left.matchScore || left.role.localeCompare(right.role));
}
