/**
 * Única fuente de verdad de "quién puede ver el CV de un trabajador".
 *
 * Una empresa solo puede leer el CV de un trabajador cuando se cumplen las dos
 * condiciones a la vez:
 *
 * 1. El trabajador tiene una postulación vigente (`PENDING` o `ACCEPTED`) a un
 *    turno de esa empresa: postularse es el acto explícito con que el
 *    trabajador se presenta a esa empresa (la lista de postulantes ya le entrega
 *    su nombre, correo y DNI). Rechazada, retirada o cancelada, la relación
 *    deja de dar acceso.
 * 2. El perfil del trabajador es visible (`WorkerTalentProfile.isVisible`).
 *    Un perfil oculto -o inexistente- significa que el trabajador no consintió
 *    ser expuesto a empresas, y eso incluye su CV.
 *
 * El CV NO se expone en el directorio de talento ni a una empresa sin
 * postulación: el trabajador nunca eligió compartirlo con todas. Lo usan
 * `listShiftApplications` (indicador `hasCv`) y `downloadApplicantCv`
 * (descarga), de modo que la lista y la descarga nunca discrepan.
 */
export const CV_VIEWABLE_APPLICATION_STATUSES = ['PENDING', 'ACCEPTED'] as const;

export function companyCanViewApplicantCv(input: {
  applicationStatus: string;
  profileIsVisible: boolean | null | undefined;
}): boolean {
  return (
    (CV_VIEWABLE_APPLICATION_STATUSES as readonly string[]).includes(input.applicationStatus) &&
    input.profileIsVisible === true
  );
}
