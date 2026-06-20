/** Russian UI copy — single source for user-facing strings. */
export const ui = {
  appTitle: 'GeoIP Analytics (данные Главного радиочастотного центра России)',
  nav: {
    dashboard: 'Панель',
    table: 'Таблица',
    lookup: 'IP Lookup',
    admin: 'Admin',
  },
  browse: {
    cityTab: 'City blocks',
    countryTab: 'Country blocks',
    resetFilters: 'Сбросить фильтры',
    slowSortBanner:
      'Сортировка по стране или городу на полной таблице (~20M строк) может занимать несколько секунд. Добавьте фильтр ISO страны = RU для ускорения до миллисекунд.',
    slowSortBannerCountry:
      'Сортировка по стране на полной таблице может занимать несколько секунд. Добавьте фильтр ISO страны = RU для ускорения.',
    ruPartialSortOverrideBanner:
      'На RU-подвыборке (~10M строк) сортировка по стране выполняется по полю Network — в partial MV нет rank-колонки country_name.',
    offsetOnlySortBanner:
      'При текущей сортировке прокрутка ограничена (OFFSET). Для быстрой навигации используйте сортировку по Network, Country или City.',
    estimatedCountBanner:
      'При ASN-фильтре точное число строк не считается — внизу таблицы показана оценка. Уточните другие фильтры для exact count.',
    facetSampleBanner:
      '≈ Счётчики из выборки — приблизительные. Уточните фильтры для точных facet counts.',
    noResultsFound: 'Ничего не найдено. Измените фильтры или сбросьте их.',
    facetSampleTimedOut:
      'Выборка ограничена по времени — показаны частичные результаты. Уточните фильтры или поиск.',
  },
  filters: {
    network: 'Network',
    prefix_len: 'Prefix',
    country_iso_code: 'ISO страны',
    country_name: 'Country',
    city_name: 'City',
    subdivision_1_name: 'Region',
    asn: 'ASN',
    asn_org: 'ASN Org',
  },
  dashboard: {
    systemStatus: 'Статус системы',
    activeDataset: 'Активный датасет',
    dataVolume: 'Объем данных',
    recentImports: 'Последние импорты',
    importBenchmark: 'Benchmark последнего импорта',
    importDetail: 'Детали импорта',
    statusReady: 'Готово',
    statusDegraded: 'Деградировано',
    statusNotReady: 'Не готово',
    activated: 'Активирован',
    mvStatus: 'Статус MV',
    fingerprint: 'Fingerprint',
    activeImport: 'Активный import',
    nextImport: 'Следующий import',
    cityBlocks: 'City blocks',
    cityLocations: 'City locations',
    ruCityBlocks: 'RU city blocks',
    asnBlocks: 'ASN blocks',
    ipv4Addresses: 'IPv4 addresses',
    checkDb: 'БД',
    checkDataset: 'Датасет',
    checkMv: 'MV',
    checkIndexes: 'Индексы',
    checkAsn: 'ASN mapping',
    colId: 'ID',
    colDate: 'Дата',
    colStatus: 'Статус',
    colTrigger: 'Источник',
    colWall: 'Wall',
    colStarted: 'Начало',
    colStep: 'Шаг',
    colDuration: 'Длительность',
    colRows: 'Строки',
    colDetails: 'Детали',
    viewSteps: 'Шаги',
    hideSteps: 'Скрыть',
    wallTime: 'Wall',
    runId: 'run',
  },
  setup: {
    title: 'Настройка системы',
    optional: 'опционально',
    openStep: 'Настроить',
    allBlockingDone: 'Обязательные шаги выполнены — система готова к работе.',
    grchcHelpTitle: 'Как получить доступ к ЛК ГРЧЦ',
    grchcHelpBody:
      'Зарегистрируйтесь на сайте ГРЧЦ и получите учётные данные личного кабинета GeoIP. Укажите email и пароль здесь, сохраните, нажмите «Проверить ГРЧЦ», затем «Импортировать датасет» на вкладке Обзор.',
    mapsHelpTitle: 'Google Maps Embed API',
    mapsHelpBody:
      'Создайте ключ в Google Cloud Console с включённым Maps Embed API. Ограничьте ключ по HTTP referrer вашего домена. Ключ подхватывается без пересборки web.',
    mapsConfigureLink: 'Настроить в Admin → Интеграции',
    grchcSavedGoImport:
      'Учётные данные ГРЧЦ сохранены. Следующий шаг — «Импортировать датасет» на этой странице.',
  },
  datasetBadge: 'Датасет',
  admin: {
    title: 'Администрирование',
    loginTitle: 'Вход в Admin',
    setupTitle: 'Первичная настройка Admin',
    setupHint: 'Задайте локальный логин и пароль администратора. Доступ дополнительно защищён NPM Access List.',
    loginAction: 'Войти',
    setupAction: 'Создать admin',
    logout: 'Выйти',
    loading: 'Загрузка настроек…',
    saved: 'Настройки сохранены',
    saveSection: 'Сохранить секцию',
    testGrchc: 'Проверить ГРЧЦ',
    triggerImport: 'Импортировать датасет',
    importQueued: 'Импорт датасета поставлен в очередь',
    username: 'Логин',
    password: 'Пароль',
    newPassword: 'Новый пароль',
    currentPassword: 'Текущий пароль',
    confirmPassword: 'Подтверждение пароля',
    sessionUser: 'Admin',
    updatedAt: 'Обновлено',
    importTime: 'Время ежедневного import',
    overviewHint: 'Статус локального config store и быстрые операции.',
    reloadHints: 'Поля, требующие перезапуска сервисов',
    infraHint: 'Параметры инфраструктуры (Postgres, compose) меняются через Portainer и не хранятся в admin store.',
    sections: {
      overview: 'Обзор',
      grchc: 'ГРЧЦ / Import',
      api: 'API и безопасность',
      adminAccess: 'Admin доступ',
      export: 'Export',
      performance: 'Производительность',
      integrations: 'Интеграции',
      logging: 'Логирование и backup',
      infra: 'Инфраструктура',
    },
  },
} as const;

export function importStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: 'в очереди',
    running: 'выполняется',
    validating: 'валидация',
    swapping: 'swap',
    refreshing_mv: 'обновление MV',
    succeeded: 'успех',
    failed: 'ошибка',
  };
  return labels[status] ?? status;
}

export function importTriggerLabel(trigger: string): string {
  const labels: Record<string, string> = {
    manual: 'вручную',
    cron: 'cron',
    api: 'API',
  };
  return labels[trigger] ?? trigger;
}
