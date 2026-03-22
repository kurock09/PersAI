# ADR-005: Docs and session discipline

## Status
Accepted

## Context
The project must preserve context across Cursor sessions.

## Decision
Living docs are mandatory.
Startup reading order is fixed.
Any architecture change requires ADR.
Every session must update changelog and session handoff.

## Consequences
### Positive
- Reduces drift and session-level hallucination.
- Keeps decisions explicit.

### Negative
- More process overhead per change.