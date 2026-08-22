# Cumple Now Foundation Design

## Objetivo

Preparar un monorepo para una plataforma de empleos temporales con app móvil como experiencia principal y panel web complementario para empresas.

## Arquitectura

`apps/mobile` contiene la app React Native/Expo para trabajadores y empresas en movilidad. `apps/web` contiene el panel Next.js para gestión empresarial. `apps/api` expone una API Express y gestiona PostgreSQL mediante Prisma. Los contratos mínimos se comparten desde `packages/shared`.

## Alcance de esta entrega

Se crean carpetas, manifiestos de paquetes, configuración TypeScript, esquema inicial de Prisma y Docker Compose. No se implementan autenticación, pantallas, turnos, QR ni pagos en esta entrega.

## Decisión Docker

Docker Compose ejecuta PostgreSQL, API y panel web. Expo se inicia directamente en Windows para permitir que un teléfono físico o emulador acceda al servidor Metro.

