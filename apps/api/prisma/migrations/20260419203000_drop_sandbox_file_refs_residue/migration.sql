-- Remove sandbox-era file ref residue now that AssistantFile is the only live file registry.

DROP TABLE IF EXISTS "sandbox_file_refs";
