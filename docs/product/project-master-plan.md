# Plan maestro de pendientes de Chambeaya

Actualizado: 16 de septiembre de 2026

## Objetivo

Este documento es el inventario único de trabajo pendiente para llevar la versión
actual, todavía híbrida entre producto real y demostración, a un piloto operativo.
El orden prioriza un flujo vertical verificable antes de integrar identidad externa,
documentos, dinero o automatizaciones de mayor riesgo.

El flujo que debe quedar cerrado primero es:

1. la empresa publica un turno;
2. un trabajador con perfil real lo encuentra y se postula;
3. la empresa filtra, revisa y selecciona;
4. ambas partes coordinan, confirman asistencia y cierran el turno;
5. el sistema deriva reputación, historial y obligaciones desde hechos persistidos.

## Estado de partida

Ya existen API Express, Prisma/PostgreSQL, panel Next.js y app Flutter. Registro,
sesiones, turnos, postulaciones, asignaciones, conversaciones, mensajes,
confirmación, check-in, check-out, cancelaciones, eventos y registros económicos
tienen una primera implementación persistente. El perfil profesional global y la
búsqueda empresarial por talento también tienen una primera entrega.

Todavía quedan comportamientos de demostración o incompletos: alertas locales,
pagos sin proveedor real y afirmaciones visuales que no siempre tienen evidencia.
Google Sign-In, el perfil profesional, la carga privada de CV y la foto de
perfil ya funcionan para el piloto local; aún requieren endurecimiento y
proveedores de producción antes de exponerse públicamente.

## Reglas de ejecución

- Un dato visible debe provenir de PostgreSQL o declararse explícitamente como demo.
- Ninguna pantalla mostrará “verificado”, “protegido”, “pagado” o una puntuación sin
  evidencia y regla de cálculo auditable.
- El modo demo se conservará como un entorno separado; no será el comportamiento
  predeterminado de una compilación de piloto o producción.
- Cada incremento incluirá migración, autorización, estados de carga/vacío/error,
  pruebas y actualización de contratos/documentación.
- Google, CV y pagos se abordarán después de cerrar el flujo de talento y operación,
  aunque sus límites y contratos se diseñen desde ahora.

## Orden de entrega

### Bloque 0 — Verdad del producto y base de entrega

Objetivo: eliminar ambigüedades entre demo y producto real antes de seguir ampliando.

- **Separar los entornos demo, desarrollo, piloto y producción (P0, completado en código).** Cambiar la app
  móvil para que el repositorio HTTP sea el predeterminado fuera de un flavor demo;
  centralizar URLs y banderas por entorno y evitar fallback silencioso a datos
  locales. Cierre: una compilación de piloto no puede iniciar con usuarios, turnos o
  perfiles ficticios.
- **Retirar afirmaciones y métricas sin fuente real (P0, completado).** Eliminar la actividad
  empresarial escrita en `page.tsx`, el `matchScore = 90`, defaults optimistas del
  cliente y badges sin evidencia. Los vacíos deben mostrarse como “sin datos”.
  Cierre: una búsqueda automatizada y pruebas de interfaz confirman que el flujo real
  no fabrica puntuaciones, actividad, verificación ni protección de pago.
- **Aplicar y validar las migraciones recientes (P0, aplicado en piloto local).** Ejecutar la migración del
  perfil de talento sobre PostgreSQL aislado, probar rollback operativo mediante
  respaldo/restauración y actualizar la semilla solo para demo. Cierre: API, web y
  Flutter usan el mismo esquema en una base limpia y en una base actualizada.
- **Cerrar deuda de calidad inmediata (P1, completado salvo la observación de la primera
  corrida remota).** Resolver los avisos relevantes de
  `flutter analyze`, observar las primeras corridas remotas y fijar por SHA completo
  `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` y
  `subosito/flutter-action`. Cierre: CI reproducible, sin referencias ejecutables
  mutables y con build/pruebas verdes. Las cuatro acciones están fijadas por SHA
  completo y verificadas contra la API de GitHub en la auditoría `CN-20260916-093`;
  `flutter analyze` no reporta ningún error. Al cierre de `CN-20260916-093` quedaban 15
  avisos `info` de estilo, dos de ellos en `worker_pages.dart`; tras eliminar ese archivo
  en `CN-20260918-007` son 11 (`curly_braces_in_flow_control_structures` ×10 y
  `unnecessary_to_list_in_spreads` ×1), verificados en la auditoría `CN-20260918-008`; desde
  `CN-20260921-007` son 10, porque ese aviso `unnecessary_to_list_in_spreads` desapareció al
  reescribir la lista de "Mis postulaciones" (medido en `CN-20260921-008`). En
  esa misma foto de `CN-20260916-093`,
  `flutter test` (67/67), la suite de la API (113/113) y la prueba vertical de
  integración contra PostgreSQL real (2/2) pasaban; los totales al 2026-09-18
  eran 88/88 en Flutter y 156/156 en la API (los vigentes están más abajo, en el ciclo de
  simplificación radical: 114/114 y 190/190). **Pendiente:** ninguna corrida de
  GitHub Actions ha ocurrido todavía porque el árbol de trabajo, incluido `.github/`,
  no está versionado; hay que confirmar la primera ejecución remota tras el commit.

### Bloque 1 — Perfil profesional y descubrimiento de talento

Objetivo: convertir al trabajador en una identidad profesional global y consultable.

- **Completar el perfil personalizable (P0, completado: servidor y Flutter).** Añadir experiencia laboral,
  certificaciones como metadatos, idiomas, preferencia de turnos, radio/distritos de
  trabajo y reglas de visibilidad. Mantener DNI, correo, teléfono y notas internas
  fuera del resultado público. Cierre: el trabajador puede crear, editar, ocultar y
  recuperar su perfil completo desde Flutter.
  - **Servidor entregado y auditado** (`CN-20260915-086`, aprobado en `CN-20260916-087`):
    `WorkerExperience`, `WorkerCertification` (sin ningún campo de verificación),
    `WorkerLanguage` (único por perfil e idioma), `workRadiusKm`/`workDistricts` y cuatro
    banderas de visibilidad por sección que solo afectan la tarjeta pública, nunca el
    perfil propio del trabajador ni los datos almacenados. `completion` recalculado sobre
    13 señales (antes el divisor fijo en 9 con un máximo real de 8 impedía llegar a 100%).
    La preferencia de turnos ya estaba cubierta por `availabilityDays`/`availabilityPeriods`.
    Migración `20260916120000_worker_profile_sections` verificada contra PostgreSQL 18 real.
  - **Flutter entregado y auditado** (`CN-20260916-088`, aprobado en `CN-20260916-089`):
    `profile_home_page.dart` muestra las cuatro secciones nuevas con su estado vacío y su
    indicador de visibilidad, y el editor permite crear, editar, eliminar, ocultar y
    recuperar cada una (radio/distritos, experiencia, certificaciones e idiomas), cada
    sección con su propio interruptor independiente. `talent_profile_repository.dart`
    envía por `PATCH` exactamente el contrato que acepta `profileSchema`, verificado en
    auditoría enviando el JSON real del cliente contra el esquema del servidor. La
    interfaz de certificaciones no muestra ningún ícono, color ni texto que insinúe
    "verificado", y un perfil anterior a este alcance se carga y edita sin error con los
    mismos valores por defecto del servidor (radio `null`, listas vacías, cuatro banderas
    en `true`). Con esto el criterio de cierre del ítem queda cumplido.
- **Separar perfil global de contacto empresarial (P0, completado).** Renombrar o migrar el
  `WorkerProfile` ligado a empresa a un concepto como `CompanyWorkerContact`. Retirar
  de ese CRUD `cumpleScore`, `matchScore`, trabajos completados y verificación; esos
  campos serán derivados globalmente. Cierre: no existe una segunda fuente editable
  de reputación o especialidad.
- **Terminar la búsqueda empresarial (P0, completado).** Conectar en web especialidad,
  distrito, disponibilidad y texto libre; conservar paginación por cursor, orden
  estable e índices de base.
  - Sub-ítem de nomenclatura, completado: separar visualmente “Talento disponible”
    de “Equipo/contactos”. La vista “Trabajadores” del panel empresarial tiene dos
    secciones rotuladas e independientes, cada una con su propia fuente de datos y
    sus propios filtros; el directorio global consume `GET /api/business/talent` y
    los contactos de empresa se filtran en cliente (`CN-20260915-070`, auditado en
    `CN-20260915-071`). El panel “Resumen” ya no duplica ese rótulo sobre contactos
    de empresa: se renombró a “Equipo / contactos”, se retiró el chip “Índice
    CUMPLE” (huérfano, sin campo `score` en `Worker`) y se retiró el botón que
    simulaba una invitación enviada sin llamar a ninguna API (`CN-20260915-072`,
    corrige el hallazgo MEDIO-2 de `CN-20260915-071`, auditado en
    `CN-20260915-073`).
  - Búsqueda en el servidor, entregada: `GET /api/business/talent` acepta
    `specialtyId`, `district` (exacto insensible), `query` (texto libre de hasta
    100 caracteres sobre nombre, titular y distrito) y `availableOnly`, todos
    combinables, conservando el orden por `id` ascendente y la paginación por
    cursor. El panel empresarial conecta los cuatro controles al servidor, con
    debounce de 300 ms en los dos campos de texto, y distingue el error de carga
    del resultado vacío. No se añadió índice para el texto libre: el existente
    `([isVisible, isAvailable, district])` cubre los filtros indexables y un
    índice `pg_trgm` se difiere hasta que el catálogo crezca (Alcance 4 del plan
    `.claude/plans/2026-09-15-refuerzo-piloto-talento.md`, `CN-20260915-074`).
  - Paginación estable en la interfaz, entregada: el hallazgo MEDIO que
    `CN-20260915-075` dejó abierto sobre “Ver más perfiles” quedó corregido. El
    indicador de carga de la paginación ya se reinicia siempre al terminar la
    petición, así que cambiar un filtro con una página en vuelo no deja el botón
    deshabilitado en “Cargando…” para el resto de la sesión; la respuesta
    obsoleta se sigue descartando para que no contamine el filtro vigente
    (`CN-20260915-076`, auditado en `CN-20260915-077`). La regresión queda
    cubierta por `apps/web/e2e/talent-load-more.spec.ts`.
  - Cierre: los filtros se ejecutan en el servidor, no exponen datos privados y
    la paginación por cursor sigue operativa tras cambiar filtros.
- **Persistir invitaciones y contacto (P0, completado: servidor, panel web y Flutter).** Crear una entidad `TalentInvitation`
  con empresa, trabajador, turno opcional, estado, vencimiento y auditoría. Abrir una
  conversación solo con una regla de consentimiento válida. Cierre: ningún botón de
  contactar o invitar simula éxito ni permite enumerar datos privados.
  - Servidor, entregado: modelo `TalentInvitation` (empresa, `WorkerTalentProfile`,
    turno opcional, estado, `expiresAt` y actor que la creó) con migración propia, y
    cinco rutas — `POST`/`GET /api/business/talent-invitations` y
    `GET`/`POST … /accept`/`POST … /decline` en `/api/workers/me/talent-invitations`.
    La invitación referencia `WorkerTalentProfile.id`, nunca el `userId` del
    trabajador, que jamás se serializa a la empresa. Una empresa solo ve sus propias
    invitaciones y un trabajador solo ve o responde las suyas (una ajena responde el
    mismo `404` que una inexistente). Un perfil inexistente y uno no visible responden
    idéntico `404 TALENT_PROFILE_NOT_AVAILABLE`. El vencimiento es de 7 días fijado y
    evaluado en el servidor. Aceptar una invitación **no** abre ninguna conversación:
    `POST /api/business/conversations` sigue exigiendo un `CompanyWorkerContact`
    (Alcance 5a del plan `.claude/plans/2026-09-15-refuerzo-piloto-talento.md`,
    `CN-20260915-078`, auditado en `CN-20260915-079`).
  - Panel web empresarial, entregado: se retiró el botón simulado de cabecera y cada
    tarjeta de "Talento disponible" tiene un botón "Invitar" que llama de verdad a
    `POST /api/business/talent-invitations`; el rótulo "Invitación enviada" solo
    aparece tras una respuesta `2xx` real o cuando el listado del servidor ya muestra
    una invitación activa (`PENDING`/`ACCEPTED`) para ese perfil, nunca de forma
    optimista. Los errores esperados se muestran por tarjeta: `409
    INVITATION_ALREADY_ACTIVE` como duplicado y `404 TALENT_PROFILE_NOT_AVAILABLE`
    con un mensaje único que no distingue "no existe" de "no visible", preservando la
    no enumeración del servidor. La sección "Invitaciones enviadas" lista
    `GET /api/business/talent-invitations` con estados de carga, vacío y error, e
    imprime el `message` de la invitación siempre como texto (nunca HTML: no existe
    ningún `dangerouslySetInnerHTML` en `apps/web`). Cubierto por
    `apps/web/e2e/talent-invite.spec.ts` (Alcance 5b, `CN-20260915-080`, auditado en
    `CN-20260915-081`).
  - App del trabajador (Flutter), entregada: con esto el ítem queda cerrado. Un
    quinto destino "Invitaciones" en la navegación del trabajador abre
    `WorkerInvitationsPage`, que lista `GET /api/workers/me/talent-invitations` con
    estados explícitos de carga, vacío y error con reintento. Cada invitación
    `PENDING` y no vencida ofrece "Aceptar"/"Rechazar", que llaman de verdad a
    `POST … /accept` y `POST … /decline` con el token de la sesión real del
    trabajador; la tarjeta solo cambia de estado con el objeto que devuelve el
    servidor tras un `200`, nunca de forma optimista, y un fallo muestra el motivo
    real (`INVITATION_EXPIRED`, `INVITATION_NOT_PENDING`, `INVITATION_NOT_FOUND`) y
    recarga el listado completo. Una invitación ya respondida, vencida o cancelada
    solo muestra su estado, sin botones. El modelo del cliente reproduce exactamente
    las nueve claves de `toWorkerInvitation` y no incluye el `userId` del trabajador
    ni ningún otro dato que el servidor no envíe. El nombre de empresa y el mensaje
    se dibujan siempre con `Text`, nunca como marcado (Alcance 5c,
    `CN-20260916-090`, auditado en `CN-20260916-091`). Con esto el ciclo de
    consentimiento se recorre de extremo a extremo: la empresa invita desde el panel
    web y el trabajador acepta o rechaza desde la app. El criterio "ningún botón de
    contactar o invitar simula éxito" se cumple ahora en los dos lados por
    integración real, no por ausencia de botón. La desincronización transitoria declarada en
    `CN-20260915-081` (una carga del listado en vuelo sobrescribía la invitación
    recién creada y el botón volvía a "Invitar") **ya está corregida**: el listado
    se fusiona por `id` en vez de reemplazarse, con prueba de regresión propia en
    `apps/web/e2e/talent-invite.spec.ts` (`CN-20260915-082`). El efecto secundario de
    esa fusión —el panel no limpiaba las invitaciones locales al cerrar sesión, así
    que la siguiente cuenta que entraba en la misma pestaña heredaba la invitación
    de la anterior (`CN-20260915-083`, MEDIO-1)— **ya está corregido**: `logout()`
    limpia el listado, los errores por tarjeta y el conjunto de ids creados
    localmente, con prueba de regresión propia que vuelve a iniciar sesión sin
    recargar la página (`CN-20260915-084`). Queda un residuo acotado declarado en
    `CN-20260915-085`: si la respuesta de una petición de invitaciones iniciada
    antes del cierre de sesión llega después de esa limpieza, vuelve a sembrar el
    estado de la cuenta anterior; es una carrera estrecha y se resuelve recargando
    la página. Tampoco hay paginación en el listado de invitaciones, aceptado para
    el volumen del piloto.
- **Guardar alertas y favoritos en servidor (P1).** Reemplazar SharedPreferences para
  alertas y turnos guardados por entidades asociadas al usuario, manteniendo caché
  local solo como optimización. Cierre: la configuración se conserva entre equipos y
  puede activar notificaciones reales.

### Bloque 2 — Reseñas, reputación y matching explicable

Objetivo: construir confianza con datos derivados de trabajos reales.

- **Implementar estrellas y reseñas (P0, v1 completada).** Crear `Review` vinculada a una asignación
  completada, con autor, destinatario, puntuación, comentario, visibilidad, estado de
  moderación y restricción única por parte. Cierre: nadie puede autoevaluarse,
  evaluar un turno no completado ni publicar dos reseñas equivalentes.
- **Calcular reputación en el servidor (P0, parcial).** Derivar promedio, cantidad de reseñas,
  trabajos completados, puntualidad, ausencias y cancelaciones desde asignaciones y
  eventos. Versionar la fórmula y representar perfiles nuevos sin puntuación.
  Cierre: ningún cliente o CRUD puede editar estos agregados.
- **Crear matching v1 explicable (P1).** Sustituir el valor fijo por factores
  explícitos: coincidencia de especialidades, disponibilidad, distrito, horario y
  conflictos activos. Devolver puntuación junto con razones legibles; no presentar
  el cálculo como IA. Cierre: la misma entrada produce el mismo resultado y tiene
  pruebas de orden, empates y ausencia de datos.
- **Moderación y apelación (P1).** Permitir reporte, ocultamiento administrativo con
  motivo y trazabilidad, sin borrar la evidencia original. Cierre: toda alteración de
  visibilidad queda auditada y puede ser revisada.

### Bloque 3 — Operación del turno

Objetivo: hacer confiable el recorrido desde la selección hasta el cierre.

- **Endurecer asistencia (P0, parcial).** Definir ventanas de check-in/out, expiración y
  rotación de credenciales, tardanza, no-show, cierre manual controlado y prevención
  de reutilización. Mantener GPS y biometría fuera de este alcance inicial. Cierre:
  toda asignación cerrada conserva evidencia temporal y actor.
  Cubierto por `CN-20260918-001` y su corrección `CN-20260918-003`: ventana de
  check-in (30 min antes / 60 min después de `startsAt`, con un guard directo contra
  `endsAt` para que un turno más corto que esa ventana nunca acepte un check-in tras
  su propio fin), credencial aleatoria por asignación en vez de derivada de `shiftId`,
  estados `NO_SHOW`/`ABANDONED` resueltos al tocar la asignación (cada transición
  automática deja un `ShiftEvent` con actor `SYSTEM`, cumpliendo el criterio de cierre
  de este bloque), cierre manual de una asignación `ABANDONED` **o `NO_SHOW`** por
  parte de la empresa (`POST /api/business/shifts/:id/assignments/:assignmentId/resolve`,
  incluida la vía para que un trabajador marcado `NO_SHOW` que sí trabajó el turno
  cobre igual, vía `outcome: "COMPLETED"`), y cierre del turno como `CANCELLED` -en vez
  de reabrir a un `PUBLISHED` fantasma e inalcanzable- cuando su única asignación
  activa queda cancelada/no-show/abandonada después de que `endsAt` ya pasó.
  **Validado contra PostgreSQL real en la auditoría `CN-20260918-008`** (el entorno no lo
  permitía en `CN-20260918-001` a `006`, donde quedó declarado como riesgo bloqueante): la
  migración `20260918120000_assignment_no_show_abandoned` aplica limpiamente junto con las
  otras 23 sobre una base vacía, `prisma migrate diff` no detecta divergencia contra
  `schema.prisma`, el enum `AssignmentStatus` de la base contiene `NO_SHOW` y `ABANDONED`,
  y la suite de integración (`vertical-marketplace-flow` y `shift-capacity-race`) pasa
  2 archivos / 3 pruebas sobre una base `chambeaya_test` separada de la de desarrollo.
  **Interfaz del cierre manual cubierta** (`CN-20260918-013`): el panel web de la empresa
  muestra las asignaciones `NO_SHOW` ("No se presentó a tiempo") y `ABANDONED` ("Sin salida
  registrada") en `Turnos` → `Postulaciones` y ofrece "Confirmar que sí trabajó" (registra el
  pago pendiente que la empresa paga directo al trabajador; no mueve dinero) y "Cerrar sin
  pago" (motivo opcional), ambas con confirmación explícita y refresco de turno, postulaciones
  y pagos sin recargar; probado con API simulada (Playwright) y, para `NO_SHOW`, contra API y
  PostgreSQL reales. **Corregido en `CN-20260920-003` y ajustado en `CN-20260920-005`**
  (auditados en `CN-20260920-004` y `CN-20260920-006`): confirmar el trabajo de un
  `NO_SHOW`/`ABANDONED` en un turno que el propio vencimiento había cerrado como
  `CANCELLED` ya **saca al turno de `CANCELLED`, y solo hacia `COMPLETED`**, es decir
  cuando tras esa confirmación todos sus cupos quedan confirmados como trabajados (regla
  ampliada en `CN-20260922-013`: basta con que no quede ningún cupo pendiente de decisión y
  al menos uno haya completado); si quedara algún cupo sin cerrar el turno **se mantiene `CANCELLED`** (terminal) en vez de
  reabrirse a `CHECKED_IN`, que lo dejaría inalcanzable. La transición deja un
  `ShiftEvent` `UPDATED`; un turno que la empresa canceló con `cancelShift` (se distingue
  por un `ShiftCancellation` con `actorRole: BUSINESS`), uno con `endsAt` futuro y el
  cierre sin pago nunca lo reabren, y el copy del panel explica todos los casos sin
  prometer el resultado (BAJO-5 de `CN-20260918-004`, cerrado; detalle y límites en
  `docs/reference/api.md`).
  Sigue pendiente: expiración y rotación de credenciales (la credencial no caduca y el
  propio trabajador la recibe del API, así que no prueba presencia); una ventana
  propia de check-out (hoy sigue siendo válido en cualquier momento tras el check-in,
  hasta que el margen de 60 minutos tras `endsAt` marca la asignación `ABANDONED`). El
  cierre de turnos multi-cupo parcialmente cubiertos ya no está pendiente: desde
  `CN-20260922-013` (auditado en `CN-20260923-001`) el turno pasa a `COMPLETED` en cuanto no
  queda ninguna asignación `ASSIGNED`/`NO_SHOW`/`ABANDONED` sin resolver y al menos una
  completó, y la reapertura de un cierre por vencimiento sigue esa misma regla (detalle en
  `docs/reference/api.md`).
- **Aprobación y corrección de horas (P0).** Guardar horas propuestas, aprobación
  empresarial, disputa y correcciones como eventos inmutables; impedir que editar un
  turno reescriba el historial. Cierre: el importe u obligación se calcula únicamente
  sobre asistencia aprobada.
- **Incidencias reales (P1).** Crear modelo, estados, severidad, comentarios,
  adjuntos privados opcionales y responsables. Conectar el módulo actualmente vacío
  de administración. Cierre: empresa, trabajador y administración ven solo las
  incidencias autorizadas y su resolución.
- **Reglas excepcionales y concurrencia (P0).** Ampliar pruebas para múltiples cupos,
  aceptaciones simultáneas, cancelaciones tardías, reemplazos, cierre y reintentos.
  Cierre: transacciones e idempotencia impiden sobreasignación y dobles efectos.
- **Sincronización oportuna (P1).** Extender SSE o WebSocket a postulaciones,
  mensajería y operación, con reanudación y fallback controlado; retirar polling de
  cuatro segundos cuando la entrega sea estable. Cierre: ambas interfaces convergen
  y se recuperan después de una desconexión.

### Bloque 4 — Identidad, seguridad y documentos

Objetivo: preparar acceso real y documentos privados sin degradar seguridad.

- **Google Sign-In web (P1, piloto local completado).** La identidad `GOOGLE` se
  verifica en backend y emite la misma sesión opaca del sistema. Para una cuenta
  nueva, el onboarding solicita DNI y una contraseña exclusiva de Chambeaya; no
  recibe ni almacena la contraseña de Google. Las cuentas Google creadas antes de
  este paso deben definirla al volver a entrar. No se fusionan cuentas sólo por
  correo. Pendiente: clientes nativos Android/iOS, enlace/desvinculación de
  identidades, rate limiting y pruebas de replay/takeover.
- **Recuperación y verificación de cuenta (P1).** Añadir correo verificado,
  restablecimiento de contraseña, revocación de sesiones y gestión de dispositivos.
  Para web, evaluar migrar el token de `localStorage` a cookie `HttpOnly`, `Secure` y
  `SameSite` con protección CSRF. Cierre: los flujos caducan, son de un solo uso y no
  filtran secretos.
- **Carga privada de CV y foto (P1, piloto local completado).** CV PDF de hasta
  5 MB y foto JPG/PNG/WebP de hasta 3 MB se almacenan fuera de recursos estáticos;
  PostgreSQL conserva sólo metadatos y una clave. La **foto** solo la descarga el
  trabajador autenticado. El **CV**, desde `CN-20260921-005`, lo lee también la
  empresa dueña del turno al que ese trabajador se postuló, mientras la postulación
  siga vigente y el perfil esté visible (ver arriba y `docs/reference/api.md`).
  Pendiente: almacenamiento de objetos, hash, antivirus/cuarentena, descarga
  temporal, caducidad y eliminación auditada; bitácora de accesos al CV; límite de
  tasa en la ruta de lectura; y un consentimiento explícito por documento
  (`isCvVisible`) en lugar del `isVisible` general del perfil.
  Implementar carga mediante URL firmada, límites, antivirus/cuarentena, descarga
  temporal y eliminación. Cierre: el CV nunca es público y una empresa solo accede
  con consentimiento y relación vigente.
- **Verificación de empresa y trabajador (P1).** Modelar solicitudes, evidencia,
  revisión manual, vencimiento y auditoría antes de integrar proveedores oficiales.
  Cierre: el badge se deriva de una verificación vigente, no de una bandera editable.
- **Endurecimiento de API (P0 continuo).** Añadir rate limiting, protección contra
  fuerza bruta, CORS/CSRF por entorno, rotación de secretos, validación uniforme,
  logs sin datos sensibles y permisos granulares. Cierre: pruebas negativas cubren
  aislamiento por rol, empresa, trabajador y recurso.

### Bloque 5 — Notificaciones y comunicación

Objetivo: reemplazar promesas locales por entregas observables.

- **Servicio de notificaciones (P1).** Crear notificación, preferencias, plantilla,
  cola, intentos, estado de entrega e idempotencia. Empezar con bandeja interna y
  luego push/correo. Cierre: aceptación, recordatorio, cambio, cancelación y mensaje
  generan un solo evento entregable y reintentable.
- **Recordatorios temporales (P1).** Programar avisos previos al turno, confirmaciones
  vencidas, check-in y acciones pendientes con zona horaria explícita. Cierre: los
  jobs sobreviven reinicios y no duplican envíos.
- **Mensajería escalable (P2).** Añadir entrega en tiempo real, adjuntos seguros,
  bloqueo/reporte y política de conservación. Cierre: lectura y envío conservan el
  contexto de turno, autorización y trazabilidad.

### Bloque 6 — Pagos, ledger y cumplimiento

Objetivo: cerrar primero la obligación económica y después mover dinero.

- **Ledger operativo (P1).** Consolidar cotización, monto del trabajador, cargo de
  empresa, ajustes, aprobación, vencimiento y conciliación. Usar centavos, moneda e
  idempotencia; nunca reescribir movimientos contabilizados. Cierre: cada saldo se
  explica mediante asientos asociados a turno, asignación y asistencia.
- **Conciliación y exportación manual (P1).** Generar reportes auditables antes de
  integrar cobro automático. Cierre: operaciones puede detectar diferencias y marcar
  resolución sin alterar el historial.
- **Proveedor de pagos en sandbox (P2, integración pesada).** Implementar intención,
  webhook firmado, reintentos, reverso, devolución y disputa contra el ledger.
  Cierre: pruebas de webhooks duplicados y fuera de orden demuestran idempotencia.
- **Comprobantes y marco legal (P2).** Definir con revisión legal, laboral, tributaria
  y de protección de datos el rol de Chambeaya, contratos, comprobantes,
  retenciones, reclamos y manejo de fondos antes de producción. Cierre: términos y
  flujos técnicos reflejan la modalidad realmente aprobada.
- **Membresías empresariales (P2).** Mantener activación manual del piloto; implementar
  límites, facturación y cobro recurrente solo después de medir uso y validar precio.
  Cierre: los permisos se derivan del plan y no rompen el flujo base gratuito del
  trabajador.
  Cubierto parcialmente por `CN-20260918-005`: `GET /api/business/subscription` dejó de
  crear una fila `PILOT/TRIAL` real en la primera consulta y devuelve un objeto
  sintético `PILOT/INACTIVE` mientras nadie active nada, de modo que el producto ya no
  sugiere que Chambeaya inscribió sola a la empresa.
  Sigue pendiente: **no existe todavía ningún endpoint ni pantalla de activación de
  plan**, así que hoy ninguna empresa puede pasar de `INACTIVE` a `TRIAL`/`ACTIVE` por
  el producto (solo `demo.seed.ts` siembra una fila real); y **no hay limpieza de las
  filas `TRIAL` fantasma** que la versión anterior ya creó en cualquier base donde
  corrió. Se investigó en `CN-20260918-009` y **no existe un criterio seguro** para
  distinguirlas de una activación manual (el `upsert` antiguo, `demo.seed.ts` y una
  fila creada a mano con los valores por defecto dejan los mismos valores y
  timestamps), así que no se implementó ningún script de borrado: esas empresas siguen
  viendo "Piloto activo" hasta que un operador las revise una por una (consulta de
  solo lectura en `docs/reference/api.md`). Pendiente conocido, no bloqueante.
  Además, el panel web ya no afirma un piloto vigente ante una empresa sin plan
  activado (`INACTIVE`): la sección "Tu situación actual" de `MembershipView` muestra
  "Sin plan activado"/"Sin periodo vigente" y no marca ninguna tarjeta como "Actual"
  (`CN-20260918-009`); la tarjeta de empresa de la barra lateral rotula "Sin plan
  activado" (y "Plan sin confirmar" mientras no haya respuesta de la API); y los
  botones "Quiero conocerlo" avisan que los planes todavía no se activan desde el
  panel en vez de prometer una activación "cuando termine el piloto"
  (`CN-20260918-011`, con `membership.spec.ts`). Los tres textos comparten la misma
  noción de "plan activado" (`hasActivatedPlan` en `apps/web/app/page.tsx`).
  Quedan dos textos de piloto sin revisar, ambos preexistentes y verificados en la
  auditoría `CN-20260918-012`: el aviso de la vista Pagos ("La integración de pagos
  queda fuera del piloto"), que una empresa sin plan también lee; y, del lado
  contrario, una empresa con un plan `PRO`/`CUSTOM` o con el piloto ya
  `EXPIRED`/`CANCELLED`/`PAUSED` -hoy solo posible con una fila creada a mano- sigue
  leyendo "Incluido en tu piloto" y "El piloto no requiere tarjeta ni suscripción"
  en `MembershipView`, porque `hasActivatedPlan` solo distingue `INACTIVE` y el copy
  de las tarjetas está fijo en el piloto.
- **Reencuadre de pagos sin pasarela (P2, parcial).** El objetivo declarado -que nada
  en la capa interna suene a que Chambeaya custodia o retiene dinero- se atacó en
  `CN-20260918-005` por comportamiento y documentación, no por renombrado: se eliminó
  la suscripción fantasma (arriba) y se unificó el mapeo interno de pagos de Flutter a
  español. Sigue pendiente y explícitamente diferido: el modelo `WalletMovement`, la
  ruta `/api/workers/wallet` y los estados `RELEASED`/`REVERSED` conservan nombres que
  evocan custodia, y su reencuadre real depende de la decisión de modelo económico que
  todavía no se tomó. Mitigación vigente: la sección "Wallet del trabajador (reporte de
  pagos, no custodia)" de `docs/reference/api.md`.

### Bloque 7 — Administración, analítica y crecimiento

Objetivo: operar el piloto con control y aprender de datos reales.

- **Panel administrativo completo (P1).** Reemplazar campos históricos por perfil y
  reputación global; añadir colas de empresas, documentos, reseñas e incidencias con
  acciones auditadas. Cierre: ninguna mutación sensible ocurre sin motivo, actor y
  permiso.
- **Métricas operativas (P1).** Instrumentar tiempo a primera postulación, cobertura,
  asistencia, puntualidad, cancelación, recurrencia, aprobación y pago. Definir los
  eventos y evitar contar datos demo. Cierre: cada indicador puede reconciliarse con
  registros fuente.
- **Reportes y exportaciones (P2).** Añadir filtros, CSV y reportes por empresa, sede,
  periodo y turno, con autorización y protección contra fórmulas maliciosas. Cierre:
  exportaciones grandes se procesan fuera de la petición HTTP y expiran.
- **Equipos empresariales y sedes (P2).** Sustituir el único propietario por membresía
  con roles, invitaciones y alcance por sede. Cierre: permisos y auditoría impiden que
  un miembro acceda a otra empresa o sede.

### Bloque 8 — Plataforma, lanzamiento y operación de producción

Objetivo: desplegar y mantener el sistema de forma recuperable.

- **Staging y CI/CD (P0 para piloto).** Crear entorno equivalente a producción,
  migraciones automáticas controladas, smoke posterior, aprobación de despliegue y
  rollback. Cierre: una versión puede promoverse y revertirse sin editar servidores a
  mano.
- **Observabilidad (P0 para piloto).** Logs estructurados con correlación, métricas,
  trazas, alertas, reporte de errores móvil/web y tableros de salud. Cierre: fallos de
  login, publicación, postulación y cierre se detectan y rastrean de extremo a extremo.
- **Backups y recuperación (P0 para piloto).** Automatizar respaldo cifrado de base y
  objetos, retención y prueba periódica de restauración. Cierre: existe un objetivo de
  recuperación medido y una restauración documentada.
- **Perímetro y secretos (P0 para piloto).** TLS, reverse proxy, headers, secretos
  fuera del repositorio, rotación y mínimo privilegio de base/almacenamiento. Cierre:
  escaneo de secretos/dependencias y checklist de seguridad sin bloqueos críticos.
- **Rendimiento y accesibilidad (P1).** Pruebas de carga sobre búsqueda y aceptación,
  paginación en listas, índices observados, presupuestos web y revisión WCAG de flujos
  críticos. Cierre: objetivos medibles de latencia y accesibilidad pasan en CI.
- **Publicación móvil (P1).** Definir application ID/package/bundle IDs, firma Android
  e iOS, flavors, iconos, permisos mínimos, política de privacidad, crash reporting y
  distribución interna. Cierre: builds release reproducibles instalables desde los
  canales de prueba de ambas plataformas.
- **Gobierno de datos (P1).** Versionar términos/consentimientos, retención, exportación
  y eliminación de cuenta; inventariar datos personales y accesos. Cierre: solicitudes
  de acceso, corrección y eliminación tienen procedimiento y evidencia.

## Hitos sugeridos

### Hito A — Piloto honesto de talento

Incluye Bloque 0, perfil/búsqueda/invitaciones del Bloque 1 y pruebas verticales. No
hay puntuaciones ni promesas ficticias. Es el siguiente objetivo inmediato.

**Estado al 2026-09-16: el Hito A queda completo.** Lo declara la auditoría
`CN-20260916-093`, que aprobó `CN-20260916-092` tras verificar por sí misma, contra el
código y contra la API pública de GitHub, los dos únicos ítems que `CN-20260916-091`
había dejado abiertos. No queda ningún ítem del Bloque 0 ni del alcance de talento del
Bloque 1 sin cumplir su criterio de cierre. Los riesgos residuales, todos declarados y
ninguno bloqueante, se listan al final de esta sección.

Cerrado: el perfil personalizable (servidor y Flutter), la separación de perfil global y
contacto empresarial, la búsqueda empresarial con su paginación por cursor y —con
`CN-20260916-090`, auditado en `CN-20260916-091`— las invitaciones de talento en sus tres
lados (servidor, panel web y app del trabajador). El ciclo de consentimiento ya se recorre
de extremo a extremo y ningún botón de invitar o responder simula éxito.

Cerrado en `CN-20260916-092` y verificado de forma independiente en `CN-20260916-093`:

1. **Bloque 0, "Cerrar deuda de calidad inmediata" (P1).** `.github/workflows/flutter-tests.yml`
   y `.github/workflows/web-tests.yml` ya fijan `actions/checkout`, `actions/setup-node`,
   `actions/upload-artifact` y `subosito/flutter-action` por SHA completo de commit, con la
   versión semántica correspondiente como comentario (p. ej. `actions/checkout@11d5960a…
   # v4.4.0`). Los SHA se verificaron contra la API de GitHub (`git/refs/tags/<versión>` y
   `commits/<sha>`) al momento del cierre y la auditoría `CN-20260916-093` los volvió a
   consultar por su cuenta: los cuatro SHA son exactamente los commits a los que apuntan
   `actions/checkout@v4.4.0`, `actions/setup-node@v4.4.0`, `actions/upload-artifact@v4.6.2`
   y `subosito/flutter-action@v2.23.0`, sin cambiar de versión mayor/menor respecto a la
   etiqueta móvil que ya se usaba. `flutter analyze` sigue reportando 15 avisos `info` (todos
   `curly_braces_in_flow_control_structures`, `unnecessary_to_list_in_spreads` y
   `use_build_context_synchronously`), sin ningún error; esos avisos no eran parte del
   criterio de cierre de SHA y quedan como deuda menor ya conocida.
2. **Bloque 0, "Retirar afirmaciones y métricas sin fuente real" (P0).** La afirmación sin
   fuente en `apps/mobile_flutter/lib/features/marketplace/worker_secondary_pages.dart:490`
   ("Comunicación directa y segura con empresas verificadas") se reemplazó por una
   descripción real del canal ("Mensajes directos con las empresas de tus turnos y
   postulaciones"), con el mismo criterio aplicado antes en `profile_home_page.dart`
   (`CN-20260916-090`). Una búsqueda en todo `apps/mobile_flutter` y `apps/web` no encontró
   más ocurrencias del patrón "empresa(s) verificada(s)" afirmadas sin condición. Residuos
   menores ya conocidos y deliberadamente no tocados en este cierre (no bloquean el hito):
   el ramal "Empresa verificada" de `job_detail_panel.dart:219` sigue muerto (el servidor
   fija siempre `companyVerified: false` en `marketplace.service.ts:641`, condicional y
   honesto en su rama alcanzable) y `worker_pages.dart` conservaba insignias fabricadas
   ("100% de entradas a tiempo", "Reemplazante IA") en una `RewardsPage` que ya no importaba
   ningún archivo de `lib/` (**archivo eliminado en `CN-20260918-007`**, verificado en la
   auditoría `CN-20260918-008`). `CN-20260916-093` comprobó las dos afirmaciones: `companyVerified`
   solo se escribe una vez en todo el repositorio y con el valor `false`, el servicio de demo
   ni siquiera envía la clave y el modelo de Flutter la inicializa en `false`, así que no
   existe hoy ningún camino —tampoco en modo demo— por el que se muestre "Empresa
   verificada"; y `worker_pages.dart` solo lo importaba `test/worker_flow_test.dart`
   (ambos eliminados en `CN-20260918-007`).

**Plan de refuerzo cerrado al 2026-09-16.** Los siete alcances de
`.claude/plans/2026-09-15-refuerzo-piloto-talento.md` están aprobados. El último en
cerrarse fue el Alcance 7 ("Infraestructura E2E Playwright para el panel superadmin",
marcado diferible y `NO_EJECUTADA` en `CN-20260915-062`/`063`): `CN-20260916-094` montó el
stack real completo —clúster PostgreSQL efímero por `initdb`/`pg_ctl`, las 23 migraciones
por `prisma migrate deploy`, la API Express real y el panel Next.js real— y la auditoría
`CN-20260916-095` reprodujo esa corrida por su cuenta en otro clúster y otros puertos. El
plan de refuerzo ya no tiene alcances abiertos; los pendientes que deja la suite real se
listan en "Cobertura mínima de pruebas pendiente".

Riesgos residuales declarados al cerrar el hito (ninguno bloqueante, cada uno con su acción):

- **Ninguna corrida de GitHub Actions se ha observado nunca.** El árbol de trabajo, incluido
  `.github/`, no está versionado, de modo que los dos workflows todavía no existen para
  GitHub. La reproducibilidad está garantizada por construcción (SHA fijos, `flutter-version`
  fija, `--enforce-lockfile`, PostgreSQL efímero del job) y las mismas comprobaciones pasan en
  esta estación, pero la primera ejecución remota queda `NO_EJECUTADA`. Acción: versionar y
  publicar el árbol, y confirmar la primera corrida verde de ambos workflows.
- **Simulacro de rollback por respaldo/restauración no ejecutado.** El criterio de cierre del
  ítem "Aplicar y validar las migraciones recientes" (paridad de esquema en base limpia y en
  base actualizada) sí está cubierto —`CN-20260916-093` aplicó las 23 migraciones sobre una
  base vacía y recorrió el flujo vertical real contra ella; `CN-20260916-087` verificó
  divergencia cero con `prisma migrate diff`—, pero nadie ha ensayado todavía un
  `pg_dump`/restauración operativa, y `docs/guides/deployment.md` no documenta ese
  procedimiento. Acción: entrada propia que ensaye y documente el respaldo y la restauración.
- ~~**`setState(() => x = Future)` en cuatro puntos**~~ **Corregido en `CN-20260918-007`
  y verificado en la auditoría `CN-20260918-008`,** que revirtió los cuatro bloques a la
  forma de expresión y confirmó que las cuatro pruebas nuevas fallan sin el arreglo (tres
  con `FlutterError: setState() callback argument returned a Future`; la del sondeo, sin
  excepción visible, porque la conversación nueva no aparece). Los cuatro sitios vivos (el reintento de "Postulaciones", el
  sondeo y el reintento de "Conversaciones" en `worker_secondary_pages.dart`, y el reintento
  de `worker_discovery_page.dart`) usan ahora un cuerpo de bloque. En compilación *debug* el
  `assert` de `State.setState` lanzaba antes de `markNeedsBuild` y la pantalla no se
  reconstruía (en el sondeo de "Conversaciones" el `catch (_)` lo tragaba, así que la lista
  dejaba de refrescarse sin ningún error visible; desde `CN-20260918-009` ese `catch` ya no
  es mudo: conserva la lista, la registra con `debugPrint` y muestra el aviso "No pudimos
  actualizar tus mensajes" hasta el siguiente sondeo exitoso); en *release* no
  ocurría. Ya hay pruebas de
  widget que fallaban antes del arreglo (`worker_messages_page_test.dart` y un caso de
  reintento en `worker_applications_page_test.dart` y `worker_discovery_page_test.dart`). El
  patrón no tiene ningún otro sitio en `lib/`: se verificó por búsqueda, y los tres sitios
  restantes vivían en `worker_pages.dart`, eliminado en el mismo cierre. Se decidió no extraer
  una utilidad compartida: son cuatro líneas de bloque sin lógica común. Queda una
  incoherencia menor sin tocar: el botón de reintento de la pantalla de error de
  descubrimiento se rotula "Limpiar filtros" (`_InlineState` reutilizado), y cambiar el texto
  sería un cambio visible fuera de este alcance.
- **Código sin consumidor que quedó tras eliminar `worker_pages.dart` (`CN-20260918-007`).**
  Dos casos distintos, declarados en la auditoría `CN-20260918-008`. (a)
  `lib/features/marketplace/app_capabilities.dart` (`AppCapabilities`, con
  `cameraCheckInEnabled`/`locationCheckInEnabled`/`paymentsEnabled`) quedó sin ningún
  lector en `lib/` porque su único consumidor era la `CheckInPage` eliminada, y su única
  prueba solo afirmaba que tres constantes valían `false`. **Se eliminó en
  `CN-20260918-009`** junto con esa aserción (verificado por búsqueda exhaustiva en
  `lib/` y `test/`); el resto de `marketplace_repository_test.dart` no cambió. La app
  enrutada no dice nada sobre cámara o ubicación porque tampoco ofrece ninguna pantalla
  de cámara o GPS; si alguna vez se enruta una pantalla de asistencia con cámara, esa
  decisión deberá modelarse de nuevo desde el requisito y no desde esa clase. (b)
  `walletMovements()`/`confirmPayment()`/`PaymentRecord` en el repositorio de
  trabajador **no** son el mismo caso: son la mitad
  cliente de `GET /api/workers/wallet` y `POST /api/workers/payments/:id/confirm`, dos
  endpoints vivos y documentados, y el plan del ciclo prohibía tocarlos. Se conservan a
  propósito, documentados en `docs/reference/api.md`.
- Sin regresión automatizada que impida reintroducir una afirmación sin fuente: la
  comprobación es hoy una búsqueda manual, no una prueba.
- El residuo de carrera al cerrar sesión declarado en `CN-20260915-085` y la verificación de
  extremo a extremo del perfil y de las invitaciones contra PostgreSQL real **desde el cliente
  Flutter** (la vertical servidor-PostgreSQL sí quedó ejecutada en `CN-20260916-093`).

### Hito B — Confianza y cierre operacional

Incluye reseñas, reputación, matching v1, asistencia aprobada, incidencias,
concurrencia y notificaciones internas. Permite medir turnos realmente completados.

### Hito C — Identidad y documentos

Incluye Google Sign-In, recuperación de cuenta, verificación y CV privado. Se ejecuta
después del Hito B, aunque el diseño de datos se mantenga preparado desde ahora.

### Hito D — Dinero y lanzamiento

Incluye ledger conciliado, proveedor en sandbox, revisión legal, staging,
observabilidad, recuperación y builds móviles de distribución. Los cobros de
producción solo se habilitan tras validar el recorrido completo y las obligaciones.

## Ciclo de simplificación radical (rama `codex/simplificacion-radical`, 2026-09-18)

Se abrió tras guardar la versión previa en `codex/modelo-negocio-simplificado`
(commit `c47fa87`, no se modificó después). Objetivo: dejar el flujo principal y el
modelo de negocio sin brechas graves, sin que parezca que Chambeaya custodia dinero y sin
esperar la decisión pendiente sobre el modelo económico real. El plan está en
`.claude/plans/2026-09-18-cierre-brechas-flujo-simple.md`; cada cierre y su auditoría
están en `docs/PROGRESO.md`.

Cambios cerrados y auditados (todos comiteados en la rama hasta `efc4182`, salvo
`CN-20260921-001`, `CN-20260921-003`, `CN-20260921-005` y `CN-20260921-007`, que siguen en
el árbol de trabajo, sin comitear):

- **Check-in y check-out** (`CN-20260918-001` a `004`): credencial aleatoria por asignación,
  ventana de tiempo, estados `NO_SHOW` y `ABANDONED` resueltos al leer, cierre manual
  controlado (`POST /api/business/shifts/:id/assignments/:assignmentId/resolve`) y rastro
  en `ShiftEvent`. Un turno sin asignaciones viables cierra como `CANCELLED`.
- **Pagos sin sensación de custodia** (`005`, `006`): `GET /business/subscription` ya no
  crea filas "trial"; el copy y la documentación dejan claro que el wallet del trabajador
  es un registro de confirmación, no saldo custodiado. No se construyó pasarela real.
- **Complejidad accidental** (`007`, `008`): se eliminó `worker_pages.dart` (código no
  enrutado) y se corrigió `setState(Future)` en los cuatro sitios vivos. Se evaluó y
  descartó mover `operations` (lo importan `business` y `marketplace`).
- **Pendientes menores** (`009` a `012`): aviso visible cuando falla el sondeo de mensajes,
  copy honesto para una empresa sin plan activado y eliminación de `AppCapabilities`.
- **Interfaz web para cerrar asignaciones** (`013`, `014`): en Turnos > Postulaciones la
  empresa confirma que sí trabajó (queda un pago pendiente que paga directo) o cierra sin
  pago, con confirmación irreversible.
- **Refresco del panel tras cerrar una asignación** (`CN-20260920-001`, `CN-20260920-002`):
  las lecturas de postulaciones se secuencian (`apps/web/lib/request-sequence.ts`), así que
  una respuesta emitida antes del cierre y entregada después ya no repone las acciones de
  una fila resuelta; la confirmación se mantiene en "Guardando…" hasta que termina el
  refresco; la tarjeta de Pagos dice "Registro de tus pagos directos a los trabajadores.
  Chambeaya no cobra, guarda ni transfiere dinero"; y los tres botones de la confirmación
  nombran al trabajador.
- **Turno `CANCELLED` con asignación `COMPLETED` y pago pendiente** (`CN-20260920-003`,
  `CN-20260920-004`, `CN-20260920-005`, `CN-20260920-006`): `resolveAssignment` calcula el
  estado del turno con el turno que devuelve el ciclo de vida, no con la lectura previa, y
  confirmar `COMPLETED` saca de `CANCELLED` a un turno que había cerrado el propio
  vencimiento **solo cuando el recálculo lo deja `COMPLETED`** (desde `CN-20260922-013`:
  ningún cupo pendiente de decisión y al menos uno completado, con cualquiera de los dos
  `outcome`; antes exigía todos los cupos confirmados como trabajados); con algún cupo sin
  resolver se mantiene `CANCELLED`, que es terminal. La transición deja un `ShiftEvent` `UPDATED`. Un turno que la empresa canceló
  con `cancelShift` —reconocido por un `ShiftCancellation` con `actorRole: BUSINESS`, no
  por `assignmentId: null`, que también puede escribir un trabajador—, uno con `endsAt`
  futuro y el cierre sin pago nunca lo reabren. El aviso del panel explica todos los casos
  sin prometer el resultado.
- **Costo de render del panel en reposo** (`CN-20260921-001`): el pulso del punto de
  notificaciones animaba `box-shadow`, que obliga a recalcular estilos y repintar en cada
  fotograma; ahora son dos pseudo-elementos y solo se animan `transform` y `opacity`. Y
  los cuatro sondeos de 4 s guardaban arreglos u objetos nuevos pero idénticos, lo que
  volvía a renderizar el panel entero (un solo componente) sin cambio visible; con
  `apps/web/lib/stable-state.ts` el estado conserva la referencia anterior cuando el
  contenido es igual. Medido con el panel quieto 20 s: Turnos pasó de 10 confirmaciones de
  render y 1 413 ms de hilo principal a 0 y 79 ms; Mensajes de 15 y 1 160 ms a 0 y 92 ms;
  Pagos de 10 y 1 753 ms a 0 y 57 ms. Cubierto por `apps/web/e2e/render-cost.spec.ts`. No
  cambia comportamiento de producto, copy ni contratos. **Esto no atiende ninguna queja de
  "cambio claro/oscuro": el panel web no tiene modo oscuro ni interruptor de tema** (no hay
  `prefers-color-scheme`, `data-theme` ni clase de tema en `apps/web/app/globals.css`); el
  único modo oscuro del repositorio es el del panel de trabajador en Flutter
  (`apps/mobile_flutter/lib/theme/theme_mode_controller.dart`), que este cierre no tocó;
  su rendimiento se midió y corrigió aparte, en `CN-20260921-003` (siguiente viñeta).
- **Costo del cambio claro/oscuro en la app del trabajador** (`CN-20260921-003`): el
  interruptor `Modo oscuro` aplicaba el tema con un `AnimatedTheme` de 220 ms, así que
  cada uno de ~14 fotogramas construía un `ThemeData` interpolado y notificaba a todo
  widget que lee `Theme.of`/`context.palette`; como el `IndexedStack` del panel mantiene
  las cinco pestañas montadas y no silencia los tickers de las ocultas, también se
  reconstruían las cuatro pestañas invisibles. Ahora el tema se aplica en un fotograma
  (`Theme` en vez de `AnimatedTheme`), cada página del `IndexedStack` va envuelta en un
  `TickerMode` activo solo para la pestaña visible, y `buildAppTheme` está memoizado por
  `(Brightness, defaultTargetPlatform)`. Medido con `flutter test` (modo depuración,
  `MediaQuery` 390 × 844) y reproducido en la auditoría `CN-20260921-004`: desde `Inicio`,
  28 fotogramas y 26 348 reconstrucciones de elementos por cambio pasaron a 14 y 3 254;
  desde `Perfil`, a 20 y 3 581; construir el `ThemeData` bajó de ~661 µs a 12-13 µs por
  llamada. Cubierto por `apps/mobile_flutter/test/theme_switch_cost_test.dart` (6 casos).
  **Cambio visible:** los colores ya no se funden, cambian de golpe; solo el ícono del
  interruptor conserva su animación de 220 ms. Falta medir en un dispositivo real en modo
  `--profile` (ver "Sin verificar de extremo a extremo").
- **La empresa puede leer el CV de sus postulantes** (`CN-20260921-005`): endpoint nuevo
  `GET /api/business/shifts/:id/applications/:applicationId/cv` (solo lectura, sesión
  `BUSINESS`, sin URL pública) y un booleano `worker.hasCv` en la lista de postulantes; el
  archivo se pide bajo demanda al pulsar "Ver CV". La regla de acceso vive una sola vez en
  `apps/api/src/modules/talent/cv_access.ts` y la comparten la lista y la descarga:
  postulación **vigente** (`PENDING`/`ACCEPTED`) a un turno **de esa empresa** **y** perfil
  con `isVisible: true`, evaluado en cada petición. El directorio de talento sigue sin
  exponer el CV. Sin cambios de esquema ni dependencias nuevas. Se corrigió además el copy
  de Flutter, que prometía "solo tú puedes acceder a este documento". Detalle en
  `docs/reference/api.md` y `docs/product/talent-profile-rollout.md`. **Pendientes asumidos
  para el piloto:** consentimiento grueso (no existe una bandera propia `isCvVisible`:
  `isVisible` gobierna a la vez directorio y CV, y quien oculta el perfil tampoco puede
  compartir el CV con la empresa a la que se postuló), sin bitácora de accesos, sin
  caducidad mientras la postulación siga vigente, sin límite de tasa en esa ruta y PDF sin
  verificar (solo la firma `%PDF-` al cargarlo; sin antimalware). La decisión entre
  implementar `isCvVisible` o mantener esta política está abierta.
- **"Mis postulaciones" (Flutter) deja de parpadear con su sondeo** (`CN-20260921-007`):
  la pestaña refrescaba cada 3 s asignando un `Future` nuevo a un `FutureBuilder`, que
  volvía a `ConnectionState.waiting` y **reemplazaba toda la lista por un
  `CircularProgressIndicator`** durante los dos viajes de red de la recarga (hasta 8 s de
  tiempo límite cada uno), con pérdida de la posición de scroll. Ahora el estado es
  explícito (`_data`, nulo solo hasta la primera carga): el refresco es silencioso,
  conserva lo que se ve, solo reconstruye si los datos cambiaron (`Shift` y
  `_ApplicationsData` comparan por valor; el orden de las tarjetas cuenta como cambio), no
  solapa peticiones, descarta una respuesta vieja frente a una recarga más nueva y se
  pausa mientras la pestaña está oculta (`TickerMode`, refrescando al reaparecer). Un
  refresco fallido conserva la lista y muestra un aviso discreto **desde el segundo fallo
  consecutivo** ("No pudimos actualizar tus postulaciones. Reintentaremos en unos
  segundos."); solo la primera carga y su "Reintentar" muestran indicador. Sin cambios de
  API, de contrato, de intervalo ni dependencias nuevas. **El panel web no tenía el
  síntoma** (su `applicationsLoading` solo se enciende al abrir el turno): no se tocó su
  código de producción y un caso nuevo de `render-cost.spec.ts` fija esa conclusión con un
  `MutationObserver` sobre el DOM real. Cubierto por
  `apps/mobile_flutter/test/worker_applications_refresh_test.dart` (15 casos) y una prueba
  de igualdad de `Shift`. **Pendientes que este cierre no atiende** (ver la lista de
  pendientes, puntos 2 y 3): entrar a la pestaña sigue mostrando el indicador una vez,
  "Conversaciones" pinta un fotograma de indicador en cada sondeo, el sondeo web que falla
  con datos en pantalla sigue vaciando la lista, y el sondeo no se pausa cuando la
  aplicación pasa a segundo plano.
- **Filtros del trabajador legibles en modo oscuro** (`CN-20260921-009`): los seis
  desplegables de la hoja "Filtros de búsqueda" (`_FilterDropdown`,
  `lib/features/discovery/widgets/job_filter_controls.dart`) pintaban su caja con
  `Colors.white` fijo mientras el valor seleccionado toma `textTheme.titleMedium` (el
  `ink` casi blanco de la paleta oscura) y la flecha el `white70` propio de Flutter: texto
  casi blanco sobre blanco. Medido sobre los píxeles rasterizados en la auditoría
  `CN-20260921-010`, el texto pasó de **1,13:1 a 14,91:1** en oscuro (la flecha, de 1,00:1
  a 8,84:1). El campo de búsqueda, los chips y los campos de perfil/mensajes **no** tenían
  el defecto: heredan `inputDecorationTheme`/`chipTheme`, que ya usaban la paleta. En el
  mismo pase se corrigieron dos síntomas del mismo tipo: el aviso de error bajo los
  filtros (fondo ámbar fijo `#FFF4E5`) heredaba el texto `muted` claro del tema oscuro
  (2,15:1 → 12,98:1 con el token nuevo `onNotice`), y el borde de campos y chips era el
  hairline decorativo (1,33:1 → 3,59:1 con el token nuevo `controlBorder`, `#69748A`).
  **Cambio visible más allá del síntoma:** `controlBorder` aclara el contorno de **todos**
  los campos y chips del trabajador en oscuro (búsqueda, perfil, mensajes), no solo los
  filtros; el modo claro conserva el mismo hairline `#D9E2EC` y la app de empresa, la
  bienvenida y el inicio de sesión no se ven afectados porque están fijados en claro
  (`dark_theme_scope_test.dart`). Cubierto por
  `apps/mobile_flutter/test/worker_filter_contrast_test.dart` (18 casos que miden razones
  de contraste WCAG sobre el árbol renderizado, no colores fijos).
  **Deuda de contraste que este cierre no atiende** (medida en la auditoría
  `CN-20260921-010`, ninguna es regresión de este cambio): en **oscuro**, la insignia
  "Postulación enviada" (`#4F46E5` sobre su propio relleno al 12 %, `worker_secondary_pages.dart`
  y `worker_invitations_page.dart`) queda en **2,46:1** —el peor valor vivo del panel
  oscuro—, la insignia "URGENTE" de la tarjeta en 3,33:1, las insignias que usan
  `AppColors.muted` en 3,63:1, "EN VIVO" en 3,94:1 y el ícono blanco sobre relleno teal
  (`_JourneyStep`) en 2,16:1; en **claro**, las insignias "En revisión" (1,77:1) y
  "Seleccionado" (1,95:1), el hint/etiqueta `muted` (4,02:1 sobre blanco, 3,74:1 sobre el
  fondo de página), el hairline de campos y chips (1,31:1) y el borde de foco teal
  (2,16:1). El patrón dominante en las insignias es el mismo: un color de marca fijo
  pintado sobre su propio relleno al 12 %, cuya legibilidad cambia con la superficie de
  debajo (el violeta y el rojo se leen peor en oscuro; el dorado y el teal, peor en
  claro). Ninguna de esas insignias está cubierta por pruebas de contraste.

Validación al cierre: API 190/190 y Playwright rápido 90/90 (medidos y reproducidos en la
auditoría `CN-20260921-008`; eran 173/173 y 72/72 antes de los 17 casos de API, los 8
casos × 2 proyectos de `applicant-cv.spec.ts` y el caso nuevo × 2 de `render-cost.spec.ts`),
Flutter 139/139 (medidos en las auditorías `CN-20260922-011` y `012`; eran 135/135 en
`CN-20260922-005` a `008`, antes de los cuatro casos de cobertura de `CN-20260922-009` y
`010` —dos de `worker_button_contrast_test.dart`, uno de `worker_messages_page_test.dart`
y uno de `worker_applications_refresh_test.dart`—, y 132/132 en
`CN-20260921-010`, antes de los tres casos de `CN-20260922-002`, `003` y `004`; 114/114 en
`CN-20260921-008`, antes de los 18 casos de `worker_filter_contrast_test.dart`, y 98/98
tras `CN-20260921-005`, antes de los 15 casos de `worker_applications_refresh_test.dart` y
el de igualdad de `Shift`) e integración PostgreSQL 8/8
(3 de siempre + 5 de `applicant-cv.integration.test.ts`, ejecutadas en esa auditoría sobre
la base desechable `chambeaya_test` del contenedor `cumplenow-db-1`; `prisma migrate
deploy`: 24 migraciones, ninguna pendiente). La suite real del panel 3/3
**se ejecutó en `CN-20260920-007`** con las aserciones vigentes, sobre la base
desechable `chambeaya_test` del contenedor `cumplenow-db-1` (`prisma migrate deploy`:
24 migraciones, ninguna pendiente; la base de desarrollo no se tocó). Con eso queda
cerrado el riesgo que `CN-20260920-003`, `005` y `006` declaraban como
`NO_EJECUTADA` por falta de Docker: la reapertura del turno cerrado por vencimiento está
verificada de extremo a extremo contra PostgreSQL real. Lo que esa corrida cubre es el
turno de **un solo cupo**; el resto de escenarios sigue en "Sin verificar de extremo a
extremo", más abajo.

Pendientes conocidos, por prioridad sugerida:

1. **Turnos multi-cupo parcialmente cubiertos** (`CN-20260918-004`, `CN-20260920-006`):
   **cerrado: implementado en `CN-20260922-013` y aprobado en la auditoría
   `CN-20260923-001`**, que ejecutó el escenario contra API y PostgreSQL reales con una
   sonda desechable (ver abajo). Sus cuatro hallazgos bajos quedaron **cerrados en
   `CN-20260923-002`** (auditado en `CN-20260923-003`): una prueba fija el caso "cupo
   reemplazado con su `NO_SHOW` original sin resolver" (queda `CHECKED_IN` hasta
   resolverlo; antes pasaba a `COMPLETED`; la regla no se cambió), el `ShiftEvent`
   `UPDATED` de la reapertura nombra "cerrar sin pago" cuando esa fue la acción, el aviso de
   "Cerrar sin pago" en un turno cancelado explica que puede pasar a completado, y el
   comentario de `deriveShiftStatus` describe la regla vigente. El mismo cierre corrigió el
   fixture de `apps/mobile_flutter/test/talent_invitation_repository_test.dart`, que
   fallaba por una fecha fija vencida (hallazgo (c) de `CN-20260923-001`). La auditoría
   `CN-20260923-001` encontró además dos problemas previos, fuera de ese alcance y sin
   corregir: (a) un reemplazo aceptado después de un `NO_SHOW` nunca puede
   hacer check-in, porque la ventana se mide desde `startsAt` (ya cerrada) y la asignación
   nueva pasa a `NO_SHOW` al primer toque; solo cobra si la empresa lo confirma a mano; y
   (b) en un turno multi-cupo, en cuanto un trabajador hace check-in el turno pasa a
   `CHECKED_IN` y `POST /api/shifts/:id/confirm` responde `404 ASSIGNMENT_NOT_FOUND` a los
   asignados que aún no habían confirmado, así que tampoco pueden hacer check-in.
   Texto original del cierre: `deriveShiftStatus` ahora distingue una asignación
   `NO_SHOW`/`ABANDONED` todavía sin resolver (sigue bloqueando el cierre del turno) de una
   que la empresa ya resolvió explícitamente como `CANCELLED` (ya no bloquea): un turno
   multi-cupo llega a `COMPLETED` en cuanto ya no queda ninguna asignación pendiente de
   decisión y al menos una completó, aunque otras hayan terminado `CANCELLED`; si ninguna
   completó, queda `CANCELLED`. Esto también corrige, sin caso especial, la reapertura de un
   turno cerrado por vencimiento (`resolveAssignment`): ya no exige que la llamada en curso
   resuelva `COMPLETED` para intentar el recálculo, así que resolver el último cupo pendiente
   como `CANCELLED` también reabre a `COMPLETED` si otro cupo ya había completado antes.
   `cancelShift` ahora también cancela una asignación `NO_SHOW` que hubiera quedado sin
   resolver (antes sobrevivía intacta y era resoluble sobre un turno ya cancelado). No se
   agregó ningún estado nuevo al enum `OperationalShiftStatus` ni migración de Prisma: se
   reutilizan `COMPLETED`/`CANCELLED` con el significado documentado en
   `docs/reference/api.md`. Se corrigió también una regresión encontrada en el mismo cierre:
   `apps/mobile_flutter` (`completedShifts()`) usaba `shift.status === 'COMPLETED'` como señal
   de que el propio trabajador completó su turno, lo que ahora puede ser falso en un
   multi-cupo parcial. El riesgo que declaraba el cierre (escenario no ejecutado contra
   base real) lo cerró la auditoría: la sonda no quedó en el repositorio, así que
   `apps/api/tests/integration` y `apps/web/e2e-real` siguen sin un escenario multi-cupo
   permanente.
2. **Indicadores de carga que todavía parpadean** (pendientes declarados en
   `CN-20260921-007` y confirmados en su auditoría `CN-20260921-008`): (a) **cerrado** en
   `CN-20260922-003` (auditado en `CN-20260922-007`) y completado en `CN-20260922-010`
   (auditado y aprobado en `CN-20260922-012`, sin hallazgos abiertos):
   `_applicationRevision` dejó de pasarse como `ValueKey` y viaja como la propiedad
   `applicationRevision`, que
   `_WorkerApplicationsPageState.didUpdateWidget` convierte en un `_refresh()` silencioso,
   así que entrar a "Postulaciones" ya no destruye el `State` ni vacía `_data`. La guarda
   `!_requestPending` evita la petición doble que provoca el cambio de `TickerMode` del
   mismo fotograma; como contrapartida, una recarga manual que cae justo sobre un sondeo en
   vuelo se descarta (la petición en vuelo igual aplica su resultado: el desfase máximo es
   un viaje de red más un intervalo de 3 s). Ese riesgo queda **aceptado y documentado**
   junto a la guarda en el código, y la ruta que solo cubre `didUpdateWidget` (volver a
   tocar la pestaña ya activa, donde `TickerMode` no cambia) tiene desde `CN-20260922-010`
   su propio caso en `worker_applications_refresh_test.dart`. (b) **cerrado** en `CN-20260922-004` (auditado
   en `CN-20260922-008`): `_poll` de `WorkerMessagesPage` asigna `SynchronousFuture(...)` en
   vez de `Future.value(...)`, así que `FutureBuilder` observa `ConnectionState.done` antes
   de construir el fotograma y ya no pinta el indicador sobre la lista en cada sondeo de
   4 s. (c) En el panel web, un sondeo de postulaciones que **falla** con datos
   en pantalla vacía la lista y muestra el error (`apps/web/app/page.tsx`, `catch` de
   `refreshApplications`): no ocurre cada 4 s, pero un bache de red sí parpadea; corregirlo
   cambia el contrato de errores de esa vista y de `assignment-resolution.spec.ts`. (d) El
   sondeo de Flutter se pausa con la pestaña oculta, pero **no** con la aplicación en
   segundo plano (no hay `AppLifecycleState`).
3. **`resolutionBusy` no se libera con una petición colgada** (BAJO-1 de `CN-20260920-002`,
   causa raíz preexistente): `submitResolution` es el único sitio que lo pone a `false` y
   `request()` de `apps/web/lib/business-api.ts` no usa `AbortSignal` ni timeout, así que
   una lectura del refresco que nunca responde deja la confirmación fija en "Guardando…"
   con todos sus botones deshabilitados, y al cambiar de vista o de turno ninguna fila
   varada vuelve a ofrecer el cierre hasta recargar la página. Se cierra limpiando
   `resolutionBusy` en el efecto de `[activeNav, selectedShiftId, session]` y/o añadiendo
   un timeout en `request()`. Del mismo cierre siguen abiertos BAJO-2 (`decideApplication`
   no comprueba `selectedShiftIdRef` antes de aplicar la respuesta) y BAJO-3 (el estado
   "Guardando…" no tiene región `aria-live`).
4. **Garantías declaradas de la transacción de `resolveAssignment`** (BAJO-1 y BAJO-2 de
   `CN-20260920-004`): `cancelShift` abre su `$transaction` sin `isolationLevel`, así que
   la lectura de `ShiftCancellation` dentro de la transacción `Serializable` de
   `resolveAssignment` no está aislada por el motor frente a una cancelación concurrente
   (la ventana es estrecha y no pierde datos: el conflicto de escritura sobre `Shift` sí se
   detecta y el reintento ve la cancelación); y `current` se calcula fuera de
   `withSerializableRetry`, de modo que un reintento reejecuta el cuerpo con el mismo
   `current.status`/`current.endsAt`.
5. **La credencial de check-in no prueba presencia** (`CN-20260918-002`): no expira, no
   rota, no limita intentos y no hay geolocalización ni cámara.
6. **Copy de piloto residual** (`CN-20260918-012`): con un plan que no es el piloto
   (`PRO`, `CUSTOM` o piloto vencido o pausado) `MembershipView` sigue hablando del
   piloto, y la vista Pagos dice "queda fuera del piloto" incluso sin plan. Solo es
   alcanzable con una fila creada a mano: no existe endpoint de activación de plan.
7. **Filas `CompanySubscription` `TRIAL` fantasma** creadas antes de `CN-20260918-005`:
   no hay criterio seguro para distinguirlas de una activación manual (ver la consulta de
   solo lectura en `docs/reference/api.md`). Limpiarlas exige una columna de origen.
8. **Nombres que evocan custodia**: `WalletMovement`, `/api/workers/wallet` y los estados
   `RELEASED`/`REVERSED` se conservaron a propósito; renombrarlos depende de la decisión
   de modelo económico pendiente.
9. **Higiene**: el reintento de descubrimiento se rotula "Limpiar filtros";
   `CONTEXTO_TESIS.md` (documento externo) aún menciona `worker_pages.dart`. **Cerrados:**
   `apps/api/scripts/e2e-serve.ts` ya no viaja en la imagen de producción (`CN-20260922-001`,
   auditado en `CN-20260922-005`: la etapa `runtime` de `apps/api/Dockerfile.production`
   copia `apps/api/dist/src` en vez de `apps/api/dist` completo, así que `dist/scripts`,
   `dist/tests` y `dist/prisma/seed.js` quedan fuera); y el botón "Actualizar mensajes" ya
   reacciona a un toque que cae sobre un sondeo en curso (`CN-20260922-002`: el ícono se
   convierte en un indicador mientras `_refreshing` es verdadero, sin abrir una segunda
   petición). El contraste de ese indicador, que `CN-20260922-006` dejó abierto como
   MEDIO-1 (se pintaba con `ColorScheme.primary`: 1,68:1 en claro y 4,34:1 en oscuro contra
   el relleno `secondaryContainer` del propio botón, por debajo del mínimo de 3:1 para
   componentes de interfaz), quedó **cerrado** en `CN-20260922-009` (auditado y aprobado en
   `CN-20260922-011`): el indicador fija
   `color: Theme.of(context).colorScheme.onSecondaryContainer`, el mismo color del ícono
   estático al que sustituye, medido en **7,31:1 en claro y en oscuro** sobre el
   `ColorScheme` real de `buildAppTheme` y fijado por
   `apps/mobile_flutter/test/worker_button_contrast_test.dart` (ratio WCAG calculado en la
   prueba, sin hex fijos).
10. **`apps/api/Dockerfile.production` no completa un build ni arrancaría** con el
    `package-lock.json` vigente (detectado en `CN-20260922-001`, confirmado de forma
    independiente en `CN-20260922-005`; **preexistente**, no lo introduce ese cambio).
    `package-lock.json` declara `prisma` y `@prisma/client` únicamente bajo
    `apps/api/node_modules/…`, nunca elevados a la raíz del monorepo. La etapa `build`
    ejecuta `npx prisma generate` con `WORKDIR /workspace` y falla con
    `sh: prisma: not found` (código 127), y la etapa `runtime` copia solo
    `/workspace/node_modules`, así que `@prisma/client` tampoco llegaría a la imagen.
    Afecta el procedimiento de `docs/guides/deployment.md` (`scripts/deploy-hosting.sh`
    construye esta imagen). `apps/web/Dockerfile.production` usa el mismo patrón pero hoy
    no se ve afectado: todas las dependencias de `apps/web` sí se elevan a la raíz. No se
    investigó por qué npm no eleva `prisma`; corregirlo es un alcance nuevo.
11. **Fuera de este ciclo**: la duplicación `CompanyWorkerContact` frente a
    `WorkerTalentProfile` y el rediseño de `main.dart` (inyección de dependencias, tema y
    sesión).

Sin verificar de extremo a extremo: dos sesiones simultáneas; `ABANDONED`, multi-cupo y
la cancelación de la empresa con `cancelShift` seguida de `resolve` sí se ejecutaron
contra API y PostgreSQL reales en la auditoría `CN-20260923-001`, pero con una sonda
desechable, no con una suite permanente del repositorio (la corrida de `CN-20260920-007`
solo ejerce el camino en que **no** existe el `ShiftCancellation` con `actorRole: BUSINESS`);
`demo:seed`/`demo:smoke` con estos cambios, la app Flutter contra una API real y en
dispositivo, y la pantalla web en un móvil físico. De `CN-20260921-005` falta además abrir
un CV real en un navegador con visor de PDF: la prueba de Playwright sustituye
`window.open` por una pestaña falsa y comprueba el `blob:` y su contenido, no que el visor
lo muestre; y `npm run test:web:admin-real` no se corrió con este cambio (es aditivo en la
respuesta de postulaciones). El cambio de copy de Flutter y el `maxLines` de la barra de
postulación tampoco se revisaron en un dispositivo real. De `CN-20260921-007` falta la
comprobación visual: que el parpadeo de "Mis postulaciones" desapareció a simple vista, el
aspecto del aviso nuevo y el comportamiento con latencia de red real se fijan hoy con
pruebas de widgets (ausencia de `CircularProgressIndicator`, identidad de los widgets entre
ticks y offset de scroll) sobre un repositorio falso, no con una captura en un dispositivo
o emulador. De `CN-20260921-009` falta verlo en Chrome o en un dispositivo real: la
auditoría `CN-20260921-010` sí rasterizó la hoja de filtros dentro de `flutter test`
(`RenderRepaintBoundary.toImage`, leyendo los píxeles uno a uno: 1,13:1 antes y 14,91:1
después en oscuro, 14,11:1 sin cambio en claro), pero con la fuente de prueba `Ahem`
—bloques sólidos—, así que el color y la disposición quedan comprobados y la tipografía
real no; el contorno nuevo de campos y chips en oscuro tampoco se ha juzgado a ojo en una
pantalla real. De `CN-20260922-002`, `003`, `004`, `009` y `010` falta igualmente la
comprobación visual
en dispositivo o navegador: que el reingreso a "Postulaciones" se sienta instantáneo, que
"Conversaciones" ya no parpadee y cómo se ve el indicador de 20×20 dentro del
`IconButton.filledTonal` se fijan hoy solo con pruebas de widgets y con el cálculo de
contraste sobre el `ColorScheme`, sin rasterizar el botón (el indicador anima
indefinidamente y colgó la sonda de rasterización de la auditoría `CN-20260922-006`; la
prueba de contraste de `CN-20260922-009` lee el `color` del widget montado y el
`ColorScheme` real, no los píxeles pintados). De
`CN-20260922-001`, el build de `apps/api/Dockerfile.production` **no** se verificó con el
archivo exacto del repositorio: no completa en este entorno por el pendiente 10; la
comprobación de que la imagen ya no contiene `dist/scripts` ni `dist/tests` se hizo sobre
una copia del Dockerfile con un rodeo local, y la API nunca se arrancó dentro del
contenedor.

Antes de fusionar la rama o desplegar: correr `prisma migrate deploy` sobre la base real
del entorno (la migración `20260918120000_assignment_no_show_abandoned` es aditiva) y
repetir el recorrido de `docs/guides/client-demo.md`. Ningún hallazgo crítico o alto
queda abierto en las auditorías de este ciclo.

## Cobertura mínima de pruebas pendiente

- Integración PostgreSQL para perfil, privacidad, búsqueda, cursores, invitaciones y
  reseñas.
- Concurrencia real en cupos, decisiones, cancelación, asistencia, ledger y webhooks.
- Playwright para publicación, selección, mensajería y cierre. Ya cubiertos: el acceso
  empresarial, la paginación del directorio de talento, la invitación de talento y el
  estado de membresía con piloto activo, sin plan activado y con plan Pro (suite
  simulada de `apps/web/e2e/`, veintiocho ejecuciones), y el borrado de un
  trabajador desde el panel superadmin contra el stack real —API Express, PostgreSQL y
  panel Next.js, sin ningún `page.route`— en la suite opcional `apps/web/e2e-real/`
  (`npm run test:web:admin-real`, cerrada en `CN-20260916-094` y reproducida por la
  auditoría `CN-20260916-095`). De la búsqueda de talento falta cubrir los filtros
  mismos (texto, distrito, especialidad y disponibilidad) en la interfaz. De la suite
  real falta que sus aserciones posteriores al borrado comprueben la persistencia en el
  servidor (hoy leen el estado optimista del cliente) y que quede integrada en CI con un
  servicio PostgreSQL dedicado.
- Flutter para perfil editable, sesión real, filtros, estados sin datos, desconexión,
  reanudación SSE y flujo operacional.
- Contratos de autorización negativos para cada rol y recurso.
- Migración desde una copia anonimizada del esquema anterior y restauración de backup.
- Carga/rendimiento de búsqueda, feed y operaciones críticas; accesibilidad web/móvil. Lo
  único cubierto hoy es el costo de render del panel en reposo
  (`apps/web/e2e/render-cost.spec.ts`, `CN-20260921-001`): sondeos sin cambios que no
  vuelven a renderizar y animaciones infinitas que solo mueven `transform`/`opacity`; y el
  costo del cambio claro/oscuro del panel de trabajador en Flutter
  (`apps/mobile_flutter/test/theme_switch_cost_test.dart`, `CN-20260921-003`), contado en
  fotogramas y reconstrucciones de elementos. De accesibilidad, lo único cubierto es el
  contraste de la búsqueda y los filtros del trabajador en ambos modos
  (`apps/mobile_flutter/test/worker_filter_contrast_test.dart`, `CN-20260921-009`): razones
  WCAG calculadas sobre los colores efectivos del árbol renderizado, con pisos de 4,5:1
  para texto y 3:1 para íconos y bordes en oscuro, y pisos de "no peor que hoy" en claro.
  Fuera de esa pantalla no hay ninguna comprobación de contraste: las insignias de estado
  de postulaciones e invitaciones, el recorrido `_JourneyStep` y las pantallas de empresa,
  bienvenida y autenticación siguen sin medirse en pruebas (los valores conocidos están en
  la viñeta de `CN-20260921-009`). Falta medir con datos reales y volumen, en
  navegadores distintos de Chromium, y —en Flutter— en un dispositivo o emulador real con
  `flutter run --profile`/DevTools: `flutter test` no rasteriza, así que el costo de
  `layout`/pintado (sombras con desenfoque, gradientes) y el comportamiento en gama baja
  siguen sin medirse. El entorno de desarrollo actual no permite esa medición (sin Visual
  Studio para `-d windows`, sin `cmdline-tools` de Android para un emulador; solo quedan
  Chrome y Edge, que no representan un móvil).

## Definición de terminado por incremento

Un pendiente se cierra únicamente cuando código, migración, autorización, pruebas,
telemetría y documentación están alineados; se ha validado en un entorno limpio y en
una actualización; no deja fallback ficticio en el flujo real; y el cierre queda
registrado en `docs/PROGRESO.md` con comandos y riesgos verificables.

Las estimaciones se concretarán al convertir cada punto en una tarea acotada. El orden
de los bloques sí es vinculante: primero verdad de datos y operación; después Google,
CV, pagos y automatización pesada.
