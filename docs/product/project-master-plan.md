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
  `flutter analyze` no reporta ningún error (quedan 15 avisos `info` de estilo, dos de
  ellos en `worker_pages.dart`, archivo que ningún archivo de `lib/` importa) y
  `flutter test` (67/67), la suite de la API (113/113) y la prueba vertical de
  integración contra PostgreSQL real (2/2) pasan. **Pendiente:** ninguna corrida de
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
  Sigue pendiente: expiración y rotación de credenciales (la credencial no caduca y el
  propio trabajador la recibe del API, así que no prueba presencia); una ventana
  propia de check-out (hoy sigue siendo válido en cualquier momento tras el check-in,
  hasta que el margen de 60 minutos tras `endsAt` marca la asignación `ABANDONED`);
  **una interfaz para el cierre manual** (`resolve` existe solo como endpoint HTTP: ni
  el panel web ni Flutter ofrecen un control que lo invoque, así que en la práctica la
  ruta de cobro de un `NO_SHOW`/`ABANDONED` exige llamar a la API a mano); y el
  **cierre de turnos multi-cupo parcialmente cubiertos** (si una asignación completó y
  otra quedó `NO_SHOW`/`ABANDONED`/`CANCELLED`, el turno se queda en `CHECKED_IN`
  aunque `endsAt` haya pasado, y solo sale de ahí pagando la asignación pendiente;
  es comportamiento previo a estos estados, detallado en `docs/reference/api.md`).
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
  PostgreSQL conserva sólo metadatos y una clave, y únicamente el trabajador
  autenticado puede descargarlos. Pendiente: almacenamiento de objetos, hash,
  antivirus/cuarentena, descarga temporal y eliminación auditada.
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
  corrió — esas empresas siguen viendo "Piloto activo" indistinguible de una activación
  real hasta que exista esa tarea de una sola vez.
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
   honesto en su rama alcanzable) y `worker_pages.dart` conserva insignias fabricadas
   ("100% de entradas a tiempo", "Reemplazante IA") en una `RewardsPage` que ya no importa
   ningún archivo de `lib/`. `CN-20260916-093` comprobó las dos afirmaciones: `companyVerified`
   solo se escribe una vez en todo el repositorio y con el valor `false`, el servicio de demo
   ni siquiera envía la clave y el modelo de Flutter la inicializa en `false`, así que no
   existe hoy ningún camino —tampoco en modo demo— por el que se muestre "Empresa
   verificada"; y `worker_pages.dart` solo lo importa `test/worker_flow_test.dart`.

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
- **`setState(() => x = Future)` en cuatro puntos** (`worker_secondary_pages.dart:37`, `:61`,
  `:479` y `worker_discovery_page.dart:142`): en compilación *debug* el `assert` de
  `State.setState` lanza y la pantalla no se reconstruye; en *release* no ocurre. Afecta al
  refresco periódico de "Conversaciones" y a dos botones de reintento (MEDIO-2 de
  `CN-20260916-091`, sigue abierto).
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

## Cobertura mínima de pruebas pendiente

- Integración PostgreSQL para perfil, privacidad, búsqueda, cursores, invitaciones y
  reseñas.
- Concurrencia real en cupos, decisiones, cancelación, asistencia, ledger y webhooks.
- Playwright para publicación, selección, mensajería y cierre. Ya cubiertos: el acceso
  empresarial, la paginación del directorio de talento y la invitación de talento
  (suite simulada de `apps/web/e2e/`, dieciséis ejecuciones), y el borrado de un
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
- Carga/rendimiento de búsqueda, feed y operaciones críticas; accesibilidad web/móvil.

## Definición de terminado por incremento

Un pendiente se cierra únicamente cuando código, migración, autorización, pruebas,
telemetría y documentación están alineados; se ha validado en un entorno limpio y en
una actualización; no deja fallback ficticio en el flujo real; y el cierre queda
registrado en `docs/PROGRESO.md` con comandos y riesgos verificables.

Las estimaciones se concretarán al convertir cada punto en una tarea acotada. El orden
de los bloques sí es vinculante: primero verdad de datos y operación; después Google,
CV, pagos y automatización pesada.
