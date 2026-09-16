# Perfil de talento e integraciones futuras

Este plan convierte el perfil del trabajador en una fuente de datos real sin activar proveedores externos prematuramente.

## Bloque cerrado: perfil global y reputación v1

El perfil profesional global queda separado del contacto histórico que una empresa puede conservar. El trabajador autenticado actualiza titular, presentación, distrito, visibilidad y hasta doce especialidades del catálogo. La disponibilidad combina días, franjas horarias y una nota opcional; cada especialidad puede indicar nivel y años de experiencia. Las empresas consultan perfiles visibles en `GET /api/business/talent`, con filtros por especialidad, distrito, disponibilidad y texto libre (`query`, hasta 100 caracteres, coincidencia parcial insensible a mayúsculas sobre nombre, titular y distrito). Todos los filtros se resuelven en el servidor y se combinan entre sí.

La búsqueda está conectada al panel empresarial con paginación. El contacto histórico se denomina `CompanyWorkerContact`; no puede guardar reputación, compatibilidad, trabajos completados ni verificación global. La aplicación móvil usa API por defecto y la demo exige `CUMPLENOW_DEMO_MODE=true`.

La completitud se deriva de campos reales; no es reputación. `matchScore` no se envía en el flujo real hasta contar con matching v1. Los datos ficticios de perfil móvil fueron retirados.

## Perfil ampliado — experiencia, certificaciones, idiomas y radio/distritos de trabajo (Alcance 6, servidor y Flutter entregados y auditados)

El trabajador autenticado puede declarar, además de lo anterior:

- **Experiencia laboral**: varias entradas relacionadas (`WorkerExperience`, no texto libre), con rol, empleador, descripción opcional y rango de fechas (`endDate` ausente = puesto vigente).
- **Certificaciones**: varias entradas relacionadas (`WorkerCertification`), con nombre, entidad emisora, fechas y un identificador de credencial, todos opcionales salvo el nombre. **Son metadatos declarados, nunca una verificación**: el modelo no tiene ningún campo de estado de verificación y la API rechaza cualquier intento de enviar uno (`verified`, `isVerified`, etc.). Marcar una certificación como verificada es un ítem distinto y futuro del Bloque 4 (endurecimiento/confianza), fuera de este alcance.
- **Idiomas**: varias entradas relacionadas (`WorkerLanguage`) con idioma y nivel autopercibido (`BASIC`/`CONVERSATIONAL`/`FLUENT`/`NATIVE`); no admite el mismo idioma dos veces en un mismo perfil.
- **Radio y distritos de trabajo**: un radio en kilómetros (`workRadiusKm`) y una lista de distritos adicionales (`workDistricts`) donde el trabajador acepta trabajar, distintos de su distrito principal (`district`). La preferencia de turnos (días/franjas horarias) ya existía como `availabilityDays`/`availabilityPeriods` desde el bloque anterior; este alcance no le agrega un campo nuevo porque ya cumple ese criterio.

**Visibilidad granular por sección:** cuatro banderas independientes (`isExperienceVisible`, `isCertificationsVisible`, `isLanguagesVisible`, `isWorkAreaVisible`) permiten ocultar una sección concreta del directorio empresarial sin ocultar el perfil entero ni borrar los datos: el propio trabajador sigue viendo y editando la sección oculta en todo momento desde `GET/PATCH /api/workers/me/profile`; solo `GET /api/business/talent` la devuelve vacía mientras esté oculta. Ver `docs/reference/api.md`, sección "Perfil ampliado", para el contrato exacto.

La métrica `completion` se recalculó para las 13 señales de contenido ahora disponibles (las ocho anteriores más radio/distritos, experiencia, certificaciones e idiomas), corrigiendo además un defecto previo: antes el divisor estaba fijo en 9 pese a que el máximo real alcanzable era 8, por lo que ningún perfil llegaba nunca a 100%.

**Interfaz Flutter entregada:** `profile_home_page.dart` y su repositorio de talento (`talent_profile_repository.dart`) ya exponen crear, editar, eliminar, ocultar y recuperar cada una de las cuatro secciones. El editor de perfil agrega una subsección por bloque (radio/distritos, experiencia, certificaciones, idiomas), cada una con su propio interruptor de visibilidad granular independiente de los otros tres y del interruptor de visibilidad del perfil entero; las listas se editan con diálogos de agregar/editar y un botón de eliminar por entrada, siguiendo el mismo patrón de reemplazo completo por `PATCH` que ya usaban las especialidades. La interfaz de certificaciones no muestra ni insinúa ningún estado de "verificado", consistente con que el servidor no tiene ese campo. Un perfil creado antes de este alcance (sin las cuatro secciones nuevas) se carga y edita sin error: el cliente trata las claves ausentes o vacías igual que el servidor, con las cuatro banderas de visibilidad asumidas en `true` por defecto. Auditado y aprobado en `CN-20260916-089`, que además verificó el contrato enviando el JSON real del cliente contra `profileSchema` del servidor; con ello el Alcance 6 queda cerrado (ver `docs/PROGRESO.md`). La validación de extremo a extremo del `PATCH` contra la API y PostgreSQL reales desde el cliente sigue pendiente de una prueba de integración.

## Reseñas y reputación v1

`AssignmentReview` permite una reseña de 1 a 5 estrellas por participante y asignación, exclusivamente después de un check-out que complete la asignación. El API rechaza autores ajenos y duplicados. El resultado público de talento incluye `reputation.averageRating` y `reputation.reviewCount`; cuando no existen evaluaciones devuelve `null` y `0`.

La lista empresarial solo muestra nombre, titular, distrito, disponibilidad, especialidades, reputación agregada, `completion` y —cuando el trabajador no las ocultó— experiencia, certificaciones, idiomas y radio/distritos de trabajo (ver "Perfil ampliado"); no correo, DNI, teléfono, CV, foto, `bio` ni notas privadas.

## Pendientes de este dominio

- Matching v1 explicable desde especialidades, disponibilidad, distrito y conflictos de horario.
- Moderación, reporte, ocultamiento y apelación de reseñas.
- Métricas adicionales derivadas: puntualidad, trabajos completados, cancelaciones y ausencias.
- Invitaciones persistentes y contacto con consentimiento: el servidor está entregado (`TalentInvitation`, cinco rutas de creación/listado/aceptación/rechazo, vencimiento de 7 días evaluado en servidor, duplicado activo bloqueado por índice único parcial y regla explícita de que aceptar una invitación **no** abre una conversación; ver `docs/reference/api.md`, sección "Invitaciones de talento"). El **panel web empresarial también está entregado**: cada tarjeta de "Talento disponible" tiene un botón "Invitar" que llama de verdad a `POST /api/business/talent-invitations` y solo muestra éxito tras la respuesta real, y la sección "Invitaciones enviadas" lista `GET /api/business/talent-invitations` con su estado real (el `message` de la invitación se muestra siempre como texto, nunca como HTML). **El lado del trabajador (Flutter) también está entregado, pendiente de auditoría:** una pantalla nueva "Invitaciones", accesible desde la navegación del trabajador (`WorkerInvitationsPage`, `talent_invitation_repository.dart`), lista `GET /api/workers/me/talent-invitations` con estados de carga, vacío y error explícitos; cada invitación `PENDING` no vencida ofrece "Aceptar"/"Rechazar", que llaman de verdad a `POST /api/workers/me/talent-invitations/:id/{accept,decline}` y solo actualizan la tarjeta con la respuesta real del servidor (nunca de forma optimista); una invitación ya respondida, vencida o cancelada solo muestra su estado, sin botones. Con esto el ciclo completo de consentimiento ya se puede recorrer de extremo a extremo (empresa invita → trabajador acepta o rechaza), a falta de auditoría.
- Ejecución observada de la prueba integrada de reseñas en PostgreSQL efímero de CI.

## Google Sign-In web — habilitado para piloto local

Con `GOOGLE_OAUTH_WEB_CLIENT_ID` configurado, `GET /api/auth/providers` informa si el proveedor está habilitado y `POST /api/auth/google` verifica el ID token contra el cliente web configurado. La identidad externa se persiste con proveedor y `sub`; se reutilizan nombre y correo que entrega Google, pero en el primer acceso se exige el DNI y una contraseña nueva exclusiva de Cumple Now antes de los datos profesionales. La contraseña de Google nunca llega a Cumple Now. Las cuentas Google creadas antes de esta regla quedan marcadas para crear su contraseña local al restablecer su sesión. No se fusionan cuentas automáticamente por correo.

Este alcance cubre la aplicación web de Flutter en desarrollo/piloto. Antes de producción pública faltan clientes Android/iOS, recuperación mediante correo verificado, cambio de contraseña con revocación de sesiones, rate limiting, protección antifuerza bruta y una revisión de seguridad de OAuth.

## CV y foto de perfil privados — habilitados para piloto

El trabajador puede cargar o reemplazar un PDF de hasta 5 MB y una foto JPG, PNG o WebP de hasta 3 MB. PostgreSQL conserva solo metadatos y una clave; los archivos se guardan fuera de los recursos estáticos y se sirven únicamente al propio trabajador mediante una sesión válida. En desarrollo y piloto se usa un volumen privado local configurable con `DOCUMENT_STORAGE_ROOT`; antes de producción pública se debe sustituir por un proveedor de objetos, añadir análisis antimalware, transformación segura de imágenes, retención y eliminación auditada.
