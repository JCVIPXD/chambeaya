/**
 * Los turnos temporales siguen existiendo para conservar el historial y sus
 * flujos ya auditados, pero el producto nuevo los mantiene apagados hasta que
 * se decida reutilizarlos para puestos fijos. Solo el valor literal `true`
 * los habilita: una variable ausente o mal escrita nunca reactiva el flujo en
 * producción por accidente.
 */
export function temporaryShiftsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TEMPORARY_SHIFTS_ENABLED === 'true';
}

export const TEMPORARY_SHIFTS_DISABLED_ERROR = 'TEMPORARY_SHIFTS_DISABLED';
