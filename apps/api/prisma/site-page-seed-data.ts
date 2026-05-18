import { resolveLegalDocumentVersion } from "@persai/types";

export type SitePageSeed = {
  slug: "terms" | "privacy" | "requisites" | "contacts";
  market: "rf" | "intl";
  locale: "ru" | "en";
  status: "published";
  title: string;
  bodyMarkdown: string;
  version: string | null;
};

export const SITE_PAGE_SEEDS: SitePageSeed[] = [
  {
    slug: "terms",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Условия использования PersAI",
    version: resolveLegalDocumentVersion("rf", "terms"),
    bodyMarkdown: `# Условия использования

Эта страница задает публичный базовый текст условий PersAI для рынка РФ.

## Что такое PersAI

PersAI — сервис персонального AI-ассистента с чатами, памятью, файлами, документами и интеграциями.

## Аккаунт

- пользователь отвечает за безопасность доступа к своему аккаунту
- запрещено использовать сервис для незаконной деятельности, спама, злоупотреблений и обхода ограничений

## Подписка и оплата

- платные функции и лимиты зависят от активного тарифа
- условия тарифа, продления и отключения автопродления отображаются в продукте

## Контент пользователя

- пользователь сохраняет права на свой контент
- сервис может обрабатывать загруженные данные для работы функций PersAI

## Ответственность

- AI может ошибаться; важную информацию нужно проверять
- сервис предоставляется в текущем виде с учетом действующего законодательства и опубликованных политик

## Контакты

Если у вас есть вопросы по условиям использования, используйте страницу «Контакты».
`
  },
  {
    slug: "privacy",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Политика конфиденциальности PersAI",
    version: resolveLegalDocumentVersion("rf", "privacy"),
    bodyMarkdown: `# Политика конфиденциальности

Эта страница описывает базовые принципы обработки данных PersAI для рынка РФ.

## Какие данные мы обрабатываем

- данные аккаунта и профиля
- сообщения, файлы и связанные метаданные
- технические данные, нужные для авторизации, оплаты, безопасности и доставки

## Зачем это нужно

- для работы чатов, памяти, документов и интеграций
- для поддержки, биллинга, защиты от злоупотреблений и улучшения сервиса

## Передача третьим сторонам

PersAI может использовать внешние сервисы для авторизации, оплаты, доставки почты и AI-провайдеров, когда это необходимо для работы продукта.

## Права пользователя

Пользователь может менять часть профиля, управлять контентом и обращаться через страницу «Контакты» по вопросам обработки данных.
`
  },
  {
    slug: "requisites",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Реквизиты",
    version: null,
    bodyMarkdown: `# Реквизиты

Заполните и актуализируйте этот раздел через Admin > Site pages.

- Наименование: _указать_
- ИНН: _указать_
- ОГРН / ОГРНИП: _указать_
- Адрес: _указать_
- Банк / расчетный счет: _указать_
`
  },
  {
    slug: "contacts",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Контакты",
    version: null,
    bodyMarkdown: `# Контакты

- Email поддержки: support@persai.dev
- По юридическим и privacy-вопросам укажите актуальный контакт в этом разделе

Если нужно, добавьте в этом блоке часы ответа, Telegram или дополнительные каналы связи.
`
  },
  {
    slug: "terms",
    market: "intl",
    locale: "en",
    status: "published",
    title: "PersAI Terms of Service",
    version: resolveLegalDocumentVersion("intl", "terms"),
    bodyMarkdown: `# Terms of Service

This page provides PersAI's baseline public terms for the international market.

## The service

PersAI is a personal AI assistant product with chat, memory, files, documents, and integrations.

## Account

- you are responsible for securing access to your account
- you may not use the service for unlawful activity, abuse, spam, or policy evasion

## Billing

- paid capabilities and limits depend on the active plan
- plan, renewal, and cancellation details are shown in the product

## User content

- you retain rights to your content
- PersAI may process uploaded data to provide product functionality

## Liability

- AI output can be wrong and should be verified when it matters
- the service is provided subject to applicable law and published product policies
`
  },
  {
    slug: "privacy",
    market: "intl",
    locale: "en",
    status: "published",
    title: "PersAI Privacy Policy",
    version: resolveLegalDocumentVersion("intl", "privacy"),
    bodyMarkdown: `# Privacy Policy

This page describes PersAI's baseline public data-handling policy for the international market.

## What we process

- account and profile information
- chats, files, and related metadata
- technical data needed for auth, billing, security, and delivery

## Why we process it

- to power chats, memory, documents, and integrations
- to support billing, fraud prevention, abuse controls, and support operations

## Third parties

PersAI may rely on third-party services for authentication, payment processing, email delivery, and AI providers when required to operate the product.

## Your controls

Users can manage parts of their profile and content in-product and can contact PersAI through the Contacts page regarding privacy questions.
`
  },
  {
    slug: "requisites",
    market: "intl",
    locale: "en",
    status: "published",
    title: "Company Details",
    version: null,
    bodyMarkdown: `# Company Details

Fill and maintain this section from Admin > Site pages.

- Legal entity: _fill in_
- Registration number: _fill in_
- Address: _fill in_
- Billing details: _fill in_
`
  },
  {
    slug: "contacts",
    market: "intl",
    locale: "en",
    status: "published",
    title: "Contacts",
    version: null,
    bodyMarkdown: `# Contacts

- Support email: support@persai.dev
- Add legal, privacy, or business contacts here as needed

You can also add support hours or additional channels in this section.
`
  }
];
