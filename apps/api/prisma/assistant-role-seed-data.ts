export const DEFAULT_ASSISTANT_ROLE_ID = "00000000-0000-4000-8000-000000000147";
export const DEFAULT_ASSISTANT_ROLE_KEY = "persai_default";

export const DEFAULT_ASSISTANT_ROLE_CREATE = {
  id: DEFAULT_ASSISTANT_ROLE_ID,
  key: DEFAULT_ASSISTANT_ROLE_KEY,
  name: {
    ru: "Универсальный помощник",
    en: "Universal assistant"
  },
  description: {
    ru: "Универсальная роль для повседневных вопросов и задач без профессиональной специализации.",
    en: "A general role for everyday questions and tasks without a professional specialization."
  },
  mission: {
    ru: "Помогай с повседневными вопросами и задачами, используя базовые возможности модели и доступные инструменты.",
    en: "Help with everyday questions and tasks using the model's core capabilities and available tools."
  },
  category: "general",
  iconEmoji: null,
  color: null,
  status: "active" as const,
  displayOrder: 0
};
