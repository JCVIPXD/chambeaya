# Cumple Now Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear una estructura inicial ejecutable para la app móvil, panel web, API y base de datos de Cumple Now.

**Architecture:** Monorepo npm con Expo para móvil, Next.js para web, Express para API y PostgreSQL/Prisma para persistencia. Docker Compose orquesta API, web y base de datos; Expo se ejecuta fuera de Docker.

**Tech Stack:** TypeScript, React Native/Expo, Next.js, Express, Prisma, PostgreSQL 16 y Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-20-cumple-now-foundation-design.md`

## Global Constraints

- La experiencia principal es una app Android/iOS.
- El panel web complementa a la empresa.
- Docker ejecuta API, web y PostgreSQL; no se usa para el cliente Expo.

---

### Task 1: Configuración de monorepo y Docker

**Files:**
- Create: `package.json`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `README.md`

- [ ] Crear los manifiestos npm y comandos de desarrollo por aplicación.
- [ ] Configurar Docker Compose con PostgreSQL 16, API y panel web.
- [ ] Documentar los requisitos y comandos de arranque.

### Task 2: Esqueleto de aplicaciones y contratos

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/web/package.json`
- Create: `apps/api/package.json`
- Create: `apps/api/prisma/schema.prisma`
- Create: `packages/shared/src/index.ts`

- [ ] Crear directorios para pantallas, componentes, módulos, servicios y pruebas.
- [ ] Definir los roles y estados básicos compartidos.
- [ ] Definir modelos iniciales `User` y `Shift` en Prisma.

