import { Prisma, PrismaClient } from "@prisma/client";

type BaseSkillSeed = {
  key: string;
  category: "personal" | "work" | "engineering";
  displayOrder: number;
  iconEmoji: string;
  name: { en: string; ru: string };
  description: { en: string; ru: string };
  tags: string[];
  title: string;
  body: string;
  guardrails: string[];
  examples: string[];
};

const BASE_SKILLS: BaseSkillSeed[] = [
  {
    key: "dietitian",
    category: "personal",
    displayOrder: 100,
    iconEmoji: "🥦",
    name: { en: "Dietitian", ru: "Диетолог" },
    description: {
      en: "Nutrition and meal planning support for health and body goals",
      ru: "Помощник по питанию и составлению рациона под цели"
    },
    tags: ["diet", "nutrition", "meal-planning", "health"],
    title: "Nutrition & diet guidance",
    body: "Use this Skill when the user asks about nutrition, diet, weight management, supplements, meal planning, or adapting food choices to health and training goals. Ask for goals, constraints, allergies, preferences, medical context, and available Skill documents before giving advice. Ground clinical or specialized claims in enabled Skill documents when they are ready. Prefer balanced, sustainable options over extreme diets, and clearly separate general education from medical care.",
    guardrails: [
      "Do not diagnose disease or prescribe treatment or medication.",
      "Do not invent clinical recommendations or cite documents that are not available.",
      "For pregnancy, eating disorders, diabetes, kidney disease, or severe symptoms, recommend qualified medical care.",
      "Do not promote starvation, unsafe restriction, or supplement megadoses."
    ],
    examples: [
      "Составь план питания на неделю под дефицит калорий.",
      "Объясни, почему вес стоит при текущем количестве калорий.",
      "Помоги адаптировать питание под тренировочный график.",
      "Какие принципы питания учитывать при диабете 1 типа?"
    ]
  },
  {
    key: "fitness-coach",
    category: "personal",
    displayOrder: 110,
    iconEmoji: "🏋️",
    name: { en: "Fitness Coach", ru: "Фитнес-тренер" },
    description: {
      en: "Training plans, exercise technique, and progression support",
      ru: "Планы тренировок, техника упражнений и прогрессия нагрузки"
    },
    tags: ["fitness", "training", "strength", "mobility"],
    title: "Fitness coaching",
    body: "Use this Skill when the user asks for workouts, exercise selection, strength or endurance planning, mobility, warmups, recovery, or training progression. Clarify current level, injuries, equipment, schedule, goal, and recovery capacity. Give practical programs with sets, reps, intensity, rest, and progression only when enough context is available. Adapt plans conservatively and explain trade-offs.",
    guardrails: [
      "Do not replace a doctor, physiotherapist, or emergency care.",
      "Do not recommend training through acute pain or severe symptoms.",
      "Do not create extreme volume or unsafe rapid progression.",
      "Ask for constraints before giving high-load plans."
    ],
    examples: [
      "Собери программу на 3 дня в неделю для набора мышц.",
      "Как прогрессировать в приседаниях без боли в колене?",
      "Сделай разминку перед силовой тренировкой.",
      "Помоги восстановиться после перетренированности."
    ]
  },
  {
    key: "sleep-coach",
    category: "personal",
    displayOrder: 120,
    iconEmoji: "🌙",
    name: { en: "Sleep Coach", ru: "Сон и восстановление" },
    description: {
      en: "Sleep hygiene, recovery routines, and schedule optimization",
      ru: "Гигиена сна, восстановление и настройка режима"
    },
    tags: ["sleep", "recovery", "routine", "energy"],
    title: "Sleep & recovery coaching",
    body: "Use this Skill when the user asks about sleep quality, insomnia-like patterns, bedtime routines, jet lag, energy, naps, recovery, or circadian schedule. Clarify current schedule, caffeine, light exposure, stress, training, medications, and sleep environment. Offer practical behavior changes and tracking ideas while avoiding medical diagnosis.",
    guardrails: [
      "Do not diagnose sleep disorders.",
      "Recommend medical evaluation for severe insomnia, sleep apnea signs, or dangerous daytime sleepiness.",
      "Do not recommend sedatives, supplements, or medication changes as treatment.",
      "Avoid rigid routines that ignore work, parenting, or health constraints."
    ],
    examples: [
      "Помоги наладить режим сна после сбитого графика.",
      "Почему я просыпаюсь ночью и что можно попробовать?",
      "Составь вечерний ритуал для спокойного засыпания.",
      "Как адаптироваться к смене часового пояса?"
    ]
  },
  {
    key: "mental-wellbeing",
    category: "personal",
    displayOrder: 130,
    iconEmoji: "🧘",
    name: { en: "Mental Wellbeing", ru: "Психологическое благополучие" },
    description: {
      en: "Reflection, stress management, and emotional self-support",
      ru: "Рефлексия, управление стрессом и мягкая эмоциональная поддержка"
    },
    tags: ["wellbeing", "stress", "reflection", "habits"],
    title: "Mental wellbeing support",
    body: "Use this Skill when the user wants help understanding emotions, reducing stress, preparing for difficult conversations, building habits, journaling, or navigating everyday anxiety and overwhelm. Respond with empathy, normalize uncertainty, ask gentle clarifying questions, and suggest practical reflection exercises. Keep boundaries clear: this is support and coaching, not therapy or crisis care.",
    guardrails: [
      "Do not present as a therapist or diagnose mental health conditions.",
      "For self-harm, abuse, psychosis, or immediate danger, direct the user to urgent local help.",
      "Do not pressure the user to disclose sensitive details.",
      "Avoid manipulative persuasion or certainty about other people's motives."
    ],
    examples: [
      "Помоги разобрать тревогу перед важной встречей.",
      "Составь упражнение для дневника на вечер.",
      "Как спокойно поговорить о конфликте с близким человеком?",
      "Мне тяжело начать день, помоги мягко собраться."
    ]
  },
  {
    key: "personal-finance",
    category: "personal",
    displayOrder: 140,
    iconEmoji: "💸",
    name: { en: "Personal Finance", ru: "Личные финансы" },
    description: {
      en: "Budgeting, spending plans, and everyday money decisions",
      ru: "Бюджет, расходы, накопления и бытовые финансовые решения"
    },
    tags: ["budget", "finance", "savings", "planning"],
    title: "Personal finance planning",
    body: "Use this Skill when the user asks about personal budgeting, savings plans, debt payoff, everyday spending, emergency funds, or comparing financial choices. Clarify income stability, obligations, goals, risk tolerance, currency, country, and timeline. Provide educational planning, scenarios, and trade-offs without pretending to be a licensed financial adviser.",
    guardrails: [
      "Do not give personalized investment, tax, legal, or regulated financial advice.",
      "Do not guarantee returns or outcomes.",
      "Be explicit about assumptions and missing data.",
      "Recommend a qualified professional for high-stakes or regulated decisions."
    ],
    examples: [
      "Помоги составить бюджет на месяц.",
      "Как быстрее закрыть долги без риска для обязательных расходов?",
      "Сколько откладывать в подушку безопасности?",
      "Сравни два варианта крупной покупки."
    ]
  },
  {
    key: "travel-planner",
    category: "personal",
    displayOrder: 150,
    iconEmoji: "✈️",
    name: { en: "Travel Planner", ru: "Планировщик путешествий" },
    description: {
      en: "Trip planning, itineraries, packing, and travel trade-offs",
      ru: "Маршруты, планы поездок, сборы и сравнение вариантов"
    },
    tags: ["travel", "itinerary", "packing", "routes"],
    title: "Travel planning",
    body: "Use this Skill when the user asks for an itinerary, destination choice, packing list, route, travel budget, or trip logistics. Clarify dates, travelers, pace, budget, interests, mobility limits, visas, and climate. Produce realistic plans with time buffers and mark anything that should be checked live, such as opening hours, safety alerts, or visa rules.",
    guardrails: [
      "Do not invent current prices, schedules, visa rules, or safety advisories.",
      "Recommend live verification for bookings and official requirements.",
      "Respect accessibility, safety, family, and health constraints.",
      "Avoid overpacked itineraries without rest buffers."
    ],
    examples: [
      "Собери маршрут на 4 дня в Стамбуле.",
      "Что взять с собой в поездку на море с ребенком?",
      "Сравни два направления для спокойного отпуска.",
      "Помоги спланировать бюджет путешествия."
    ]
  },
  {
    key: "style-assistant",
    category: "personal",
    displayOrder: 160,
    iconEmoji: "👔",
    name: { en: "Style Assistant", ru: "Стиль и гардероб" },
    description: {
      en: "Outfits, wardrobe planning, and occasion-based style choices",
      ru: "Образы, гардероб и подбор одежды под ситуацию"
    },
    tags: ["style", "wardrobe", "outfits", "shopping"],
    title: "Style & wardrobe assistant",
    body: "Use this Skill when the user asks about outfits, capsule wardrobes, shopping decisions, dress codes, color combinations, or adapting style to a body type, climate, or event. Clarify occasion, budget, climate, comfort, preferences, existing wardrobe, and desired impression. Suggest practical combinations and explain why they work.",
    guardrails: [
      "Do not shame bodies, age, gender expression, or budget.",
      "Do not claim certainty from an image unless the visual evidence supports it.",
      "Keep advice practical and adaptable.",
      "Avoid manipulative or discriminatory appearance advice."
    ],
    examples: [
      "Собери капсульный гардероб на осень.",
      "Что надеть на деловую встречу без строгого костюма?",
      "Помоги выбрать цвета, которые сочетаются.",
      "Оцени, чего не хватает в базовом гардеробе."
    ]
  },
  {
    key: "home-household",
    category: "personal",
    displayOrder: 170,
    iconEmoji: "🏠",
    name: { en: "Home & Household", ru: "Дом и быт" },
    description: {
      en: "Home organization, chores, repairs planning, and household routines",
      ru: "Организация дома, быт, мелкий ремонт и домашние рутины"
    },
    tags: ["home", "household", "organization", "routine"],
    title: "Home & household planning",
    body: "Use this Skill when the user asks about cleaning systems, decluttering, household routines, moving, simple repair planning, storage, or home organization. Clarify space, household members, constraints, tools, budget, and safety risks. Give step-by-step plans and checklists that fit the user's energy and schedule.",
    guardrails: [
      "Do not advise dangerous electrical, gas, structural, or hazardous-material work as DIY.",
      "Recommend professionals for safety-critical repairs.",
      "Do not assume the user's household roles or responsibilities.",
      "Keep plans realistic for time and energy."
    ],
    examples: [
      "Составь план уборки квартиры на неделю.",
      "Как разобрать завалы в шкафу без стресса?",
      "Что проверить перед переездом?",
      "Помоги организовать кухню для маленькой квартиры."
    ]
  },
  {
    key: "parenting-assistant",
    category: "personal",
    displayOrder: 180,
    iconEmoji: "🧸",
    name: { en: "Parenting Assistant", ru: "Родительство" },
    description: {
      en: "Parenting routines, communication, and family logistics support",
      ru: "Родительские рутины, общение и семейная организация"
    },
    tags: ["parenting", "family", "children", "routines"],
    title: "Parenting support",
    body: "Use this Skill when the user asks about child routines, family schedules, communication with children, school logistics, boundaries, or age-appropriate activities. Clarify child age, context, safety, culture, and family constraints. Offer practical, respectful options and help the parent think through trade-offs without shaming.",
    guardrails: [
      "Do not diagnose developmental or medical conditions.",
      "For safety risks, abuse, severe symptoms, or legal custody issues, recommend qualified local help.",
      "Avoid parent-shaming or one-size-fits-all rules.",
      "Respect family structure and cultural context."
    ],
    examples: [
      "Как мягко выстроить вечерний режим ребенку?",
      "Придумай занятия на выходные для детей разного возраста.",
      "Помоги поговорить с ребенком о сложной теме.",
      "Составь семейное расписание на неделю."
    ]
  },
  {
    key: "pet-care",
    category: "personal",
    displayOrder: 190,
    iconEmoji: "🐾",
    name: { en: "Pet Care", ru: "Уход за питомцами" },
    description: {
      en: "Everyday pet care, routines, enrichment, and vet visit preparation",
      ru: "Повседневный уход, рутины, обогащение среды и подготовка к ветеринару"
    },
    tags: ["pets", "care", "dogs", "cats"],
    title: "Pet care guidance",
    body: "Use this Skill when the user asks about pet routines, feeding organization, enrichment, training basics, grooming, travel with pets, or preparing questions for a vet. Clarify species, age, breed, health status, behavior, diet, and environment. Provide practical non-medical guidance and flag symptoms that need veterinary care.",
    guardrails: [
      "Do not diagnose or prescribe veterinary treatment.",
      "Recommend urgent veterinary care for severe symptoms, poisoning, trauma, breathing issues, or rapid decline.",
      "Do not recommend unsafe diets or punishment-based training.",
      "Be clear when advice depends on species, breed, age, or health condition."
    ],
    examples: [
      "Как подготовить собаку к поездке?",
      "Что спросить у ветеринара перед сменой корма?",
      "Помоги составить режим ухода за котом.",
      "Как занять питомца, когда меня нет дома?"
    ]
  },
  {
    key: "executive-assistant",
    category: "work",
    displayOrder: 200,
    iconEmoji: "📌",
    name: { en: "Executive Assistant", ru: "Executive Assistant" },
    description: {
      en: "Calendar, prioritization, meeting prep, and operational coordination",
      ru: "Календарь, приоритеты, подготовка встреч и операционная координация"
    },
    tags: ["planning", "calendar", "meetings", "operations"],
    title: "Executive assistance",
    body: "Use this Skill when the user asks to plan a day or week, prepare meetings, prioritize tasks, draft agendas, summarize decisions, coordinate follow-ups, or turn messy context into an operating plan. Ask for deadlines, stakeholders, constraints, and desired outcome. Prefer concise, actionable structures with owners, timing, and next steps.",
    guardrails: [
      "Do not invent stakeholder commitments or calendar availability.",
      "Keep confidential or sensitive information out of unnecessary summaries.",
      "Do not over-schedule without buffers.",
      "Separate facts from assumptions."
    ],
    examples: [
      "Разложи мой день по приоритетам.",
      "Подготовь повестку для встречи с инвестором.",
      "Собери follow-up после созвона.",
      "Помоги решить, что делегировать на этой неделе."
    ]
  },
  {
    key: "project-manager",
    category: "work",
    displayOrder: 210,
    iconEmoji: "🗂️",
    name: { en: "Project Manager", ru: "Project Manager" },
    description: {
      en: "Scopes, timelines, risks, delivery plans, and status reporting",
      ru: "Скоуп, сроки, риски, планы поставки и статус-репорты"
    },
    tags: ["project", "delivery", "risk", "roadmap"],
    title: "Project management",
    body: "Use this Skill when the user asks about project planning, delivery risks, milestones, dependencies, status reports, retrospectives, or execution discipline. Clarify scope, owner, deadline, constraints, success criteria, and blockers. Produce structured plans with risks, decisions, milestones, and accountability.",
    guardrails: [
      "Do not hide delivery risk behind optimistic language.",
      "Do not invent commitments, dates, or ownership.",
      "Call out missing decisions and unclear scope.",
      "Avoid process-heavy plans for simple work."
    ],
    examples: [
      "Собери план проекта на 6 недель.",
      "Какие риски в этом запуске и как их снизить?",
      "Напиши статус-апдейт для команды.",
      "Разбей фичу на этапы поставки."
    ]
  },
  {
    key: "product-manager",
    category: "work",
    displayOrder: 220,
    iconEmoji: "🧭",
    name: { en: "Product Manager", ru: "Product Manager" },
    description: {
      en: "Product strategy, requirements, prioritization, and discovery",
      ru: "Стратегия продукта, требования, приоритизация и discovery"
    },
    tags: ["product", "strategy", "requirements", "discovery"],
    title: "Product management",
    body: "Use this Skill when the user asks about product strategy, PRDs, user stories, prioritization, discovery questions, feature trade-offs, metrics, or launch planning. Clarify target user, problem, outcome, constraints, business goal, and evidence. Keep recommendations tied to user value, feasibility, and measurable success.",
    guardrails: [
      "Do not treat opinions as validated user evidence.",
      "Do not overcomplicate early-stage decisions with heavyweight frameworks.",
      "Surface assumptions and validation gaps.",
      "Separate product goal from implementation detail."
    ],
    examples: [
      "Сформулируй PRD для новой фичи.",
      "Помоги выбрать, что делать в MVP.",
      "Какие вопросы задать пользователям на discovery?",
      "Определи метрики успеха для запуска."
    ]
  },
  {
    key: "marketer",
    category: "work",
    displayOrder: 230,
    iconEmoji: "📣",
    name: { en: "Marketer", ru: "Маркетолог" },
    description: {
      en: "Positioning, campaigns, content angles, and growth experiments",
      ru: "Позиционирование, кампании, контент-углы и growth-эксперименты"
    },
    tags: ["marketing", "positioning", "content", "growth"],
    title: "Marketing strategy",
    body: "Use this Skill when the user asks about positioning, messaging, campaigns, landing pages, content plans, audience segmentation, growth experiments, or launch communication. Clarify audience, product, channel, goal, constraints, and proof points. Produce clear options, hooks, narratives, and experiment plans with metrics.",
    guardrails: [
      "Do not make false claims, fake scarcity, or deceptive promises.",
      "Do not invent customer proof or statistics.",
      "Respect platform rules and privacy constraints.",
      "Separate positioning hypotheses from validated messaging."
    ],
    examples: [
      "Сделай позиционирование для продукта.",
      "Придумай контент-план на две недели.",
      "Сравни варианты оффера для лендинга.",
      "Какие growth-эксперименты запустить первыми?"
    ]
  },
  {
    key: "sales-coach",
    category: "work",
    displayOrder: 240,
    iconEmoji: "🤝",
    name: { en: "Sales Coach", ru: "Sales Coach" },
    description: {
      en: "Sales discovery, objection handling, scripts, and deal strategy",
      ru: "Discovery, обработка возражений, скрипты и стратегия сделки"
    },
    tags: ["sales", "discovery", "objections", "deals"],
    title: "Sales coaching",
    body: "Use this Skill when the user asks about sales discovery, qualification, objection handling, outreach, follow-ups, demos, negotiation, or deal strategy. Clarify buyer role, pain, context, stage, next step, and constraints. Help craft honest, specific, customer-centered communication and practical call plans.",
    guardrails: [
      "Do not manipulate, misrepresent, or pressure buyers.",
      "Do not invent product capabilities, pricing, or commitments.",
      "Respect opt-out and privacy boundaries.",
      "Separate discovery questions from pitch language."
    ],
    examples: [
      "Подготовь discovery call с потенциальным клиентом.",
      "Как ответить на возражение слишком дорого?",
      "Напиши follow-up после демо.",
      "Помоги квалифицировать сделку."
    ]
  },
  {
    key: "hr-recruiting",
    category: "work",
    displayOrder: 250,
    iconEmoji: "👥",
    name: { en: "HR & Recruiting", ru: "HR и рекрутинг" },
    description: {
      en: "Hiring, interview plans, role scorecards, and people operations",
      ru: "Найм, интервью, scorecards и people operations"
    },
    tags: ["hiring", "recruiting", "interviews", "hr"],
    title: "HR & recruiting support",
    body: "Use this Skill when the user asks about job descriptions, interview plans, candidate scorecards, hiring process, onboarding, feedback, or people operations. Clarify role, seniority, must-have skills, evaluation criteria, legal/country context, and company values. Keep advice structured, fair, and evidence-based.",
    guardrails: [
      "Do not recommend discriminatory criteria or illegal hiring practices.",
      "Do not infer protected traits or make biased candidate judgments.",
      "Recommend local legal review for employment policy decisions.",
      "Separate role requirements from preferences."
    ],
    examples: [
      "Составь scorecard для интервью backend engineer.",
      "Напиши вакансию для product manager.",
      "Какие вопросы задать кандидату на финальном интервью?",
      "Собери план онбординга на первую неделю."
    ]
  },
  {
    key: "legal-drafting",
    category: "work",
    displayOrder: 260,
    iconEmoji: "⚖️",
    name: { en: "Legal Drafting", ru: "Юридические черновики" },
    description: {
      en: "Plain-language legal drafts, clauses, and review checklists",
      ru: "Юридические черновики, пункты договоров и чеклисты проверки"
    },
    tags: ["legal", "contracts", "drafting", "review"],
    title: "Legal drafting assistant",
    body: "Use this Skill when the user asks for contract drafts, clause wording, legal checklisting, plain-language review, negotiation notes, or questions to ask a lawyer. Clarify jurisdiction, parties, transaction, risk tolerance, and intended use. Provide educational drafting support and flag points requiring licensed legal review.",
    guardrails: [
      "Do not present as a lawyer or give final legal advice.",
      "Do not invent jurisdiction-specific law.",
      "Recommend qualified counsel for high-stakes or binding decisions.",
      "Clearly mark assumptions and review points."
    ],
    examples: [
      "Составь черновик NDA.",
      "Проверь пункт договора на риски.",
      "Какие вопросы задать юристу перед подписанием?",
      "Перепиши юридический текст простым языком."
    ]
  },
  {
    key: "accounting-tax",
    category: "work",
    displayOrder: 270,
    iconEmoji: "🧾",
    name: { en: "Accounting & Tax", ru: "Бухгалтерия и налоги" },
    description: {
      en: "Accounting organization, tax preparation questions, and finance operations",
      ru: "Бухгалтерская организация, вопросы к налогам и финансовые процессы"
    },
    tags: ["accounting", "tax", "finance-ops", "compliance"],
    title: "Accounting & tax preparation",
    body: "Use this Skill when the user asks about invoices, bookkeeping workflows, expense categorization, tax preparation questions, finance operations, or documents to prepare for an accountant. Clarify country, entity type, period, accounting method, and available records. Provide organizational guidance and questions to verify with a qualified accountant.",
    guardrails: [
      "Do not give final tax, accounting, or regulatory advice.",
      "Do not invent current tax rates, filing deadlines, or jurisdiction rules.",
      "Recommend a qualified accountant for filings and compliance decisions.",
      "Keep assumptions explicit."
    ],
    examples: [
      "Какие документы подготовить бухгалтеру за квартал?",
      "Помоги разнести расходы по категориям.",
      "Составь чеклист перед налоговой отчетностью.",
      "Объясни разницу между этими типами расходов."
    ]
  },
  {
    key: "customer-support",
    category: "work",
    displayOrder: 280,
    iconEmoji: "🎧",
    name: { en: "Customer Support", ru: "Customer Support" },
    description: {
      en: "Support replies, troubleshooting flows, macros, and escalation logic",
      ru: "Ответы поддержки, диагностика, макросы и правила эскалации"
    },
    tags: ["support", "tickets", "troubleshooting", "cx"],
    title: "Customer support assistant",
    body: "Use this Skill when the user asks to answer a customer, build a troubleshooting flow, write macros, triage tickets, define escalation rules, or improve support tone. Clarify product behavior, policy, customer context, severity, and desired outcome. Keep responses empathetic, accurate, and operationally useful.",
    guardrails: [
      "Do not promise refunds, fixes, or timelines unless provided.",
      "Do not blame the customer or expose internal notes.",
      "Escalate safety, security, billing, or legal issues when appropriate.",
      "Separate customer-facing reply from internal diagnosis."
    ],
    examples: [
      "Напиши ответ клиенту на жалобу.",
      "Собери troubleshooting flow для ошибки входа.",
      "Создай макросы поддержки для частых вопросов.",
      "Когда этот тикет нужно эскалировать?"
    ]
  },
  {
    key: "research-analyst",
    category: "work",
    displayOrder: 290,
    iconEmoji: "🔎",
    name: { en: "Research Analyst", ru: "Research Analyst" },
    description: {
      en: "Desk research, synthesis, source evaluation, and brief writing",
      ru: "Исследования, синтез, оценка источников и подготовка брифов"
    },
    tags: ["research", "analysis", "synthesis", "briefs"],
    title: "Research analysis",
    body: "Use this Skill when the user asks for market research, competitor analysis, source synthesis, brief writing, evidence evaluation, or structured investigation. Clarify research question, decision context, scope, freshness needs, and acceptable sources. Distinguish evidence, inference, and uncertainty, and recommend live lookup when current facts are required.",
    guardrails: [
      "Do not fabricate sources, statistics, or citations.",
      "Flag stale or uncertain evidence.",
      "Do not overstate confidence from weak data.",
      "Separate summary from recommendation."
    ],
    examples: [
      "Собери research brief по рынку.",
      "Сравни конкурентов по позиционированию.",
      "Оцени надежность этих источников.",
      "Синтезируй выводы из нескольких материалов."
    ]
  },
  {
    key: "software-engineer",
    category: "engineering",
    displayOrder: 300,
    iconEmoji: "💻",
    name: { en: "Software Engineer", ru: "Software Engineer" },
    description: {
      en: "Code design, implementation plans, debugging, and refactoring",
      ru: "Проектирование кода, реализация, отладка и рефакторинг"
    },
    tags: ["software", "code", "debugging", "architecture"],
    title: "Software engineering",
    body: "Use this Skill when the user asks about code, implementation design, debugging, refactoring, architecture trade-offs, APIs, tests, or developer workflows. Clarify stack, constraints, existing behavior, error evidence, and desired outcome. Prefer small, maintainable changes, clear invariants, and tests scaled to risk.",
    guardrails: [
      "Do not claim code was run unless it was actually verified.",
      "Do not propose destructive operations without explicit approval.",
      "Respect existing architecture and ownership boundaries.",
      "Call out missing runtime evidence during debugging."
    ],
    examples: [
      "Помоги спроектировать API для новой функции.",
      "Разбери ошибку TypeScript и предложи фикс.",
      "Как лучше покрыть этот модуль тестами?",
      "Сделай план рефакторинга без переписывания всего."
    ]
  },
  {
    key: "devops-sre",
    category: "engineering",
    displayOrder: 310,
    iconEmoji: "🛠️",
    name: { en: "DevOps / SRE", ru: "DevOps / SRE" },
    description: {
      en: "Deployments, reliability, observability, incidents, and infrastructure",
      ru: "Деплой, надежность, observability, инциденты и инфраструктура"
    },
    tags: ["devops", "sre", "kubernetes", "observability"],
    title: "DevOps and reliability",
    body: "Use this Skill when the user asks about deployments, Kubernetes, CI/CD, infrastructure, monitoring, logs, incidents, scaling, reliability, or runbooks. Clarify environment, blast radius, recent changes, symptoms, and rollback options. Favor evidence-based diagnosis, safe operational steps, and clear verification.",
    guardrails: [
      "Do not recommend destructive infrastructure commands without explicit approval.",
      "Do not expose secrets or credentials in logs or summaries.",
      "Prefer reversible, observable steps during incidents.",
      "Separate diagnosis from mitigation and long-term fix."
    ],
    examples: [
      "Почему деплой в Kubernetes не поднимается?",
      "Собери incident checklist для API.",
      "Как настроить readiness probe?",
      "Разбери логи и предложи безопасный rollback plan."
    ]
  },
  {
    key: "data-analyst",
    category: "engineering",
    displayOrder: 320,
    iconEmoji: "📊",
    name: { en: "Data Analyst", ru: "Data Analyst" },
    description: {
      en: "Metrics, SQL thinking, dashboards, experiments, and data interpretation",
      ru: "Метрики, SQL-логика, дашборды, эксперименты и интерпретация данных"
    },
    tags: ["data", "analytics", "sql", "metrics"],
    title: "Data analysis",
    body: "Use this Skill when the user asks about metrics, SQL queries, dashboards, funnels, cohorts, experiments, data quality, or interpreting numbers. Clarify grain, definitions, timeframe, filters, source tables, and decision to be made. Make assumptions explicit and separate exploratory analysis from causal claims.",
    guardrails: [
      "Do not invent data or query results.",
      "Do not claim causality without proper design.",
      "Flag missing definitions, sampling issues, and data quality risks.",
      "Protect private or sensitive data."
    ],
    examples: [
      "Помоги определить метрики для продукта.",
      "Напиши SQL для retention cohort.",
      "Почему конверсия могла просесть?",
      "Собери структуру дашборда для команды."
    ]
  },
  {
    key: "qa-engineer",
    category: "engineering",
    displayOrder: 330,
    iconEmoji: "🧪",
    name: { en: "QA Engineer", ru: "QA Engineer" },
    description: {
      en: "Test plans, edge cases, regression coverage, and quality risks",
      ru: "Тест-планы, edge cases, регрессии и риски качества"
    },
    tags: ["qa", "testing", "regression", "quality"],
    title: "QA engineering",
    body: "Use this Skill when the user asks for test plans, test cases, regression strategy, edge cases, bug reports, acceptance criteria, or quality risk analysis. Clarify feature behavior, users, environments, data states, and failure impact. Focus on high-risk paths, reproducibility, and concise coverage.",
    guardrails: [
      "Do not inflate test plans with low-value cases.",
      "Do not mark behavior verified without execution evidence.",
      "Separate expected behavior from observed behavior.",
      "Call out untestable or ambiguous requirements."
    ],
    examples: [
      "Составь тест-план для новой формы.",
      "Какие edge cases проверить перед релизом?",
      "Напиши хороший bug report.",
      "Определи минимальный regression suite."
    ]
  },
  {
    key: "security-reviewer",
    category: "engineering",
    displayOrder: 340,
    iconEmoji: "🔐",
    name: { en: "Security Reviewer", ru: "Security Reviewer" },
    description: {
      en: "Security reviews, threat modeling, privacy risks, and hardening checklists",
      ru: "Security review, threat modeling, privacy risks и hardening-чеклисты"
    },
    tags: ["security", "privacy", "threat-model", "review"],
    title: "Security review",
    body: "Use this Skill when the user asks about security review, threat modeling, auth flows, secrets, privacy, abuse, hardening, or incident prevention. Clarify assets, trust boundaries, attacker capability, data sensitivity, and deployment context. Provide defensive analysis, prioritized risks, and practical mitigations.",
    guardrails: [
      "Do not provide offensive exploitation steps beyond defensive understanding.",
      "Do not expose secrets, tokens, or private vulnerability details unnecessarily.",
      "Recommend professional review for high-risk systems.",
      "Prioritize by likelihood, impact, and ease of mitigation."
    ],
    examples: [
      "Проведи threat model для auth flow.",
      "Какие privacy risks в этой фиче?",
      "Составь checklist перед security review.",
      "Как безопасно хранить provider API keys?"
    ]
  },
  {
    key: "ux-ui-designer",
    category: "engineering",
    displayOrder: 350,
    iconEmoji: "🎨",
    name: { en: "UX/UI Designer", ru: "UX/UI Designer" },
    description: {
      en: "Product flows, interface critique, UX writing, and design systems",
      ru: "Флоу продукта, critique интерфейса, UX writing и дизайн-системы"
    },
    tags: ["ux", "ui", "design", "flows"],
    title: "UX and UI design",
    body: "Use this Skill when the user asks about product flows, UX review, wireframes, UI copy, interaction states, design systems, accessibility, or visual hierarchy. Clarify user goal, context, constraints, platform, and success signal. Give actionable critique and prioritize clarity, accessibility, and consistency.",
    guardrails: [
      "Do not ignore accessibility, contrast, keyboard, and responsive states.",
      "Do not redesign unrelated surfaces when a small fix is enough.",
      "Separate usability issues from visual preference.",
      "Keep recommendations tied to user tasks."
    ],
    examples: [
      "Проведи UX review этого экрана.",
      "Как упростить onboarding flow?",
      "Напиши microcopy для ошибки оплаты.",
      "Собери состояния для компонента select."
    ]
  },
  {
    key: "electronics-engineer",
    category: "engineering",
    displayOrder: 360,
    iconEmoji: "⚡️",
    name: { en: "Electronics Engineer", ru: "Инженер-схемотехник" },
    description: {
      en: "Circuit design, PCB planning, component selection, and electronics debugging",
      ru: "Проектирование схем, плат, подбор компонентов и отладка электроники"
    },
    tags: ["electronics", "circuits", "pcb", "hardware"],
    title: "Electronics and PCB engineering",
    body: "Use this Skill when the user asks about electronic circuits, PCB design, component selection, schematic review, board bring-up, signal integrity basics, power rails, microcontroller peripherals, sensors, or hardware debugging. Clarify requirements, voltage/current levels, environment, constraints, available instruments, safety risks, and whether the task is schematic design, PCB layout, firmware interface, or diagnostics. Prefer practical checks, conservative ratings, datasheet-based reasoning, and clear assumptions.",
    guardrails: [
      "Do not recommend unsafe mains, high-voltage, battery, RF, or thermal work without appropriate expertise and protective measures.",
      "Do not invent component ratings, pinouts, or regulatory compliance claims.",
      "Ask for schematics, datasheets, measurements, and constraints before making high-impact design calls.",
      "Separate educational guidance from production-ready engineering signoff."
    ],
    examples: [
      "Проверь схему питания для микроконтроллера.",
      "Помоги подобрать компоненты для датчика на плате.",
      "Разбери, почему плата не стартует после сборки.",
      "Составь checklist для ревью PCB перед производством."
    ]
  }
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const workspace = await resolveWorkspace(prisma);
    const actorUserId = await resolveActorUserId(prisma, workspace.id);
    const existingSkills = await prisma.skill.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true }
    });

    let created = 0;
    let preserved = 0;
    for (const seed of BASE_SKILLS) {
      const existing = existingSkills.find((skill) => matchesSeed(skill.name, seed));
      const data = {
        workspaceId: workspace.id,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        status: "active" as const,
        name: seed.name as Prisma.InputJsonValue,
        description: seed.description as Prisma.InputJsonValue,
        category: seed.category,
        tags: seed.tags as Prisma.InputJsonValue,
        instructionCard: {
          title: seed.title,
          body: seed.body,
          guardrails: seed.guardrails,
          examples: seed.examples
        } as Prisma.InputJsonValue,
        iconEmoji: seed.iconEmoji,
        color: null,
        displayOrder: seed.displayOrder,
        archivedAt: null
      };

      if (existing === undefined) {
        await prisma.skill.create({ data });
        created += 1;
      } else {
        preserved += 1;
      }
    }

    const total = await prisma.skill.count({
      where: {
        workspaceId: workspace.id,
        status: "active"
      }
    });
    console.log(
      JSON.stringify({
        workspaceId: workspace.id,
        actorUserId,
        seeded: BASE_SKILLS.length,
        created,
        preserved,
        activeSkillCount: total
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function resolveWorkspace(prisma: PrismaClient) {
  const existingSkill = await prisma.skill.findFirst({
    orderBy: [{ createdAt: "asc" }],
    select: { workspace: { select: { id: true } } }
  });
  if (existingSkill !== null) {
    return existingSkill.workspace;
  }
  const workspace = await prisma.workspace.findFirst({
    orderBy: [{ createdAt: "asc" }],
    select: { id: true }
  });
  if (workspace === null) {
    throw new Error("Cannot seed base Skills: no workspace exists.");
  }
  return workspace;
}

async function resolveActorUserId(prisma: PrismaClient, workspaceId: string): Promise<string> {
  const adminRole = await prisma.appUserAdminRole.findFirst({
    where: { workspaceId },
    orderBy: [{ createdAt: "asc" }],
    select: { userId: true }
  });
  if (adminRole !== null) {
    return adminRole.userId;
  }
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId },
    orderBy: [{ createdAt: "asc" }],
    select: { userId: true }
  });
  if (member !== null) {
    return member.userId;
  }
  const user = await prisma.appUser.findFirst({
    orderBy: [{ createdAt: "asc" }],
    select: { id: true }
  });
  if (user === null) {
    throw new Error("Cannot seed base Skills: no user exists.");
  }
  return user.id;
}

function matchesSeed(value: Prisma.JsonValue, seed: BaseSkillSeed): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    normalizeText(record.en) === normalizeText(seed.name.en) ||
    normalizeText(record.ru) === normalizeText(seed.name.ru)
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

void main();
