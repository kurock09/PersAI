import { Injectable } from "@nestjs/common";
import { DocumentExtractionService } from "./document-extraction.service";
import type {
  KnowledgeDocumentProcessingInput,
  KnowledgeDocumentProcessingResult,
  KnowledgeDocumentProcessor
} from "./knowledge-processing.types";

@Injectable()
export class KnowledgeDocumentProcessorService implements KnowledgeDocumentProcessor {
  constructor(private readonly documentExtractionService: DocumentExtractionService) {}

  async process(
    input: KnowledgeDocumentProcessingInput
  ): Promise<KnowledgeDocumentProcessingResult> {
    return this.documentExtractionService.extract(input);
  }
}
