# Plan de mejora progresiva de Chambeaya

Actualizado: 24 de agosto de 2026

## Propósito

Este documento convierte el análisis estratégico, funcional y regulatorio de Chambeaya en una ruta incremental de producto.

El objetivo no es construir de inmediato una plataforma financiera, una empresa de intermediación laboral o una integración completa con entidades públicas. El objetivo inmediato es llegar primero a un **piloto profesional**, estable y medible, agregando complejidad únicamente cuando el uso real la justifique.

## Decisión de producto

Chambeaya evolucionará como una plataforma B2B para cubrir y administrar turnos de trabajo temporales. Su valor principal será ayudar a que un turno pase de necesidad empresarial a trabajo efectivamente cubierto, completado y registrado.

La primera versión profesional funcionará como plataforma tecnológica:

- la empresa publica y administra sus necesidades;
- el trabajador encuentra oportunidades y se postula;
- la empresa selecciona y coordina;
- Chambeaya registra el estado y la evidencia operativa;
- la empresa conserva la responsabilidad de definir y formalizar la relación correspondiente mientras no exista una estructura legal distinta aprobada.

No se cobrará al trabajador por acceder a oportunidades. La monetización futura se orientará a la empresa.

El acceso también seguirá este principio: el trabajador puede crear su cuenta desde la app; la empresa no se auto-registra. Las cuentas empresariales serán revisadas y habilitadas directamente por Chambeaya, manteniendo un único inicio de sesión y reduciendo cuentas falsas durante la etapa inicial.

## Principios para avanzar

1. Construir un flujo vertical completo antes de ampliar módulos.
2. Mantener cada fase pequeña, demostrable y cubierta por pruebas.
3. Usar procesos manuales controlados antes de automatizar procesos regulatorios.
4. Evitar almacenar información que no sea necesaria.
5. No custodiar dinero ni manejar biometría durante las primeras fases.
6. No tratar automáticamente todos los turnos como servicios independientes.
7. Medir resultados operativos, no solamente registros o publicaciones.
8. Conservar el modo de demostración mientras se desarrolla el flujo real.

## Estado de partida

### Base completada

- Aplicación Flutter para trabajadores.
- Panel web para empresas.
- API Express con Prisma y PostgreSQL.
- Docker Compose con servicios saludables.
- Registro, inicio de sesión y sesiones persistentes.
- CRUD empresarial de turnos, trabajadores, conversaciones, mensajes y movimientos.
- Publicación de turnos empresariales visible en tiempo real en Flutter mediante SSE.
- UI adaptable para móvil, tablet y escritorio.
- Pruebas de API y Flutter.

### Brechas actuales

- La asistencia y los pagos continúan siendo demostrativos.
- Los estados de cancelación y finalización todavía no están sincronizados.
- RUC y DNI se capturan, pero no se verifican contra fuentes oficiales.
- No existen contratos, consentimientos versionados, comprobantes, retenciones ni auditoría de cumplimiento.
- El modelo de ingresos aún no está implementado.

### Estándar mínimo de una publicación profesional

Tomando como referencia los patrones públicos de Computrabajo —búsqueda por cargo y ubicación, filtros, favoritos/alertas, CV y seguimiento de postulaciones para trabajadores; y publicación guiada, requerimientos, preguntas de filtro y gestión de candidatos para empresas— la publicación de Chambeaya debe ser útil por sí sola antes de pedir una postulación.

Desde esta iteración cada turno puede guardar y mostrar:

- descripción del objetivo del turno;
- funciones principales, una por línea;
- requisitos concretos, sin solicitar datos sensibles;
- modalidad presencial, remota o híbrida;
- horario, distrito/sede, cupos y pago por persona.

La interfaz empresarial guía estos datos en dos pasos y el detalle del trabajador los presenta junto con los datos declarados por la empresa y el estado de la postulación. El detalle **no** muestra "empresa verificada" ni "pago protegido": no existe verificación de empresas ni protección de pago en el producto, y el Bloque 0 del plan maestro prohíbe afirmarlas mientras no haya una fuente real (corregido al cerrar el Hito A, `CN-20260916-093`). Las alertas guardadas y el filtro por modalidad ya forman parte de la primera iteración. También se añadieron hasta tres preguntas opcionales de filtro por publicación; el trabajador las responde antes de postular y la empresa ve las respuestas junto al candidato. No se incorporarán algoritmos de ranking complejos hasta contar con datos reales de postulaciones.

## Punto profesional inicial

Consideraremos alcanzado el primer punto profesional cuando una empresa y un trabajador puedan completar de forma persistente este recorrido:

1. La empresa publica un turno con uno o más cupos.
2. El trabajador lo visualiza y se postula.
3. La empresa revisa la postulación y acepta o rechaza.
4. Ambas interfaces reflejan el mismo estado en tiempo real.
5. El cupo queda reservado sin sobreasignación.
6. Las partes pueden coordinar dentro del turno.
7. El turno puede finalizar o cancelarse con un historial básico.
8. Las pruebas automatizadas verifican permisos, transiciones y aislamiento empresarial.

Este punto no requiere todavía pagos reales, GPS, biometría ni integración directa con SUNAT.

## Camino incremental

### Fase 1 — Postulación y asignación persistentes

Estado: **implementación inicial completada**. El contador de cobertura ya es exclusivamente derivado; prioridad siguiente: ampliar pruebas de permisos y concurrencia.

Objetivo: reemplazar la postulación demostrativa por el primer flujo central real del marketplace.

Backend:

- Añadidos `ShiftApplication` y `ShiftAssignment` vinculados al usuario trabajador y al turno.
- La postulación es única por trabajador/turno y se crea mediante `POST /api/shifts/:id/applications`.
- El trabajador consulta sus estados en `GET /api/workers/applications`.
- La empresa lista postulantes y decide desde `/api/business/shifts/:id/applications`.
- El panel empresarial consulta un resumen de postulaciones pendientes y muestra la alerta en Resumen, Turnos, navegación y notificaciones; la lista del turno se refresca periódicamente.
- La aceptación usa una transacción, valida el cupo y actualiza la cobertura persistida.
- Las decisiones empresariales publican una actualización del feed SSE.

Flutter:

- “Postular ahora” usa la sesión Bearer y persiste en PostgreSQL.
- La app restaura estados remotos al iniciar y evita duplicados mediante upsert.
- La vista de postulaciones muestra el estado devuelto por el API.
- La sesión persistente del trabajador se reutiliza en las llamadas de marketplace.

Panel empresarial:

- El panel muestra postulantes por turno, estado y acciones aceptar/rechazar.
- La cobertura se actualiza después de una decisión empresarial.
- El contador manual `confirmedWorkers` fue retirado del contrato de creación/edición; la cobertura se deriva de asignaciones persistidas.

Criterios de salida:

- La información sobrevive al reinicio de los contenedores.
- Un trabajador no puede postular dos veces al mismo turno.
- No se puede superar la cantidad de cupos.
- Una empresa no puede leer ni modificar postulaciones de otra empresa.
- Flutter y web convergen al mismo estado sin recarga manual.
- Las rutas críticas tienen pruebas automatizadas.

### Fase 2 — Coordinación y estados operativos

Objetivo: hacer confiable el período entre la selección y el inicio del turno.

Avance actual: confirmación, check-in, check-out, cancelaciones y máquina de estados compartida implementados; queda pendiente ampliar auditoría y reglas excepcionales.

- Máquina de estados compartida implementada en el API para derivar el turno desde postulaciones y asignaciones, incluso con varios cupos.
- Añadir confirmación del trabajador y de la empresa.
- Confirmación del trabajador implementada mediante `POST /api/shifts/:id/confirm`.
- Check-in básico con credencial temporal implementado mediante `POST /api/shifts/:id/check-in`.
- Check-out implementado mediante `POST /api/shifts/:id/check-out`; exige un check-in previo y finaliza la asignación.
- Cancelación del trabajador mediante `POST /api/shifts/:id/cancel`, con motivo y registro histórico.
- Cancelación empresarial mediante `POST /api/business/shifts/:id/cancel`, con liberación de asignaciones y cupos.
- Permitir cancelaciones con motivo y fecha.
- Enviar eventos SSE para aceptación, rechazo, cancelación y cambios del turno.
- Vincular conversaciones con una asignación real. **Implementado inicialmente:** al postularse, el trabajador obtiene una conversación persistente con la empresa y el turno.
- Permitir mensajes bidireccionales entre trabajador y empresa, con aislamiento por usuario/empresa y estado de lectura. **Implementado inicialmente.**
- Mantener una actualización frecuente y tolerante a fallos en el panel empresarial; evolucionar a SSE/WebSocket cuando el volumen lo justifique.
- Separar historial de turnos finalizados del feed de acciones: las asignaciones cerradas no deben ofrecer confirmación, check-in ni cancelación.
- Añadir recordatorios temporales dentro de la interfaz.
- La siguiente acción y su actor ya se derivan en el API y se muestran en web; Flutter restaura confirmación/check-in persistidos y presenta la acción operativa correspondiente.

Criterios de salida:

- No existen transiciones ambiguas o imposibles.
- Cada cancelación conserva motivo, actor y momento.
- Empresa y trabajador reciben el cambio de estado oportunamente.
- La mensajería conserva el contexto del turno y la asignación.

### Mensajería colaborativa — primera entrega estable

La comunicación ya no depende de textos locales o datos de demostración:

- `Conversation` admite el vínculo directo con el usuario trabajador mediante `workerUserId`.
- Una postulación persistida crea o reutiliza automáticamente una conversación asociada a la empresa, el trabajador y el turno.
- El trabajador consulta sus conversaciones en `GET /api/workers/conversations`, abre el detalle y envía mensajes en `POST /api/workers/conversations/:id/messages`.
- La empresa mantiene su CRUD de conversaciones y mensajes desde el panel web.
- Los mensajes del interlocutor se marcan como leídos al abrir la conversación.
- El panel web actualiza la conversación activa cada 4 segundos y el trabajador puede refrescar/abrir el detalle desde la app. Esta decisión prioriza estabilidad y recuperación sencilla ante desconexiones; SSE/WebSocket queda como optimización posterior para entrega instantánea.
- Las rutas verifican el rol y la pertenencia de cada conversación; ningún trabajador puede leer conversaciones de otro trabajador y ninguna empresa puede acceder a datos de otra empresa.

La migración correspondiente es `20260824210000_worker_conversations`. La prueba de integración local cubrió: login de ambos roles, postulación, creación automática de conversación, mensaje trabajador→empresa, respuesta empresa→trabajador y lectura del historial. Los registros temporales se eliminaron al finalizar.

### Fase 3 — Asistencia simple y cierre del turno

Objetivo: comprobar la ejecución sin introducir todavía GPS ni biometría.

- Check-in con PIN temporal de la sede o confirmación empresarial.
- Check-out y registro de horas reales.
- Aprobación o corrección de horas por la empresa.
- Registro de tardanza, ausencia e incidencia.
- Cierre del turno únicamente después de resolver la asistencia.
- Historial visible para ambas partes.

Criterios de salida:

- Cada asignación terminada tiene evidencia de inicio, fin y aprobación.
- Las correcciones dejan un historial de auditoría.
- La aplicación funciona aunque se opte por confirmación manual.
- No se recopila ubicación continua ni información biométrica.

### Fase 4 — Confianza y verificación básica

Objetivo: reducir fraude y elevar la confianza con procesos verificables y inicialmente manuales.

- Guardar razón social, nombre comercial, RUC, estado, condición, actividad y fecha de consulta de la empresa.
- Incorporar revisión administrativa de empresas antes de mostrar “Empresa verificada”.
- Verificar identidad del trabajador mediante proveedor o procedimiento autorizado cuando sea viable.
- Permitir que el trabajador adjunte su CUL vigente de manera voluntaria y con finalidad explícita.
- Versionar términos, privacidad y consentimientos.
- Añadir políticas de conservación y eliminación de documentos.
- Registrar el banco de datos personales y preparar atención de derechos ARCO.

No se almacenarán Clave SOL, credenciales bancarias completas ni plantillas biométricas.

### Fase 5 — Modelo económico sin mover dinero

Objetivo: validar la viabilidad económica antes de integrar un proveedor de pagos.

- Crear `PayQuote` con pago del trabajador y fee empresarial separados.
- Crear un ledger de obligaciones, no una billetera real.
- Relacionar cada movimiento con turno, asignación, trabajador y empresa.
- Generar estados `DRAFT`, `APPROVED`, `DUE`, `PAID`, `DISPUTED` y `VOID`.
- Añadir exportación y conciliación manual.
- Probar precios con empresas piloto sin automatizar cobros.

### Membresías empresariales — diseño temprano, cobro posterior

La membresía se diseñará desde ahora, pero se activará comercialmente después de validar el flujo de publicación, postulación, asignación y asistencia.

Primera propuesta concreta:

- `PILOTO`: empresas habilitadas manualmente por Chambeaya, sin cobro automático, con límites operativos configurables.
- `EMPRESA PRO`: plan mensual para empresas con operación recurrente, que incluirá gestión avanzada de turnos, selección de postulantes, métricas y soporte prioritario.
- `EMPRESA CUSTOM`: plan negociado para cadenas o empresas con varias sedes, únicamente cuando exista demanda real.

Los trabajadores conservarán el acceso gratuito a las oportunidades.

La empresa comienza automáticamente con `PILOT/TRIAL`; el panel muestra el plan vigente. La activación de `PRO` se mantiene manual hasta que exista un módulo administrativo y métricas suficientes.

Implementación incremental:

1. Añadir plan, estado de suscripción, periodo y permisos en el modelo de empresa.
2. Activar y cambiar planes manualmente desde administración durante el piloto.
3. Medir empresas activas, turnos publicados, tasa de cobertura, tiempo de cobertura y recurrencia.
4. Definir precio y límites con datos reales antes de integrar pagos automáticos.
5. Evaluar un modelo híbrido de membresía más cargo por turno completado, especialmente para pequeñas empresas peruanas.

No se integrará todavía una pasarela de pago ni se bloqueará el flujo principal por falta de suscripción.

### Auditoría de estados

- Se añadió `ShiftEvent` para registrar publicación, actualización, postulaciones, decisiones, confirmación, check-in, check-out y cancelación.
- La empresa puede consultar el historial de un turno en `GET /api/business/shifts/:id/events`.
- El historial conserva actor, rol, tipo, detalle y fecha sin depender de los textos visibles de la interfaz.

Hipótesis iniciales para validar:

- publicación básica gratuita o limitada;
- fee empresarial de 12 % a 18 % por turno completado;
- recargo transparente por `CUMPLE Rescate`;
- plan empresarial posterior para sedes, equipos, analítica e integraciones;
- ninguna comisión oculta al trabajador.

Los rangos son hipótesis comerciales, no precios definitivos. Si Chambeaya asume planilla, seguros, reemplazos o la condición de empleador, deberá construirse una estructura de costos diferente.

### Fase 6 — Pagos y cumplimiento tributario controlados

Esta fase requiere validación legal, laboral y tributaria previa.

- Elegir un proveedor de servicios de pago regulado.
- Implementar autorización, cobro, devolución y payout en sandbox.
- Mantener conciliación entre proveedor, ledger interno y banco.
- Facturar el servicio de Chambeaya con el tratamiento tributario aplicable.
- Añadir flujo de RHE y retención solo para servicios realmente independientes.
- Añadir el flujo de planilla mediante la empresa o un aliado autorizado cuando exista subordinación.
- Incorporar disputas y reversos antes de habilitar producción.

Chambeaya no custodiará fondos directamente salvo que una evaluación regulatoria posterior lo autorice y justifique.

### Fase 7 — Operación y plataforma de producción

- Roles y permisos para equipos empresariales.
- Panel administrativo interno.
- Auditoría completa de acciones sensibles.
- Observabilidad, alertas y trazas.
- Copias de seguridad y restauración probada.
- CI/CD y pruebas end-to-end.
- Gestión de secretos y rotación.
- Límites de uso, protección antifraude y endurecimiento de API.
- Libro de Reclamaciones y flujo de atención.
- Configuración por entornos y despliegue reproducible.

## Evolución de UI/UX durante todas las fases

La UI/UX no será una etapa aislada. Cada flujo nuevo debe incluir su experiencia completa.

### Reglas de diseño

- Mostrar siempre el estado actual y la siguiente acción.
- Reducir formularios a la información necesaria para la fase.
- Usar lenguaje peruano claro: turno, pago, sede, distrito, postulación y empresa.
- Informar pago, horario, ubicación, tareas y condiciones antes de postular.
- Diseñar primero móvil para trabajadores y escritorio adaptable para empresas.
- Incluir estados de carga, vacío, error, sin conexión y reintento.
- Mantener accesibilidad, navegación por teclado y escalado de texto.
- Evitar mostrar “verificado”, “pagado” o “confirmado” si no existe evidencia real.

### Mejoras visuales tempranas

- Jerarquía más fuerte en tarjetas y detalle del turno.
- Barra de estado de postulación y asignación.
- Indicadores de cupos y urgencia comprensibles.
- Acciones primarias consistentes.
- Confirmaciones y errores cercanos a la acción ejecutada.
- Menos texto decorativo y más información operativa útil.

## Modelo de negocio progresivo

### Etapa de validación

- Conseguir entre 10 y 20 empresas entrevistadas.
- Seleccionar un solo segmento inicial en Lima.
- Medir frecuencia de turnos, urgencia, pago ofrecido, costo actual de cobertura y tolerancia a no-show.
- Operar manualmente la verificación, soporte y conciliación.

### Segmento inicial sugerido

Hospitalidad y eventos en distritos cercanos de Lima, con alcance limitado y empresas previamente verificadas. Antes de realizar operaciones reales debe definirse quién será el empleador y qué modalidades son válidas para cada tipo de turno.

### Métrica norte

**Turnos completados, verificados y pagados sin incidencia.**

Métricas de apoyo:

- tiempo hasta la primera postulación;
- fill rate a 24 y 4 horas del inicio;
- tasa de asistencia y puntualidad;
- cancelaciones por actor y motivo;
- tiempo de aprobación y pago;
- empresas que repiten en 30 y 90 días;
- trabajadores activos en 30 y 90 días;
- margen de contribución por turno;
- disputas e incidentes por cada 100 turnos.

## Entidades y alcance futuro

- **SUNAT:** RUC, comprobantes, RHE, retenciones, IGV, T-Registro y PLAME.
- **SUNAFIL:** correcta clasificación laboral, planilla y seguridad en el trabajo.
- **MTPE:** CUL, RENEEIL, RENAPE y registros laborales aplicables.
- **RENIEC y Migraciones:** identidad y condición migratoria mediante canales autorizados.
- **EsSalud, AFP y ONP:** cobertura y aportes cuando exista relación laboral.
- **BCRP y PSP:** procesamiento, liquidación y trazabilidad de pagos.
- **ANPD:** protección de datos, consentimientos, bancos de datos y seguridad.
- **Indecopi:** transparencia comercial, términos y reclamos.

Estas entidades forman parte del diseño futuro, pero no todas requieren integración directa. Primero se guardarán datos mínimos y evidencias; luego se automatizarán únicamente los procesos con acceso autorizado y valor probado.

## Lo que se pospone deliberadamente

- Custodia directa de fondos.
- Reconocimiento facial o huella digital propia.
- Seguimiento permanente por GPS.
- Matching complejo con inteligencia artificial.
- Nómina propia de Chambeaya.
- Intermediación laboral sin autorización y estructura definidas.
- Integración automática con todas las entidades públicas.
- Expansión nacional antes de conseguir liquidez local.
- Planes de suscripción antes de demostrar recurrencia.
- Microservicios o infraestructura distribuida prematura.

## Orden inmediato de trabajo

Los ocho pasos originales de postulación, asignación, cupos, interfaces, SSE, pruebas y documentación ya están completados en su primera versión.

El siguiente orden activo es:

1. Ampliar las pruebas de concurrencia real sobre aceptación y cierre de turnos con varios cupos.
2. Añadir recordatorios temporales antes del inicio y ante acciones vencidas.
3. Completar la auditoría de correcciones y transiciones excepcionales.
4. Cerrar la fase 2 con pruebas de permisos y aislamiento sobre todas las rutas operativas.
5. Iniciar la asistencia simple de la fase 3 únicamente después de cumplir esos criterios.

## Referencias utilizadas

### Mercado y modelos comparables

- [INEI: indicadores del mercado laboral 2025 y 2026](https://m.inei.gob.pe/media/MenuRecursivo/boletines/empleo-nacional-i-trimestre-2026.pdf)
- [Bumeran Perú: avisos gratuitos y productos empresariales](https://www.bumeran.com.pe/productos/gratis/)
- [Indeed: modelo de publicaciones patrocinadas](https://www.indeed.com/hire/cs/pricing)
- [Workana: proyectos y pagos protegidos](https://www.workana.com/work/freelancers)
- [Upwork: Client Marketplace Fee](https://support.upwork.com/hc/en-us/articles/4660220468499-What-is-the-Client-Marketplace-Fee)
- [Instawork: operación y precios para turnos](https://www.instawork.com/how-it-works)

### Cumplimiento peruano

- [SUNAFIL: contrato laboral frente a locación de servicios](https://www.gob.pe/institucion/sunafil/noticias/594915-cual-es-la-diferencia-entre-un-contrato-de-trabajo-y-un-contrato-de-locacion-de-servicios)
- [SUNAFIL: trabajadores de clubes, mozos y cocineros](https://www.gob.pe/institucion/sunafil/noticias/1329463-sunafil-trabajadores-de-clubes-de-verano-deben-ser-incorporados-a-planilla)
- [SUNAT: recibos por honorarios electrónicos](https://personas.sunat.gob.pe/trabajador-independiente/comprobantes-pago-registro)
- [SUNAT: declaración y retenciones de cuarta categoría 2026](https://personas.sunat.gob.pe/trabajador-independiente/declaracion-pago)
- [SUNAT: T-Registro e intermediación laboral](https://www.sunat.gob.pe/ayuda/tributos/tregistro-E-P/T-RegistroPrivado-H02.html)
- [MTPE: Registro Nacional de Empresas de Intermediación Laboral](https://www.gob.pe/institucion/regiontacna-drtpe/informes-publicaciones/6492482-registro-nacional-de-empresas-y-entidades-que-realizan-actividades-de-intermediacion)
- [RENIEC: servicio de verificación de identidad](https://www.gob.pe/13543)
- [ANPD: nuevo Reglamento de Protección de Datos Personales](https://www.gob.pe/institucion/anpd/informes-publicaciones/7406200-principales-novedades-del-nuevo-reglamento-de-proteccion-de-datos-personales)
- [BCRP: Circular 0022-2025 sobre el Sistema Nacional de Pagos](https://www.bcrp.gob.pe/docs/Transparencia/Normas-Legales/Circulares/2025/circular-0022-2025-bcrp.pdf)
- [Indecopi: cambios para comercio electrónico](https://www.gob.pe/institucion/indecopi/noticias/1352010-por-primera-vez-el-codigo-de-proteccion-del-consumidor-introduce-cambios-para-garantizar-un-comercio-electronico-sin-practicas-abusivas)

## Control del plan

Al terminar cada fase se actualizarán:

- este documento;
- [la referencia de API](../reference/api.md), si cambia un contrato o regla;
- la guía afectada, si cambia un procedimiento de uso u operación;
- pruebas y criterios de aceptación;
- decisiones que cambien el modelo de negocio o el alcance regulatorio.

Los cierres, resultados de pruebas y riesgos se registran únicamente en
[`docs/PROGRESO.md`](../PROGRESO.md). El avance del 22 de agosto y los planes
anteriores se conservan en el archivo documental como contexto, no como una
lista de trabajo vigente.

La siguiente fase no debe comenzar si el flujo anterior todavía tiene estados simulados, errores críticos o información contradictoria entre web, API y Flutter.
