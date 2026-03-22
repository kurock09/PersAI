# ARCHITECTURE

## Architecture style
Modular monolith for apps/api, with strict module and layer boundaries.

## Repo structure
- apps/web
- apps/api
- services/openclaw
- packages/*
- infra
- docs

## Backend modules
- identity-access
- workspace-management
- platform-core

## Backend layers
- domain
- application
- infrastructure
- interface

## OpenClaw boundary
OpenClaw is a neighboring service in services/openclaw.
It is not part of the foundation runtime and not part of backend domain logic.

## Frontend/backend boundary
- contracts-first
- no scattered raw fetch
- typed client only