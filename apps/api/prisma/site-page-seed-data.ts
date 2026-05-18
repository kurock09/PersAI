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
    title: "Публичная оферта и условия использования PersAI",
    version: resolveLegalDocumentVersion("rf", "terms"),
    bodyMarkdown: `# Публичная оферта и условия использования PersAI

Редакция от 19.05.2026.

Настоящий документ является публичной офертой Индивидуального предпринимателя Карнаух Алексея Сергеевича о предоставлении доступа к сервису PersAI на изложенных ниже условиях. Акцептом оферты считается регистрация в сервисе, начало использования функциональности PersAI, оформление тарифа, оплата подписки или иное фактическое использование сервиса.

## 1. Стороны и сервис

PersAI - это программный сервис персонального AI-ассистента, включающий веб-интерфейс, чаты, память, файлы, генерацию документов, медиа-функции, интеграции и сопутствующие цифровые инструменты.

Исполнитель по настоящей оферте:

- Индивидуальный предприниматель Карнаух Алексей Сергеевич
- ИНН: 615010297306
- ОГРНИП: 317619600160244
- Контактный email: support@persai.dev

## 2. Предмет оферты

Исполнитель предоставляет пользователю ограниченное неисключительное право доступа к PersAI через сеть Интернет в пределах выбранного тарифа, функциональных ограничений продукта и опубликованных правил сервиса.

Функциональность PersAI может включать использование сторонних технологических провайдеров для авторизации, биллинга, отправки уведомлений, AI-обработки, хранения файлов, генерации документов и доставки результатов пользователю.

## 3. Регистрация и аккаунт

Пользователь обязуется:

- предоставлять достоверные данные при регистрации и оплате;
- обеспечивать конфиденциальность средств доступа к аккаунту;
- не передавать аккаунт третьим лицам без согласия Исполнителя;
- незамедлительно уведомить Исполнителя о подозрении на несанкционированный доступ.

Пользователь самостоятельно несет риск последствий использования своего аккаунта до момента уведомления Исполнителя о компрометации доступа.

## 4. Допустимое использование

Запрещается использовать PersAI:

- для нарушения законодательства Российской Федерации или применимого законодательства иной юрисдикции;
- для рассылки спама, фишинга, вредоносного кода, мошенничества или обхода технических ограничений;
- для нарушения прав третьих лиц, включая права на результаты интеллектуальной деятельности и права на персональные данные;
- для создания или распространения запрещенного, вредоносного, дискриминационного, экстремистского либо иного противоправного контента;
- способом, создающим чрезмерную нагрузку на инфраструктуру сервиса либо нарушающим безопасность PersAI.

Исполнитель вправе ограничить или приостановить доступ к сервису при наличии разумных оснований полагать, что пользователь нарушает настоящую оферту, требования безопасности или обязательные нормы закона.

## 5. Тарифы, оплата и подписка

Доступ к части функций PersAI может предоставляться на платной основе по подписке или в форме разовых цифровых пакетов/дополнений. Актуальные тарифы, лимиты, период подписки, информация об автопродлении и составе оплачиваемых функций указываются в интерфейсе продукта на момент оформления.

Если в продукте включено автопродление, пользователь соглашается на списание платы за следующий период в соответствии с условиями выбранного тарифа, пока автопродление не отключено пользователем или Исполнителем.

Запросы по оплате, возврату и отмене подписки рассматриваются с учетом фактически оказанных услуг, использованных лимитов, характера цифрового доступа и обязательных требований законодательства о защите прав потребителей.

## 6. Контент пользователя и AI-результаты

Пользователь сохраняет права на исходные материалы, которые он законно загрузил или ввел в PersAI.

Пользователь предоставляет Исполнителю и привлекаемым технологическим провайдерам право использовать такой контент в объеме, необходимом для:

- работы функций сервиса;
- хранения, обработки и доставки результатов;
- обеспечения безопасности, отладки и поддержки;
- исполнения пользовательских запросов к AI-моделям и внешним инструментам.

Пользователь гарантирует, что обладает необходимыми правами и законными основаниями для загрузки контента в PersAI и поручения его обработки сервису.

AI-ответы, документы, изображения, видео, голосовые и иные результаты формируются автоматически и могут содержать ошибки, неточности или неподходящие выводы. Пользователь обязан самостоятельно проверять существенную информацию перед тем, как полагаться на нее в юридически, финансово, медицински, кадрово или ином значимом контексте.

## 7. Интеллектуальная собственность

Исключительные права на PersAI, его программный код, интерфейсы, дизайн, базы данных, товарные обозначения и иные элементы сервиса принадлежат Исполнителю либо его правообладателям.

Пользователь не вправе:

- копировать, декомпилировать, модифицировать или иным образом неправомерно использовать код и элементы PersAI;
- извлекать из сервиса данные и материалы способами, не предусмотренными обычной функциональностью продукта;
- использовать PersAI для создания конкурирующего сервиса путем неправомерного копирования его логики, данных или интерфейсов.

## 8. Доступность сервиса и изменения

PersAI предоставляется по модели "как есть" и "по мере доступности". Исполнитель вправе развивать, изменять, приостанавливать отдельные функции, тарифы, лимиты, интерфейсы, интеграции и состав технологических провайдеров, если это не противоречит обязательным требованиям закона.

Исполнитель вправе обновлять настоящую оферту. Новая редакция применяется с момента публикации на сайте, если иная дата не указана в тексте редакции. Для действий, требующих отдельного согласия по закону, Исполнитель запрашивает такое согласие отдельно.

## 9. Ответственность сторон

Исполнитель не несет ответственность за:

- перерывы в работе, вызванные действиями провайдеров связи, облачных платформ, платежных сервисов, AI-провайдеров и иных третьих лиц;
- ошибки, искажения или субъективность AI-результатов;
- убытки пользователя, возникшие вследствие использования сервиса не по назначению, нарушения инструкций или непроверенного доверия к AI-ответам;
- действия третьих лиц, получивших доступ к аккаунту пользователя по вине самого пользователя.

Ничто в настоящей оферте не ограничивает права потребителя, которые не могут быть ограничены в силу закона.

## 10. Персональные данные и коммуникации

Обработка персональных данных осуществляется в соответствии с опубликованной Политикой в отношении обработки персональных данных PersAI.

Рекламные и маркетинговые сообщения, если они направляются пользователю, осуществляются только при наличии отдельного предварительного согласия в случаях, когда такое согласие требуется законом. Пользователь вправе отказаться от таких сообщений в любой момент.

## 11. Применимое право и споры

К настоящей оферте применяется право Российской Федерации.

Споры и претензии по возможности разрешаются путем переговоров. Если соглашение не достигнуто, спор подлежит разрешению в порядке, установленном применимым законодательством Российской Федерации.

## 12. Контакты

По вопросам оферты, доступа к сервису, оплаты, возвратов, претензий и правомерности использования PersAI пользователь может обратиться по адресу support@persai.dev или через актуальную страницу "Контакты".`
  },
  {
    slug: "privacy",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Политика в отношении обработки персональных данных PersAI",
    version: resolveLegalDocumentVersion("rf", "privacy"),
    bodyMarkdown: `# Политика в отношении обработки персональных данных PersAI

Редакция от 19.05.2026.

Настоящая Политика определяет порядок обработки персональных данных пользователей сервиса PersAI и иных лиц, чьи данные поступают оператору в связи с использованием сайта, приложений, форм обратной связи, оплаты, поддержки и иных процессов работы сервиса.

## 1. Оператор персональных данных

Оператором персональных данных является:

- Индивидуальный предприниматель Карнаух Алексей Сергеевич
- ИНН: 615010297306
- ОГРНИП: 317619600160244
- Местонахождение: Ростовская область, г. Ростов-на-Дону, Российская Федерация
- Email для обращений по персональным данным: support@persai.dev

Оператор публикует настоящую Политику и обеспечивает неограниченный доступ к ней на страницах, где осуществляется сбор персональных данных.

## 2. Категории субъектов персональных данных

Оператор может обрабатывать персональные данные следующих категорий субъектов:

- пользователей PersAI и владельцев аккаунтов;
- лиц, направляющих обращения в поддержку, по юридическим и privacy-вопросам;
- представителей клиентов, партнеров и контрагентов;
- получателей информационных и рекламных сообщений при наличии отдельного согласия, когда оно требуется.

## 3. Какие данные могут обрабатываться

В зависимости от сценария использования PersAI могут обрабатываться:

- идентификационные и профильные данные: имя, фамилия, email, язык, страна, идентификаторы аккаунта;
- данные об использовании сервиса: история авторизации, сведения о тарифе, подписке, лимитах, действиях в интерфейсе;
- пользовательский контент: сообщения, файлы, документы, медиа, заметки памяти, промпты и результаты генерации;
- технические данные: IP-адрес, cookie, session-id, user-agent, сведения об устройстве, журнал безопасности, диагностические события;
- платежные и биллинговые данные: статус оплаты, идентификаторы платежей, данные тарифа, история транзакций, но не полные реквизиты банковской карты в случаях, когда они обрабатываются платежным провайдером;
- коммуникационные данные: содержание обращений в поддержку, письма, ответы, вложения и метаданные доставки сообщений.

Специальные категории персональных данных и биометрические персональные данные не должны передаваться в PersAI, если иное прямо не предусмотрено отдельным письменным соглашением или обязательным законом.

## 4. Цели и правовые основания обработки

| Цель обработки | Категории данных | Правовое основание |
| --- | --- | --- |
| Регистрация, вход в аккаунт, администрирование доступа | имя, email, идентификаторы аккаунта, технические данные | заключение и исполнение договора, совершение действий по инициативе субъекта |
| Предоставление функций PersAI: чат, память, файлы, документы, генерация медиа, интеграции | пользовательский контент, профильные и технические данные | исполнение договора, законный интерес в обеспечении работы сервиса |
| Оплата, подписка, бухгалтерский и налоговый учет | платежные идентификаторы, сведения о тарифе, контактные данные | исполнение договора, исполнение обязанностей по закону |
| Поддержка, обработка обращений, претензий и запросов субъектов ПДн | контактные данные, переписка, связанные технические данные | исполнение договора, исполнение обязанностей по закону |
| Информационные и рекламные сообщения | email, идентификаторы подписки и коммуникационные предпочтения | отдельное согласие субъекта в случаях, когда оно требуется |
| Обеспечение безопасности, предотвращение злоупотреблений, расследование инцидентов | технические данные, журналы событий, идентификаторы аккаунта | законный интерес оператора, исполнение обязанностей по закону |

## 5. Способы и принципы обработки

Оператор осуществляет сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, использование, передачу, обезличивание, блокирование, удаление и уничтожение персональных данных как с использованием средств автоматизации, так и без их использования.

Оператор обрабатывает только те данные, которые необходимы для достижения заявленных целей обработки, и не допускает их избыточной обработки.

## 6. Использование файлов cookie и технических идентификаторов

PersAI использует cookie и аналогичные технические идентификаторы для:

- авторизации и поддержания пользовательской сессии;
- сохранения настроек интерфейса, включая язык и страну;
- защиты от злоупотреблений, обеспечения безопасности и стабильности сервиса;
- корректной маршрутизации запросов и доставки результатов.

Если для отдельных видов аналитики, маркетинга или рекламных технологий требуется специальное согласие, такое согласие должно запрашиваться отдельно.

## 7. Передача данных третьим лицам и поручение обработки

Для работы PersAI оператор может передавать персональные данные или поручать их обработку третьим лицам в объеме, необходимом для достижения целей обработки, в том числе:

- провайдерам идентификации и авторизации, включая Clerk;
- платежным провайдерам, включая CloudPayments;
- сервисам email- и notification-доставки, включая Postmark;
- AI- и document-провайдерам, включая OpenAI, Anthropic, Gamma и PDFMonkey;
- облачным и инфраструктурным провайдерам, включая сервисы хранения и вычислительные ресурсы.

Оператор требует от таких лиц соблюдения конфиденциальности, безопасности и обработки данных только в согласованном объеме и для предусмотренных целей.

## 8. Трансграничная передача персональных данных

При использовании отдельных технологических провайдеров обработка или хранение части данных может осуществляться за пределами Российской Федерации. Если для выполнения пользовательского запроса, работы интеграции, генерации AI-результата или доставки документа требуется трансграничная передача персональных данных, оператор осуществляет ее при наличии законных оснований и с учетом применимых требований законодательства.

Пользователь, загружая контент в PersAI и инициируя соответствующую функцию, понимает, что часть данных может обрабатываться такими провайдерами в объеме, технически необходимом для выполнения запроса.

## 9. Сроки обработки и хранения

Персональные данные хранятся не дольше, чем этого требуют цели обработки и обязательные сроки хранения по закону.

Общий ориентир сроков хранения:

- данные аккаунта и истории использования - в течение срока существования аккаунта и разумного периода после его закрытия для защиты прав, безопасности и разрешения споров;
- платежные и бухгалтерские данные - в сроки, установленные законодательством Российской Федерации;
- обращения в поддержку и юридически значимая переписка - на период обработки обращения и далее в пределах сроков исковой давности или иных обязательных сроков;
- данные для маркетинговых сообщений - до отзыва согласия либо прекращения соответствующей цели обработки;
- технические журналы и события безопасности - в течение периода, необходимого для обеспечения защиты и устойчивости сервиса.

По достижении целей обработки либо при наступлении иных законных оснований данные подлежат удалению, обезличиванию или уничтожению, если их дальнейшее хранение не требуется по закону.

## 10. Меры защиты персональных данных

Оператор принимает правовые, организационные и технические меры, необходимые и достаточные для защиты персональных данных, включая:

- разграничение доступа к данным;
- использование средств аутентификации и защиты учетных записей;
- журналирование событий доступа и действий администраторов;
- резервирование, защиту каналов передачи и контроль инцидентов;
- договорные и организационные меры при привлечении провайдеров и подрядчиков.

## 11. Права субъекта персональных данных

Субъект персональных данных вправе:

- получать сведения об обработке своих персональных данных;
- требовать уточнения, блокирования или удаления данных, если они неполны, устарели, неточны, получены незаконно или не нужны для заявленной цели;
- отозвать согласие на обработку персональных данных в случаях, когда обработка основана на согласии;
- отказаться от рекламных и маркетинговых сообщений;
- обжаловать действия или бездействие оператора в уполномоченный орган или в суд.

## 12. Порядок направления запросов

Для реализации своих прав субъект персональных данных может направить запрос на support@persai.dev. В запросе рекомендуется указать:

- ФИО или иные данные, позволяющие идентифицировать заявителя;
- email аккаунта или иной идентификатор, связанный с обращением;
- суть требования;
- обратный контакт для ответа.

Оператор вправе запросить разумные дополнительные сведения для подтверждения личности заявителя и защиты данных от неправомерного раскрытия.

## 13. Изменение Политики

Оператор вправе изменять настоящую Политику. Актуальная редакция вступает в силу с момента публикации на сайте, если в самой редакции не указан иной срок.`
  },
  {
    slug: "requisites",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Реквизиты",
    version: null,
    bodyMarkdown: `# Реквизиты

Актуальная публичная информация об исполнителе сервиса PersAI.

## Основные сведения

- Исполнитель: Индивидуальный предприниматель Карнаух Алексей Сергеевич
- Краткое наименование: ИП Карнаух Алексей Сергеевич
- Статус: действующий индивидуальный предприниматель
- ИНН: 615010297306
- ОГРНИП: 317619600160244
- ОКПО: 0162898673
- Дата государственной регистрации: 18.08.2017
- Дата внесения записи в ЕГРИП: 18.08.2017
- Местонахождение: Ростовская область, г. Ростов-на-Дону, Российская Федерация
- Категория субъекта МСП: микропредприятие
- Основной вид деятельности: ОКВЭД 62.09 - деятельность, связанная с использованием вычислительной техники и информационных технологий, прочая

## Для договоров и обращений

- Сервис: PersAI
- Email для поддержки, юридических и privacy-запросов: support@persai.dev
- Формат услуг: предоставление цифрового доступа к SaaS-сервису и сопутствующим функциям PersAI

## Важно перед публичным релизом продаж

Для идеальной коммерческой и договорной комплектации этой страницы рекомендуется дополнительно опубликовать:

- полный почтовый адрес для направления корреспонденции и юридически значимых сообщений;
- банковские реквизиты для безналичной оплаты по счету, если вы планируете B2B-выставление счетов с сайта;
- режим обработки обращений, если хотите формализовать SLA для претензий и поддержки.

До обновления этих данных официальным каналом для обращений остается support@persai.dev.`
  },
  {
    slug: "contacts",
    market: "rf",
    locale: "ru",
    status: "published",
    title: "Контакты",
    version: null,
    bodyMarkdown: `# Контакты

Используйте следующие контакты по вопросам работы PersAI.

## Основной канал связи

- Общая поддержка: support@persai.dev

## По каким вопросам можно писать

- доступ к аккаунту, подписка, платежи и возвраты;
- ошибки в работе сервиса, файлов, документов, чатов и AI-функций;
- запросы субъектов персональных данных;
- юридические вопросы, претензии и предложения о сотрудничестве.

## Как оформить обращение быстрее

В письме желательно указать:

- email аккаунта или иной идентификатор пользователя;
- краткое описание вопроса;
- дату, номер платежа или ссылку на проблемный объект, если обращение связано с оплатой или конкретным результатом сервиса.

## Электронные обращения

Электронные обращения принимаются круглосуточно. Ответ предоставляется в разумный срок с учетом сложности запроса и применимых обязательных требований законодательства.

Для юридически значимых и privacy-запросов используйте тот же адрес: support@persai.dev.`
  },
  {
    slug: "terms",
    market: "intl",
    locale: "en",
    status: "published",
    title: "PersAI Terms of Service and Public Offer",
    version: resolveLegalDocumentVersion("intl", "terms"),
    bodyMarkdown: `# PersAI Terms of Service and Public Offer

Version dated 2026-05-19.

This document sets out the baseline public terms under which PersAI is provided by Individual Entrepreneur Alexey Sergeevich Karnaukh. You accept these terms by creating an account, using the service, starting a paid plan, purchasing a digital add-on, or otherwise accessing PersAI.

## 1. The service

PersAI is a personal AI assistant service that may include web access, chat, memory, files, document generation, media generation, integrations, and related digital tooling.

Service provider:

- Individual Entrepreneur Alexey Sergeevich Karnaukh
- Tax ID: 615010297306
- Registration number: 317619600160244
- Contact email: support@persai.dev

## 2. Scope of access

PersAI grants you a limited, non-exclusive, revocable right to access and use the service within the active plan, product limits, and applicable policies published by PersAI.

Certain functions may rely on third-party providers for identity, billing, storage, AI inference, email delivery, and document generation.

## 3. Account and security

You must provide accurate information when registering and using paid features. You are responsible for keeping your account credentials confidential and for activities performed through your account unless you promptly notify PersAI about unauthorized access.

## 4. Acceptable use

You may not use PersAI:

- for unlawful, harmful, abusive, fraudulent, or infringing activity;
- to send spam, phishing, malware, or to bypass technical restrictions;
- to violate third-party intellectual property, privacy, or data protection rights;
- to generate or distribute prohibited content or overload the service infrastructure.

PersAI may suspend or restrict access where it reasonably believes there is abuse, a security risk, or a violation of these terms or applicable law.

## 5. Paid plans and billing

Some features are provided under paid plans, subscriptions, or one-time digital packages. Current prices, billing periods, feature limits, renewal behavior, and cancellation controls are shown in the product at the time of purchase.

Where auto-renewal is enabled in the checkout flow, you authorize recurring charges until you cancel or PersAI terminates the subscription.

Refund requests are handled in light of applicable law, the digital nature of the service, the extent of already delivered access, and any consumed usage or quotas.

## 6. Your content and AI output

You retain rights to the content you lawfully upload or submit to PersAI.

You authorize PersAI and its involved technology providers to process that content as necessary to:

- operate the requested product functionality;
- store, process, and deliver outputs;
- maintain security, support, and reliability;
- fulfill prompts and external tool actions initiated by you.

You represent that you have the rights and lawful basis required to upload and process such content through PersAI.

AI outputs may be inaccurate, incomplete, misleading, or unsuitable for important decisions. You must independently review outputs before relying on them in legal, financial, medical, hiring, compliance, or other material contexts.

## 7. Intellectual property

PersAI and its underlying software, interfaces, branding, design, and related materials remain the property of PersAI or its licensors. You may not copy, reverse engineer, scrape, or unlawfully reproduce the service beyond normal permitted use.

## 8. Availability and updates

PersAI is provided on an "as is" and "as available" basis. Features, limits, integrations, plans, and providers may change over time. Updated terms apply from the moment a new version is published, unless a later effective date is expressly stated.

## 9. Privacy and communications

Personal data is processed in accordance with the published PersAI Privacy Policy.

Marketing communications, where sent, are handled only on the basis required by applicable law, including separate prior consent where such consent is legally required. You may opt out of such messages at any time.

## 10. Governing law and disputes

These terms are governed by the laws applicable to the service provider and the mandatory consumer protection rules that cannot be waived by contract.

Questions, complaints, billing issues, and legal notices may be sent to support@persai.dev.`
  },
  {
    slug: "privacy",
    market: "intl",
    locale: "en",
    status: "published",
    title: "PersAI Privacy Policy",
    version: resolveLegalDocumentVersion("intl", "privacy"),
    bodyMarkdown: `# PersAI Privacy Policy

Version dated 2026-05-19.

This Privacy Policy describes how PersAI handles personal data in connection with the website, account registration, support flows, billing, and use of PersAI features.

## 1. Data controller / operator

PersAI is operated by:

- Individual Entrepreneur Alexey Sergeevich Karnaukh
- Tax ID: 615010297306
- Registration number: 317619600160244
- Location: Rostov Region, Rostov-on-Don, Russian Federation
- Privacy contact: support@persai.dev

## 2. Who this policy covers

This policy applies to:

- account holders and users of PersAI;
- people contacting PersAI for support, legal, privacy, or partnership matters;
- recipients of informational or marketing communications where such communications are lawfully sent.

## 3. Categories of personal data

Depending on how you use PersAI, the service may process:

- identity and profile data such as name, email, account identifiers, locale, and country;
- service usage data such as subscription state, plan, quotas, login history, and product events;
- user content such as prompts, chat messages, files, documents, media, memory items, and generated outputs;
- technical data such as IP address, cookies, session identifiers, device/browser details, and security logs;
- billing-related data such as payment references, transaction status, and plan history;
- support communications and related attachments or metadata.

Please do not submit special category data or biometric data unless PersAI explicitly asks for it in a separate documented process.

## 4. Why PersAI processes data

PersAI processes personal data to:

- create and manage accounts and authentication;
- provide chat, memory, files, documents, media, and integration features;
- process payments, subscriptions, invoices, and related accounting obligations;
- provide support, handle complaints, and answer legal or privacy requests;
- secure the service, detect abuse, and maintain operational reliability;
- send informational or marketing messages where a valid legal basis exists.

## 5. Legal bases

Depending on the situation, PersAI relies on one or more of the following bases:

- performance of a contract or taking steps at your request before entering into a contract;
- compliance with legal obligations;
- legitimate interests in operating, securing, and improving the service;
- your consent, where consent is required by applicable law.

## 6. Cookies and technical identifiers

PersAI uses cookies and similar identifiers for authentication, locale/country preferences, session continuity, routing, security, and feature delivery.

Where a separate consent is legally required for specific analytics, marketing, or advertising technologies, PersAI should request that consent separately.

## 7. Third-party processors and service providers

PersAI may share data with carefully selected providers where needed to run the product, including providers used for:

- authentication and identity management, including Clerk;
- payment processing, including CloudPayments;
- email and notification delivery, including Postmark;
- AI and document generation, including OpenAI, Anthropic, Gamma, and PDFMonkey;
- cloud infrastructure and storage services.

These providers process data only to the extent needed for the relevant service function and subject to contractual, organizational, or technical safeguards.

## 8. International / cross-border processing

Some providers used by PersAI may process or store data outside your country, including outside the Russian Federation. When you use features that depend on such providers, relevant data may be transferred as technically necessary to fulfill your request and operate the service lawfully.

## 9. Retention

PersAI keeps data only for as long as necessary for the purposes described in this policy or as required by law.

Typical retention logic includes:

- account data for the lifetime of the account and a reasonable post-closure period for security, disputes, and legal defense;
- billing and accounting records for the statutory retention period;
- support and legal communications for the period needed to resolve the issue and for related limitation periods;
- marketing-contact data until consent is withdrawn or the purpose ends;
- technical and security logs for the period needed to maintain service integrity and investigate incidents.

## 10. Security measures

PersAI uses legal, organizational, and technical measures designed to protect personal data, including access controls, account security, logging, vendor controls, and incident-management practices.

## 11. Your rights

Subject to applicable law, you may have the right to:

- request information about the processing of your personal data;
- request correction, deletion, blocking, or restriction where appropriate;
- withdraw consent where processing depends on consent;
- object to marketing communications;
- file a complaint with a competent authority or court.

## 12. Contacting PersAI about privacy

Privacy requests may be sent to support@persai.dev. To help PersAI respond, include enough information to identify the account or request and to verify that the request is made by the relevant person or an authorized representative.

## 13. Changes to this policy

PersAI may update this Privacy Policy from time to time. The latest published version is the active version unless a later effective date is explicitly stated.`
  },
  {
    slug: "requisites",
    market: "intl",
    locale: "en",
    status: "published",
    title: "Company Details",
    version: null,
    bodyMarkdown: `# Company Details

Public company / operator information for PersAI.

## Operator details

- Service operator: Individual Entrepreneur Alexey Sergeevich Karnaukh
- Short name: IE Alexey S. Karnaukh
- Tax ID: 615010297306
- State registration number: 317619600160244
- OKPO: 0162898673
- Registration date: 2017-08-18
- Location: Rostov Region, Rostov-on-Don, Russian Federation
- SMB category: microenterprise
- Main activity: OKVED 62.09 - other information-technology and computer-related activities

## Contacts

- Support / legal / privacy email: support@persai.dev
- Service: PersAI
- Service model: SaaS access and related digital AI features

## Recommended commercial additions before broad launch

For a fully polished B2B-facing requisites page, PersAI should additionally publish:

- a full postal correspondence address;
- bank account details for invoice-based payments, if relevant;
- formal business-hours wording for handling claims and legal notices.`
  },
  {
    slug: "contacts",
    market: "intl",
    locale: "en",
    status: "published",
    title: "Contacts",
    version: null,
    bodyMarkdown: `# Contacts

Use the following contact channel for PersAI matters.

## Main contact

- Support, legal, privacy, and billing email: support@persai.dev

## What you can contact PersAI about

- account access, subscriptions, payments, and refunds;
- bugs, incidents, failed deliveries, and product support;
- privacy and personal-data requests;
- legal notices, complaints, or business inquiries.

## Helpful details to include

To speed up handling, include:

- the email address tied to your account;
- a short description of the issue;
- any relevant payment reference, document link, or workspace context.

Electronic requests can be sent at any time. PersAI responds within a reasonable time considering the nature and complexity of the request.`
  }
];
