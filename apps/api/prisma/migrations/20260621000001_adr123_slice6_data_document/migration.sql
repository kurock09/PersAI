-- ADR-123 Slice 6: Add data_document type, create_data_document descriptor mode, xlsx/docx output formats
ALTER TYPE "AssistantDocumentType" ADD VALUE 'data_document';
ALTER TYPE "AssistantDocumentDescriptorMode" ADD VALUE 'create_data_document';
ALTER TYPE "AssistantDocumentOutputFormat" ADD VALUE 'xlsx';
ALTER TYPE "AssistantDocumentOutputFormat" ADD VALUE 'docx';
