# Documentación de Chambeaya

Este índice contiene únicamente la documentación vigente. Empieza por la guía
que corresponda a tu objetivo y evita crear documentos nuevos en la raíz de
`docs/`.

## Guías de uso y operación

- [Desarrollo local](guides/local-development.md): requisitos, arranque de los
  tres componentes, datos de demo y dispositivos Flutter.
- [Demostración para clientes](guides/client-demo.md): preparación, cuentas y
  recorrido reproducible de los tres roles.
- [Despliegue con Docker](guides/deployment.md): instalación y actualización en
  un VPS u hosting compatible.

## Referencia técnica

- [API y reglas operativas](reference/api.md): autenticación, endpoints,
  estados de turnos y respuestas de error.
- [Pruebas end-to-end del panel](../apps/web/e2e/README.md): instalación,
  alcance y diagnóstico de Playwright. Cubre la suite rápida con API simulada y
  la suite opcional `apps/web/e2e-real/`, que corre contra la API, la base de
  datos y el panel reales.

## Producto y seguimiento

- [Plan maestro de pendientes](product/project-master-plan.md): inventario técnico
  priorizado para pasar de la versión híbrida actual a un piloto real.
- [Hoja de ruta](product/roadmap.md): principios, fases y decisiones de
  producto vigentes.
- [Hipótesis de membresías](product/memberships.md): propuesta comercial para
  validar durante el piloto; no es una oferta pública.
- [Perfil de talento e integraciones](product/talent-profile-rollout.md):
  perfil real, búsqueda y pasos diferidos para Google, CV y reseñas.
- [Progreso operativo](PROGRESO.md): único registro de cierres, validaciones y
  auditorías.

## Archivo

Los documentos en [archive/](archive/README.md) se conservan como evidencia o
contexto histórico. No describen necesariamente el comportamiento actual y no
deben actualizarse para documentar trabajo nuevo.

## Convenciones

- Una guía vigente debe estar enlazada desde este índice y vivir en la categoría
  que le corresponda (`guides`, `reference` o `product`).
- Usa nombres de archivo en minúsculas y `kebab-case`.
- Actualiza la guía o referencia afectada dentro del mismo cambio que modifica
  un comportamiento visible, contrato o procedimiento.
- Registra únicamente cierres verificables en `PROGRESO.md`; los planes y notas
  de investigación no van allí.
