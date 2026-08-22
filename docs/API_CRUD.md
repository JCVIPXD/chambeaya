# API CRUD empresarial

## Autenticación

Todas las rutas bajo `/api/business` requieren una sesión válida de tipo `BUSINESS`:

```http
Authorization: Bearer <token>
```

El API obtiene el propietario desde la sesión. No acepta un `companyId` enviado por el cliente, evitando que una empresa acceda a registros de otra.

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
  "confirmedWorkers": 0,
  "notes": "Ingreso por puerta de personal"
}
```

Estados: `PUBLISHED`, `ASSIGNED`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`.

Cada creación, edición o eliminación de un turno notifica inmediatamente al feed del marketplace. Solo los turnos `PUBLISHED` que todavía no finalizaron aparecen para trabajadores.

## Marketplace para trabajadores

- `GET /api/shifts`: devuelve los turnos publicados desde PostgreSQL.
- `GET /api/shifts/events`: stream público de Server-Sent Events (SSE).

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
