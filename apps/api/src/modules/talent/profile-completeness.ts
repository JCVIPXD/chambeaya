/**
 * Criterio OBJETIVO de "perfil completo" (premio `PROFILE_COMPLETE`, M6).
 *
 * Un perfil está completo cuando cumple TODAS estas secciones obligatorias. Es
 * una lista fija (no un porcentaje) para que el trabajador sepa exactamente qué
 * le falta y para que el resultado no cambie si se añaden señales opcionales al
 * porcentaje `completion` del perfil:
 *
 *  1. `headline`: titular de al menos 10 caracteres.
 *  2. `bio`: presentación de al menos 40 caracteres.
 *  3. `district`: distrito principal.
 *  4. `availability`: al menos un día y un periodo de disponibilidad.
 *  5. `specialties`: al menos una especialidad.
 *  6. `experience`: al menos una experiencia laboral.
 *  7. `cv`: CV (PDF) subido.
 *  8. `photo`: foto de perfil subida.
 *
 * Son opcionales (no se exigen): certificaciones, idiomas, zona de trabajo y el
 * texto libre de disponibilidad. El criterio mide que los datos existan; la
 * calidad de los documentos la valida el administrador (`DOCUMENT_VERIFIED`).
 */
export const PROFILE_COMPLETE_SECTIONS = ['headline', 'bio', 'district', 'availability', 'specialties', 'experience', 'cv', 'photo'] as const;
export type ProfileSection = typeof PROFILE_COMPLETE_SECTIONS[number];

export const PROFILE_HEADLINE_MIN_LENGTH = 10;
export const PROFILE_BIO_MIN_LENGTH = 40;

export type ProfileCompletenessInput = {
  headline: string | null;
  bio: string | null;
  district: string | null;
  availabilityDays: string[];
  availabilityPeriods: string[];
  specialtyCount: number;
  experienceCount: number;
  hasCv: boolean;
  hasPhoto: boolean;
};

/** Secciones obligatorias que aún faltan (vacío = perfil completo). */
export function missingProfileSections(profile: ProfileCompletenessInput): ProfileSection[] {
  const present: Record<ProfileSection, boolean> = {
    headline: (profile.headline?.trim().length ?? 0) >= PROFILE_HEADLINE_MIN_LENGTH,
    bio: (profile.bio?.trim().length ?? 0) >= PROFILE_BIO_MIN_LENGTH,
    district: Boolean(profile.district?.trim()),
    availability: profile.availabilityDays.length > 0 && profile.availabilityPeriods.length > 0,
    specialties: profile.specialtyCount > 0,
    experience: profile.experienceCount > 0,
    cv: profile.hasCv,
    photo: profile.hasPhoto,
  };
  return PROFILE_COMPLETE_SECTIONS.filter((section) => !present[section]);
}

export function isProfileComplete(profile: ProfileCompletenessInput) {
  return missingProfileSections(profile).length === 0;
}
