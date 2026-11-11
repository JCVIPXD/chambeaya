/// Los turnos temporales son una función heredada. Solo se activan de forma
/// explícita para conservar las pruebas y los entornos de transición.
const temporaryShiftsEnabled = bool.fromEnvironment(
  'TEMPORARY_SHIFTS_ENABLED',
  defaultValue: false,
);
