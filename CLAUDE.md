# Flujo de trabajo de agentes

- Usa solamente los agentes `implementador-sonnet`, `auditor-opus` y `planificador-opus` (definidos en `.claude/agents/`). No crear agentes adicionales sin autorización explícita del usuario.
- Ejecuta `implementador-sonnet` (modelo Sonnet 5) para análisis de alcance, código, pruebas y correcciones.
- Ejecuta `auditor-opus` (modelo Opus) después de cada implementación terminada, y para revisar/actualizar la documentación de `docs/`.
- Ejecuta `planificador-opus` (modelo Opus) **solo cuando el usuario lo ordena explícitamente**, para convertir un objetivo en uno o más alcances que `implementador-sonnet` seguirá. No se invoca automáticamente como parte del ciclo normal. Sus planes se escriben en `.claude/plans/`, nunca en `docs/`.
- Trabaja en secuencia: (opcional) Planificador propone alcance; Sonnet implementa y registra; Opus audita y documenta; Sonnet corrige si es necesario; Opus reaudita.
- `docs/PROGRESO.md` es el único registro operativo vigente. No crees diarios, bitácoras ni archivos de avance adicionales.
- Registra únicamente hitos terminados: una implementación validada o una auditoría concluida. No registres actividad parcial.
- Cada entrada es inmutable y debe incluir ID, fecha, agente, tipo, estado, alcance, archivos, decisiones, validaciones, riesgos y siguiente paso.
- Las entradas nuevas se agregan al inicio de la sección `Registro`, sin reescribir el historial.
- Un cambio solo queda cerrado cuando la auditoría más reciente tiene estado `APROBADO` y referencia su implementación o corrección.
- Si una validación no pudo ejecutarse, declárala como riesgo; nunca la presentes como aprobada.
- `docs/README.md` define el orden y las convenciones vigentes de la documentación (`guides/`, `reference/`, `product/`); síguelo al leer o actualizar `docs/`.

Nota histórica: este proyecto usó antes un flujo equivalente en Cursor/Codex
(`.cursor/agents/implementador-terra.md`, `.cursor/agents/auditor-sol.md`,
`.cursor/rules/flujo-dos-agentes.mdc`, modelos `gpt-5.6-terra`/`gpt-5.6-sol`).
Esos archivos se conservan como referencia histórica pero ya no son el flujo
vigente; el flujo vigente es el de este archivo.
