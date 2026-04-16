export const PROMPT_TEMPLATE_REPOSITORY = Symbol("PROMPT_TEMPLATE_REPOSITORY");

export interface PromptTemplate {
  id: string;
  template: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface PromptTemplateRepository {
  findAll(): Promise<PromptTemplate[]>;
  findById(id: string): Promise<PromptTemplate | null>;
  update(id: string, template: string): Promise<PromptTemplate>;
  upsert(id: string, template: string): Promise<PromptTemplate>;
}
