# API CRUD empresarial

## Autenticación

Todas las rutas bajo `/api/business` requieren una sesión válida de tipo `BUSINESS`:

```http
Authorization: Bearer <token>
```

El API obtiene el propietario desde la sesión. No acepta un `companyId` enviado por el cliente, evitando que una empresa acceda a registros de otra.

## Superadmin: cuentas empresariales

Las rutas bajo `/api/admin` requieren una sesión `ADMIN` y permiten gestionar el alta de empresas que ya entregaron sus datos a CumpleNow:

- `GET /api/admin/overview`: métricas operativas.
- `GET /api/admin/companies`: listado con propietario y suscripción.
- `POST /api/admin/companies`: crea en una transacción la cuenta `BUSINESS` y su empresa.
- `PATCH /api/admin/companies/:id`: actualiza datos operativos (RUC, correo y contraseña no se modifican aquí).
- `DELETE /api/admin/companies/:id`: elimina la empresa y su cuenta propietaria; no permite eliminar la cuenta del administrador actual.

El alta exige nombre comercial, RUC de 11 dígitos, correo y contraseña inicial (mínimo 8 caracteres, con mayúscula y número). Los datos de contacto y razón social pueden completarse o editarse después desde el panel.

## Empresa

- `GET /api/business/company`: obtiene el perfil. Si la cuenta es anterior a esta implementación, crea el perfil empresarial automáticamente con el nombre y RUC registrados.
- `PATCH /api/business/company`: actualiza nombre comercial, razón social, industria, teléfono, dirección o distrito.

## Turnos

- `GET /api/business/shifts`
- `POST /api/business/shifts`
- `GET /api/business/shifts/:id`
- `PATCH /api/business/shifts/:id`
- `DELETE /api/business/shifts/:id`

Ejemplo de creación:

```json
{
  "title": "Mozo de salón",
  "location": "Miraflores",
  "startsAt": "2026-08-24T18:00:00.000Z",
  "endsAt": "2026-08-25T00:00:00.000Z",
  "payCents": 10000,
  "requiredWorkers": 4,
  "screeningQuestions": [
    "¿Tienes disponibilidad durante todo el horario indicado?"
  ],
  "notes": "Ingreso por puerta de personal"
}
```

Estados: `PUBLISHED`, `ASSIGNED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`.

El estado y `confirmedWorkers` son derivados por el servidor. No se aceptan en los formularios de creación o edición. Un turno con actividad no se puede borrar y, una vez iniciado el check-in, tampoco se puede editar ni cancelar destruyendo su historial.

Cada creación, edición o eliminación de un turno notifica inmediatamente al feed del marketplace. Solo los turnos `PUBLISHED` que todavía no finalizaron aparecen para trabajadores.

`screeningQuestions` es opcional y acepta hasta tres preguntas de 10 a 240 caracteres. No debe utilizarse para solicitar DNI, información de salud ni otros datos sensibles.

## Marketplace para trabajadores

- `GET /api/shifts`: devuelve los turnos publicados desde PostgreSQL.
- `GET /api/shifts/events`: stream público de Server-Sent Events (SSE).
- `POST /api/shifts/:id/applications`: crea una postulación autenticada. Si el turno tiene preguntas de filtro, recibe todas las respuestas en `answers`.

```json
{
  "answers": [
    {
      "question": "¿Tienes disponibilidad durante todo el horario indicado?",
      "answer": "Sí, tengo disponibilidad completa."
    }
  ]
}
```

La pregunta debe coincidir con la publicada y cada respuesta admite hasta 1000 caracteres. El API rechaza respuestas faltantes, duplicadas o ajenas al turno.

Rutas operativas autenticadas del trabajador:

- `GET /api/workers/applications`: incluye asignación persistida y `nextAction` con actor, código y texto explicativo.
- `POST /api/shifts/:id/confirm`: confirma la asignación antes del ingreso.
- `POST /api/shifts/:id/check-in`: exige confirmación y la credencial temporal vigente.
- `POST /api/shifts/:id/check-out`: exige check-in y completa solo la asignación del trabajador. El turno completo se cierra cuando terminan todos sus cupos.
- `POST /api/shifts/:id/cancel`: permite cancelar antes del check-in y conserva motivo, actor y fecha.

La empresa recibe el mismo `nextAction` al consultar `/api/business/shifts/:id/applications`, evitando que web y Flutter calculen reglas contradictorias.

El endpoint histórico `PUT /api/shifts/:id/accept` solo se conserva para la demostración en memoria. En modo persistente responde `410 DIRECT_ASSIGNMENT_DISABLED`; toda asignación real debe originarse en una postulación revisada por la empresa.

El stream envía eventos `shifts` con una fotografía completa de las oportunidades vigentes. Flutter mantiene la conexión abierta, actualiza la lista sin recargar y vuelve a conectarse automáticamente si se interrumpe la red.

```text
event: shifts
data: [{"id":"...","role":"Mozo de salón",...}]
```

## Trabajadores del directorio

- `GET /api/business/workers`
- `POST /api/business/workers`
- `GET /api/business/workers/:id`
- `PATCH /api/business/workers/:id`
- `DELETE /api/business/workers/:id`

El registro incluye contacto, rol, habilidades, disponibilidad, verificación, índice CUMPLE, compatibilidad y turnos completados.

Estados: `AVAILABLE`, `ON_SHIFT`, `UNAVAILABLE`.

## Conversaciones y mensajes

- `GET /api/business/conversations`
- `POST /api/business/conversations`
- `GET /api/business/conversations/:id`
- `PATCH /api/business/conversations/:id`
- `DELETE /api/business/conversations/:id`
- `POST /api/business/conversations/:id/messages`
- `PATCH /api/business/conversations/:id/messages/:messageId`
- `DELETE /api/business/conversations/:id/messages/:messageId`

Una conversación pertenece a un trabajador del directorio y puede asociarse a un turno. La empresa solo puede editar o eliminar mensajes cuyo remitente sea `BUSINESS`.

## Pagos y movimientos

- `GET /api/business/payments`
- `POST /api/business/payments`
- `GET /api/business/payments/:id`
- `PATCH /api/business/payments/:id`
- `DELETE /api/business/payments/:id`

Los montos se reciben en céntimos mediante `amountCents` para evitar errores de punto flotante.

Estados: `PENDING`, `SCHEDULED`, `PROCESSED`, `CANCELLED`.

## Respuestas de error

- `400 INVALID_INPUT`: payload o regla de negocio inválida.
- `401 INVALID_SESSION`: token ausente, inválido o vencido.
- `403 BUSINESS_ACCOUNT_REQUIRED`: la sesión no corresponde a una empresa.
- `403 MESSAGE_NOT_OWNED`: intento de modificar un mensaje del trabajador.
- `404 *_NOT_FOUND`: el recurso no existe o pertenece a otra empresa.
- `409 DUPLICATE_RECORD`: correo, referencia u otro campo único duplicado.
