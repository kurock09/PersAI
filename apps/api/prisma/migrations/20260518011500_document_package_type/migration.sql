-- ADR-097 follow-up: allow document package catalog items and grants
ALTER TYPE "MediaPackageType" ADD VALUE IF NOT EXISTS 'document';
