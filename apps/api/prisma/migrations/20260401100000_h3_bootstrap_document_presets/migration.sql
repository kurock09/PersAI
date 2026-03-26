-- H3.3: Admin-editable bootstrap document presets (SOUL, USER, IDENTITY, AGENTS)
CREATE TABLE "bootstrap_document_presets" (
    "id"         VARCHAR(32)  NOT NULL,
    "template"   TEXT         NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "bootstrap_document_presets_pkey" PRIMARY KEY ("id")
);
