# ADR-126 v3 — GCS legacy wipe runbook (dev + prod)

**Purpose.** Wipe the legacy `<fileRef>`-shaped object layout (v1 / v2 — `assistant_files`-keyed blobs at `assistant-media/uploads/...`, `assistant-media/generated/...`, `assistant-media/<uuid>.<ext>`, `assistant-media/assistants/<aid>/chats/...`, `assistant-media/assistants/<aid>/runtime-output/...`) before the first v3 image lands in production. The operational bucket prefix `PERSAI_MEDIA_OBJECT_PREFIX` (default `"assistant-media"`) is **deploy config**, not file identity — see ADR-126 v3 "Amendment 2026-06-24 (post-Closure)" for the formal clarification. v3 production code writes to two well-defined sub-prefixes **under that operational prefix**:

- `<prefix>/workspaces/<workspaceId>/shared/…` (v3 shared-files mirror, produced by `SandboxObjectStorageService.buildSharedObjectKey` and `PersaiMediaObjectStorageService.buildSharedObjectKey`)
- `<prefix>/assistants/<assistantId>/sandbox-sessions/<sessionId>/workspace.tar` (sandbox session-snapshot tar, produced by `SandboxObjectStorageService.buildSessionSnapshotKey`)

Everything else under `<prefix>/` is **legacy `<fileRef>`-shape** — produced by the retired `AssistantFile` registry. The founder approved a clean wipe of the whole `<prefix>/` subtree (`Dev и prod оба выпиляем — v3 чистый reset, legacy attachments не нужны`); v3 will rebuild its two sub-prefixes from scratch on first use. Operators who prefer a surgical wipe (preserve v3 sub-trees, delete only the `<fileRef>`-shape) can swap Section 2/3 for the surgical sequence in Section 2b below.

**Pre-conditions.**

1. v3 DB migrations applied (`20260623230000_adr126_v3_drop_assistant_files_and_path_identity` + `20260624120000_adr126_v3_thumbnail_path_identity`). The first migration already NULL'd `assistant_chat_message_attachments.storage_path` for any row whose legacy `storage_path LIKE 'assistant-media/%'` and flipped its `processing_status` to `unavailable`, so no DB row will point at the wiped objects after this runbook runs.
2. v3 API + runtime + sandbox + web images are pinned and live on the target cluster — no v1/v2 service is still writing legacy objects into the same bucket.
3. Operator has IAM `storage.objectAdmin` on the target bucket (`gs://persai-dev-workspaces` for dev; whatever `PERSAI_MEDIA_BUCKET_NAME` resolves to in prod env).

**Order of operations.**

Always: dev first → validate v3 functionally on dev → only then run the prod sequence. Do NOT batch both clusters into a single shell session.

---

## 1. Inventory before wipe (dry-run)

Confirm scale and confirm the only sub-prefixes you expect to keep are absent or empty (since v3 just deployed, both should be near-empty):

```bash
# Total objects under the assistant-media/ root
gcloud storage du -s gs://persai-dev-workspaces/assistant-media/

# v3 sub-prefixes you would PRESERVE if the wipe was selective.
# Expected to be tiny or empty right after the v3 cutover.
gcloud storage du -s gs://persai-dev-workspaces/assistant-media/workspaces/
gcloud storage du -s gs://persai-dev-workspaces/assistant-media/assistants/

# Everything not under the two v3 sub-prefixes is legacy.
gcloud storage ls gs://persai-dev-workspaces/assistant-media/ \
  | grep -v -E "/(workspaces|assistants)/$"
```

If the "legacy" listing is empty AND total object count is small, you can skip to Section 4 (snapshot tar drop is still useful so v3 starts from a clean snapshot cache).

---

## 2. Wipe — dev

```bash
# Hard wipe of the entire assistant-media subtree.
# -m parallelizes; -r recurses; -f keeps going on missing objects.
gcloud storage rm -r -f --quiet gs://persai-dev-workspaces/assistant-media/ \
  2>&1 | tee /tmp/adr126-v3-wipe-dev-$(date +%Y%m%d-%H%M%S).log
```

Verify empty:

```bash
gcloud storage ls gs://persai-dev-workspaces/assistant-media/ \
  || echo "OK: prefix is now absent (404 expected)"
```

---

## 2b. Surgical wipe — preserve v3 sub-trees (optional alternative to Section 2 / 3)

Run this only if the operator has decided NOT to do the full prefix wipe (e.g. dev validation has already accumulated meaningful v3 fixtures, or prod must preserve already-published v3 attachments). The sequence keeps `<prefix>/workspaces/` and `<prefix>/assistants/<aid>/sandbox-sessions/` intact and wipes only the legacy `<fileRef>`-shaped sub-paths.

```bash
PREFIX="${PERSAI_MEDIA_OBJECT_PREFIX:-assistant-media}"
BUCKET="<TARGET_BUCKET>"            # gs://persai-dev-workspaces for dev; PROD bucket for prod

# Legacy roots (created by retired AssistantFile registry).
gcloud storage rm -r -f --quiet "gs://${BUCKET}/${PREFIX}/uploads/"     || true
gcloud storage rm -r -f --quiet "gs://${BUCKET}/${PREFIX}/generated/"   || true
gcloud storage rm -r -f --quiet "gs://${BUCKET}/${PREFIX}/telegram/"    || true

# Legacy per-assistant non-sandbox subtrees. Iterate over assistants and remove
# everything that is NOT under sandbox-sessions/ or sandbox/ (v3 keeps both).
for aid in $(gcloud storage ls "gs://${BUCKET}/${PREFIX}/assistants/" | sed 's|.*/||;s|/$||'); do
  for sub in $(gcloud storage ls "gs://${BUCKET}/${PREFIX}/assistants/${aid}/" \
    | sed 's|.*/||;s|/$||' \
    | grep -v -E "^(sandbox-sessions|sandbox)$"); do
    gcloud storage rm -r -f --quiet "gs://${BUCKET}/${PREFIX}/assistants/${aid}/${sub}/" || true
  done
done

# Bucket-root legacy objects (one-shot blobs created with random UUID names).
gcloud storage ls "gs://${BUCKET}/${PREFIX}/" \
  | grep -v -E "/(workspaces|assistants)/$" \
  | xargs -r -I {} gcloud storage rm -f --quiet {}
```

Verify the v3 subtrees are still present:

```bash
gcloud storage du -s "gs://${BUCKET}/${PREFIX}/workspaces/"
gcloud storage du -s "gs://${BUCKET}/${PREFIX}/assistants/" \
  | grep -E "sandbox(-sessions)?"
```

---

## 3. Wipe — prod

Replace `<PROD_BUCKET>` with whatever `PERSAI_MEDIA_BUCKET_NAME` is in the prod Helm values (it is empty in `infra/helm/values.yaml` and is set per environment).

```bash
PROD_BUCKET="<PROD_BUCKET>"

# Safety: print the resolved bucket and require interactive confirmation
echo "About to wipe gs://${PROD_BUCKET}/assistant-media/ — type YES to continue:"
read -r CONFIRM
test "$CONFIRM" = "YES" || { echo "aborted"; exit 1; }

gcloud storage rm -r -f --quiet "gs://${PROD_BUCKET}/assistant-media/" \
  2>&1 | tee /tmp/adr126-v3-wipe-prod-$(date +%Y%m%d-%H%M%S).log

gcloud storage ls "gs://${PROD_BUCKET}/assistant-media/" \
  || echo "OK: prefix is now absent on prod (404 expected)"
```

---

## 4. Post-wipe validation

1. **DB side.** Confirm no rows still point at the wiped subtree:

   ```sql
   SELECT COUNT(*) AS legacy_rows
   FROM assistant_chat_message_attachments
   WHERE storage_path LIKE 'assistant-media/%';
   -- expected: 0  (W1 migration already nulled these)

   SELECT COUNT(*) AS unavailable_rows
   FROM assistant_chat_message_attachments
   WHERE processing_status = 'unavailable';
   -- expected: matches the count W1 migration reported in its run log
   ```

2. **Sandbox side.** First v3 session that runs after the wipe must:
   - Cold-pull `/shared/<wsid>/input/…` from GCS — list returns empty, pod starts clean.
   - Create `assistant-media/workspaces/<wsid>/shared/outbound/<handle>/` on first outbound write.
   - Create `assistant-media/assistants/<aid>/sandbox-sessions/<sessionId>/workspace.tar` on first job that saves a snapshot.

3. **Web side.** Any historical message whose attachment was nulled by W1 shows the "unavailable" placeholder (existing UI state); no broken thumbnails.

---

## 5. Rollback / restore note

There is **no rollback path** for this wipe. The legacy `assistant-media/` objects were keyed by `fileRef` UUIDs that no longer exist in any schema. Once `gcloud storage rm -r` returns, the bytes are gone. Soft-delete on the bucket (if enabled) is the only recovery surface; if soft-delete is OFF (default on `persai-dev-workspaces`), the wipe is permanent.

If a production catastrophe surfaces (founder observes a critical legacy attachment is missing), the v1/v2 attachments are not recoverable from this bucket — restore from the parallel backup bucket if one exists, or accept the loss. The founder explicitly accepted "no commercial users yet" as the rationale for choosing the wipe over a selective migration.

---

## 6. Cross-references

- ADR text: `docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md` (v3)
- v3 cutover program: `docs/ADR/126-v3-CUTOVER-PROGRAM.md`
- W1 migration: `apps/api/prisma/migrations/20260623230000_adr126_v3_drop_assistant_files_and_path_identity/migration.sql`
- W4.5 thumbnail/poster migration: `apps/api/prisma/migrations/20260624120000_adr126_v3_thumbnail_path_identity/migration.sql`
- Object-storage truth: `apps/sandbox/src/sandbox-object-storage.service.ts` (`buildSharedObjectKey`, `buildSharedPrefix`, `buildSnapshotObjectKey`)
