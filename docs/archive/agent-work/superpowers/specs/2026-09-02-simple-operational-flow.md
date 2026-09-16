# CumpleNow — flujo operativo simple

## Objetivo

CumpleNow debe sentirse como una lista corta de pasos que se repite para cada
turno. La interfaz muestra el estado actual y una sola siguiente acción. Las
excepciones se resuelven desde ese mismo turno y no crean un flujo alterno.

La propuesta de producto para el piloto es:

> CumpleNow ayuda a cubrir, coordinar y cerrar turnos con evidencia. La empresa
> contrata y paga al trabajador; CumpleNow registra el proceso.

## Roles y responsabilidad

- La empresa publica el turno, define condiciones, elige postulantes, valida la
  asistencia y reporta el pago.
- El trabajador busca, postula, confirma su asistencia, registra llegada y
  salida, y revisa el estado del pago.
- CumpleNow coordina, notifica y conserva el historial. No custodia fondos ni
  promete retiros durante el piloto.

## Flujo del trabajador

1. **Buscar**: consultar turnos por cargo, distrito, fecha y pago.
2. **Revisar**: ver horario, sede, tareas, requisitos, cupos y pago antes de
   postular.
3. **Postular**: responder las preguntas necesarias y enviar una única
   postulación.
4. **Confirmar**: cuando la empresa acepta, confirmar que asistirá.
5. **Llegar**: registrar la entrada desde el turno asignado.
6. **Salir**: registrar la salida al terminar.
7. **Revisar pago**: consultar el monto y el comprobante o referencia que la
   empresa haya reportado.

La tarjeta de cada postulación debe mostrar solamente la siguiente acción:

- En revisión → esperar decisión de la empresa.
- Seleccionado → confirmar asistencia.
- Confirmado → registrar llegada.
- En turno → registrar salida.
- Finalizado → revisar pago.

## Flujo de la empresa

1. **Publicar**: completar cargo, horario, sede, cupos, pago y condiciones.
2. **Revisar**: ver postulantes de ese turno en una sola lista.
3. **Aceptar**: asignar el cupo disponible o rechazar explicando el cierre.
4. **Confirmar cobertura**: comprobar quién mantiene su asistencia antes del
   inicio.
5. **Validar asistencia**: revisar llegada, salida e incidencias.
6. **Reportar pago**: marcar el pago directo al trabajador y adjuntar una
   referencia o comprobante.

La vista del turno debe ordenar las acciones en ese mismo orden. Las métricas y
los mensajes son apoyo, no pasos adicionales.

## Asistencia y QR

Durante el primer piloto se puede confirmar la llegada manualmente desde la
lista de asignados. Cuando exista volumen suficiente, se habilitará un único
patrón de QR:

- la sede muestra un QR temporal del turno;
- el trabajador escanea el QR desde su turno;
- el servidor valida asignación, sede, ventana horaria y duplicados;
- el mismo patrón se repite para la salida;
- existe un código corto de respaldo cuando no se puede escanear.

El trabajador nunca escanea el QR de otra persona ni necesita mostrar un QR
personal para registrar asistencia.

## Pagos y vocabulario

El pago del servicio lo realiza directamente la empresa al trabajador. La app
usa estos estados:

- **Pendiente de pago**: el turno terminó, pero la empresa aún no registra el
  pago.
- **Pago reportado**: la empresa indicó que pagó y guardó una referencia.
- **Incidencia de pago**: existe una diferencia o falta de comprobante.

Se evita en el flujo principal el vocabulario “billetera”, “saldo disponible”,
“retiro”, “desembolso” y “pago liberado”.

## Excepciones

- **Cancelación antes de iniciar**: motivo obligatorio y liberación del cupo.
- **Ausencia**: la empresa registra el hecho desde el turno y puede iniciar un
  reemplazo manual.
- **Salida anticipada o diferencia de horas**: se marca una incidencia para que
  la empresa la revise antes de reportar el pago.
- **Fallo de QR o conexión**: código corto o confirmación manual, conservando
  quién confirmó y cuándo.

## Monetización del piloto

- Trabajador: acceso gratuito.
- Empresa: comisión visible por turno completado, inicialmente como hipótesis
  de prueba del 12 % sobre el pago del trabajador.
- Sin comisión por publicar, recibir postulaciones o cancelar antes de asignar.
- Suscripción posterior únicamente para beneficios operativos: varias sedes,
  usuarios, plantillas, recordatorios, reemplazos prioritarios, métricas,
  exportación y soporte.

La comisión y el precio de suscripción se validan con empresas piloto; no se
presentan como definitivos en la interfaz.

## Criterio de diseño

Cada pantalla debe responder tres preguntas:

1. ¿En qué paso estoy?
2. ¿Qué debe ocurrir ahora?
3. ¿Qué pasa si algo sale mal?

Si una función no ayuda a responder una de esas preguntas, debe vivir fuera del
flujo principal o quedar desactivada hasta que exista una implementación real.
