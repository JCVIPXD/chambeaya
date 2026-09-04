# Avance de implementación — 22 de agosto de 2026

## Estado general

Cumple Now cuenta con una base funcional para demostración local compuesta por:

- aplicación Flutter orientada a trabajadores;
- panel web Next.js para empresas;
- API Express con Prisma;
- PostgreSQL ejecutándose mediante Docker Compose;
- contratos compartidos en el monorepo.

El entorno local fue levantado y validado en Windows con Docker Desktop. Los servicios `web`, `api` y `db` reportan estado `healthy`.

## Funcionalidades completadas

### Infraestructura y entorno local

- Monorepo npm con API, web y paquete compartido.
- Docker Compose para PostgreSQL, API y panel web.
- Puertos limitados a la interfaz local:
  - web: `127.0.0.1:3000`;
  - API: `127.0.0.1:4000`;
  - PostgreSQL: `127.0.0.1:5433`.
- Health checks para los tres servicios.
- Migraciones Prisma ejecutadas al iniciar el API.
- Configuración de desarrollo de Next.js compatible con `127.0.0.1` y HMR.

### Autenticación persistente

- Registro e inicio de sesión contra PostgreSQL.
- Contraseñas almacenadas mediante hash y salt.
- Sesiones opacas con expiración de 30 días.
- Los tokens se almacenan en la base de datos únicamente como hashes SHA-256.
- Endpoints para crear, consultar y cerrar sesión.
- Flutter conserva la sesión localmente, la valida al iniciar y permite cerrarla.
- Persistencia comprobada después de reiniciar el contenedor del API.
- El registro público queda limitado a trabajadores; las cuentas empresariales se habilitan directamente por el equipo de Cumple Now.
- El acceso empresarial conserva únicamente el inicio de sesión y ya no muestra formularios de auto-registro.
- El API rechaza intentos públicos de registro con `role: BUSINESS`, sin afectar las cuentas empresariales ya provisionadas.

### Aplicación Flutter para trabajadores

- Onboarding y selección de tipo de cuenta.
- Registro e inicio de sesión.
- Experiencia adaptable para móvil, tablet y escritorio.
- Descubrimiento de oportunidades con búsqueda y filtros.
- Detalle de turno y postulación de demostración.
- Guardados, seguimiento de postulaciones y mensajes de demostración.
- Perfil, reputación, certificados y experiencia.
- Estados de carga, lista vacía y error simulado.
- Rediseño visual de descubrimiento manteniendo la identidad CUMPLE NOW:
  - navegación lateral con marca, estado del perfil y mayor jerarquía;
  - encabezados enriquecidos para móvil y escritorio;
  - tarjetas de turnos con empresa, verificación, beneficios, pago y compatibilidad;
  - detalle con resumen visual, datos clave, tareas y señales de confianza;
  - barra de postulación adaptable y accesible;
  - superficies tonales, profundidad ligera y mejor aprovechamiento del espacio.

### Panel web empresarial

- Sistema visual minimalista alineado con la aplicación principal.
- Navegación adaptable de escritorio y móvil.
- Resumen operativo con indicadores, cobertura, talento y pagos.
- Vista de turnos con:
  - búsqueda y filtros;
  - indicadores de cobertura y costo;
  - selección y panel de detalle;
  - publicación de nuevos turnos;
  - activación del flujo CUMPLE Rescate.
- Vista de trabajadores con:
  - directorio y filtros de disponibilidad;
  - habilidades, compatibilidad e índice CUMPLE;
  - invitaciones y acceso a mensajería.
- Vista de mensajes con:
  - listado y búsqueda de conversaciones;
  - contexto del turno;
  - envío local de mensajes.
- Vista de pagos con:
  - saldo disponible y comprometido;
  - próximo desembolso;
  - filtros y movimientos;
  - estados de validación y métodos de pago.
- Notificaciones, avisos, modales y estados vacíos interactivos.
- Acceso empresarial persistente desde el navegador.
- Perfil empresarial editable y aislado por propietario.
- CRUD persistente de turnos, trabajadores, conversaciones, mensajes propios y movimientos de pago.
- Los formularios del panel están conectados al API y PostgreSQL; los listados se sincronizan al iniciar sesión.
- La publicación, edición o eliminación de turnos actualiza en tiempo real el marketplace de trabajadores.

### API CRUD empresarial

- Autorización obligatoria mediante token Bearer y cuenta `BUSINESS`.
- Aislamiento de todos los registros mediante `companyId` derivado de la sesión.
- Validación de payloads con Zod.
- Respuestas coherentes para validación, registros duplicados, acceso denegado y recursos inexistentes.
- Relaciones con eliminación en cascada para evitar registros huérfanos.
- Migración Prisma `20260822210930_core_business_crud` aplicada correctamente.
- Consulta la referencia completa en [API_CRUD.md](API_CRUD.md).

### Sincronización de turnos en tiempo real

- El marketplace dejó de utilizar un catálogo aislado cuando la app se ejecuta con la API local.
- `GET /api/shifts` consulta turnos `PUBLISHED` vigentes directamente desde PostgreSQL.
- `GET /api/shifts/events` mantiene un canal Server-Sent Events abierto.
- Las mutaciones empresariales publican una nueva fotografía del marketplace.
- Flutter reconcilia la lista conservando filtros, guardados y turno seleccionado.
- El cliente reintenta la conexión y utiliza una consulta HTTP como respaldo.
- La interfaz identifica explícitamente el estado mediante “Turnos en tiempo real”.

## Validaciones realizadas

En la última revisión se comprobó:

- compilación de producción de Next.js sin errores de TypeScript;
- respuesta HTTP 200 del panel web;
- respuesta HTTP 200 de `GET /api/health`;
- pruebas automatizadas del API: 14 aprobadas;
- pruebas automatizadas de Flutter: 45 aprobadas;
- validación responsive de la nueva UI en 320, 390, 834 y 1440 píxeles;

## Avance adicional — 24 de agosto de 2026

Se implementó el primer flujo central persistente del producto:

- migración Prisma `20260824173428_shift_applications_assignments`;
- postulaciones únicas por trabajador y turno;
- asignaciones creadas en transacción al aceptar una postulación;
- validación de cupos para evitar sobreasignación;
- endpoints para postular, listar estados propios y decidir desde el panel empresarial;
- sesión Bearer reutilizada por Flutter en las operaciones del marketplace;
- panel de turnos con candidatos y acciones aceptar/rechazar;
- actualización SSE después de las decisiones empresariales.

Validaciones de esta iteración:

- API build: correcto;
- pruebas API: 18 aprobadas;
- Flutter analyze: sin incidencias;
- pruebas Flutter: 45 aprobadas;
- build Next.js dentro de Docker: correcto;
- Docker Compose: `db`, `api` y `web` healthy.

## Aviso de postulaciones pendientes — 24 de agosto de 2026

- Se añadió `GET /api/business/applications/pending`, protegido por sesión empresarial, para obtener el total de postulaciones `PENDING` y los turnos afectados.
- El panel muestra el aviso en Resumen y Turnos, agrega el contador dinámico en la navegación y lo incorpora al centro de notificaciones.
- La lista de postulaciones del turno seleccionado se actualiza cada 4 segundos, de modo que una nueva postulación aparece sin recargar el navegador.
- Después de aceptar o rechazar, el contador se recalcula inmediatamente.
- Se retiraron los badges fijos de demostración (`8` turnos y `3` mensajes); ahora los indicadores reflejan datos persistidos reales.

## Corrección de asignaciones finalizadas — 24 de agosto de 2026

- El API conserva el estado operativo real del turno (`ASSIGNED`, `CHECKED_IN`, `COMPLETED` o `CANCELLED`) al devolver una postulación.
- Flutter ya no restaura en el feed activo los turnos finalizados o cancelados que estaban en caché local.
- Una postulación aceptada cuyo turno o asignación ya terminó se presenta como cerrada y no muestra “Confirmar asignación”, check-in ni cancelación.
- El endpoint de confirmación también valida en servidor que la asignación siga `ASSIGNED`, que el turno no esté cerrado y que su fecha de fin no haya pasado.
- Se añadió una prueba de regresión para evitar que un turno `COMPLETED` vuelva a mostrarse como accionable al cambiar de interfaz.

## Coordinación inicial — confirmación y check-in

- La asignación ahora conserva `workerConfirmedAt` y `checkedInAt`.
- El trabajador puede confirmar una asignación aceptada.
- El check-in valida la credencial temporal generada al aceptar el turno.
- Un check-in válido cambia el turno a `CHECKED_IN`.
- El check-out exige un check-in previo y marca la asignación como `COMPLETED`.
- El turno finalizado pasa a `COMPLETED` de forma transaccional.
- Las cancelaciones registran motivo, actor y fecha sin borrar la postulación.
- La empresa puede cancelar un turno y liberar sus asignaciones desde el API.

## Membresías y auditoría inicial

- Se añadieron `SubscriptionPlan` (`PILOT`, `PRO`, `CUSTOM`) y `SubscriptionStatus`.
- Cada empresa recibe automáticamente una suscripción `PILOT/TRIAL` de 30 días al consultar su estado.
- El panel muestra el plan actual sin activar cobros automáticos.
- Se añadió `ShiftEvent` para registrar las transiciones operativas principales.
- La empresa puede consultar el historial de eventos de cada turno.
- La app muestra acciones de confirmación y check-in dentro de “Mis postulaciones”.
- No se solicita GPS, cámara ni biometría.

## Mejora de publicación y postulación — 24 de agosto de 2026

- Se corrigió el desbordamiento visual de las tarjetas de oportunidades en el layout tablet: la grilla dejó de imponer una relación de aspecto menor que el contenido dinámico.
- El smoke test de Flutter para 320 px continúa pasando sin overflow; también se validó el análisis estático y las 45 pruebas de Flutter.
- El modelo `Shift` ahora admite `description`, `responsibilities`, `requirements` y `modality`, con migración Prisma `20260824203000_shift_job_details`.
- El panel empresarial reemplazó el formulario mínimo por una publicación guiada en dos pasos, con cargo sugerido, descripción, funciones, requisitos, modalidad, horario, sede, cupos, pago e indicaciones operativas.
- La vista de detalle del trabajador muestra la información real de la publicación, incluyendo funciones y requisitos separados, en lugar de usar únicamente texto demostrativo.
- La validación de API exige contenido suficiente para descripción, funciones y requisitos cuando la empresa los envía, manteniendo compatibilidad con registros históricos.
- Se probó el flujo contra Docker: una publicación con estos campos fue visible desde `/api/shifts` para el trabajador y luego se eliminó para conservar la base local limpia.

Esta iteración sigue el patrón de los portales de empleo maduros: búsqueda por cargo/ubicación, información completa antes de postular y seguimiento de estados. Las alertas guardadas, preguntas de filtro y analítica de conversión quedan como siguiente incremento pequeño.

## Búsqueda y alertas del trabajador — 24 de agosto de 2026

- Se añadió el filtro de modalidad (`Presencial`, `Híbrido` y `Remoto`) en Flutter y en la búsqueda del API.
- El filtro de modalidad se conserva durante la actualización SSE del marketplace y forma parte de la firma de reconciliación de turnos.
- El trabajador puede guardar una alerta basada en sus filtros actuales desde el panel de filtros.
- La alerta se persiste localmente con `SharedPreferences`, se restaura al abrir la app y puede actualizarse o quitarse.
- El modo de demostración utiliza un almacén en memoria aislado para no contaminar las pruebas ni los datos locales.
- Se añadieron pruebas para modalidad, creación de alertas y accesibilidad responsive.

Las alertas, la modalidad y las preguntas de filtro ya forman un primer flujo de búsqueda y postulación profesional. La siguiente mejora se concentra en reglas operativas y transiciones de estado.

## Mensajería trabajador-empresa — 24 de agosto de 2026

- Se añadió la migración Prisma `20260824210000_worker_conversations`, que relaciona cada conversación con el usuario trabajador autenticado.
- Al enviar una postulación real se crea o reutiliza una conversación vinculada al turno, empresa y trabajador.
- El API expone listado, detalle y envío de mensajes para trabajadores, con autorización Bearer y aislamiento por propietario.
- El panel web empresarial continúa enviando mensajes persistentes y refresca la conversación activa cada 4 segundos para mantener una coordinación rápida sin introducir todavía infraestructura adicional.
- Flutter carga conversaciones reales, muestra estados de carga/vacío/error y permite enviar mensajes desde un compositor dentro del detalle.
- La lectura de una conversación marca como leídos los mensajes del interlocutor.
- Se validó en Docker el recorrido bidireccional completo con ambos usuarios demo. Después de validar, se limpiaron turnos, postulaciones, perfiles, conversaciones y mensajes temporales; la base conserva únicamente las dos cuentas demo y la empresa base.

Validaciones de esta iteración:

- API build: correcto.
- Pruebas API: 20 aprobadas.
- Build web Next.js: correcto.
- Flutter analyze: sin incidencias.
- Pruebas Flutter: 46 aprobadas.
- Docker Compose: `db`, `api` y `web` healthy.
- validación de texto al 200 % en los límites de tablet sin desbordes;
- análisis estático de Flutter sin incidencias y build web generado correctamente;
- contenedores `web`, `api` y `db` en estado `healthy`;
- logs recientes de Docker sin errores.

## Preguntas de filtro en postulaciones — 24 de agosto de 2026

- Cada turno puede guardar hasta tres preguntas opcionales de filtro, con límites de longitud validados por el API.
- El panel empresarial permite escribir una pregunta por línea y advierte que no se deben solicitar datos sensibles.
- Flutter muestra las preguntas en el detalle y exige responderlas antes de enviar la postulación.
- Las respuestas se guardan como una fotografía versionada dentro de `ShiftApplication`, por lo que conservan el texto que vio el trabajador aunque la publicación se edite después.
- La empresa ve las respuestas junto al nombre y estado de cada candidato antes de aceptar o rechazar.
- La migración aditiva es `20260824223000_application_screening_questions`.

Validaciones de esta iteración:

- pruebas API: 23 aprobadas;
- build API: correcto;
- build web Next.js: correcto;
- Flutter analyze: sin incidencias;
- pruebas Flutter: 49 aprobadas.

## Máquina de estados operativa — 26 de agosto de 2026

- Se centralizó la derivación de estados de turno, postulación y asignación en el API.
- Un check-out completa únicamente la asignación correspondiente; un turno de varios cupos permanece en curso hasta que todas sus asignaciones efectivas finalicen.
- El check-in exige que el trabajador haya confirmado previamente la asignación y las operaciones terminales ya no pueden reabrirse mediante una edición manual.
- `confirmedWorkers` y `status` dejaron de aceptarse como campos editables del turno; ambos se actualizan desde las operaciones persistidas.
- Los turnos con postulaciones conservan su historial y no pueden eliminarse como si fueran borradores vacíos.
- La aceptación directa heredada del prototipo quedó deshabilitada en modo PostgreSQL; toda asignación real nace de una postulación aceptada dentro de una transacción.
- Las respuestas de postulaciones incluyen `nextAction`, con el actor responsable y la acción esperada; el panel empresarial la muestra junto a cada candidato.
- Flutter restaura desde el API la confirmación, check-in y check-out de la asignación, de modo que la acción correcta sobrevive a una recarga.
- Se añadieron pruebas unitarias para turnos de varios cupos, reapertura de cobertura, estados terminales y secuencia de acciones.

Validaciones de esta iteración:

- pruebas API: 28 aprobadas;
- build API TypeScript: correcto;
- build web Next.js: correcto;
- Flutter analyze: sin incidencias.
- pruebas Flutter: 51 aprobadas.

## Alcance de demostración actual

La autenticación, sesiones, módulos empresariales y feed público de turnos son persistentes. El modo de demostración en memoria continúa disponible cuando Flutter se ejecuta sin `USE_LOCAL_API=true`.

No están habilitados pagos reales, retiros, contacto con empleadores reales, cámara, GPS, foto de DNI ni reconocimiento facial.

## Próximas fases recomendadas

El desarrollo continuará de forma incremental, priorizando primero un flujo profesional de publicación, postulación, selección y asignación. Los pagos reales, la biometría y las integraciones regulatorias se incorporarán únicamente después de validar el núcleo operativo.

La ruta completa, sus criterios de salida, el modelo de negocio progresivo y las referencias peruanas se encuentran en [PLAN_MEJORA_PROGRESIVA.md](PLAN_MEJORA_PROGRESIVA.md).

La siguiente fase activa es:

1. Completar pruebas de concurrencia real, permisos, aislamiento y transiciones excepcionales.
2. Añadir recordatorios temporales para las acciones operativas ya formalizadas.
3. Completar la auditoría de correcciones sin permitir saltos manuales de estado.
4. Cerrar los criterios de la fase 2 antes de ampliar la asistencia de la fase 3.

## Comandos de operación local

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d --build
docker compose ps
```

Panel empresarial: `http://127.0.0.1:3000`

API: `http://127.0.0.1:4000/api`

Flutter web con API local:

```powershell
flutter run -d chrome --web-port 7357 --dart-define=USE_LOCAL_API=true
```

## Nota sobre datos locales

Docker Compose utiliza el volumen `cumplenow-stable-postgres-data`. No debe eliminarse si se desea conservar las cuentas y sesiones creadas durante el desarrollo.
