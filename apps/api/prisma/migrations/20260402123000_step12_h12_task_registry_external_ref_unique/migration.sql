CREATE UNIQUE INDEX "assistant_task_registry_items_assistant_id_external_ref_key"
ON "assistant_task_registry_items"("assistant_id", "external_ref");
