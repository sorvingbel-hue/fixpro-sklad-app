// Модель данных библиотеки установок.
//
// Сценарий = одна типовая установка (например, «Closet: новая печь, старый coil»).
// Он разбит на этапы (phases); в каждом этапе — шаги, точки остановки (hold points)
// и что сфотографировать. Ссылки на источники пишутся прямо в тексте: «… [Н15]».

// Кто составил текст сценария:
// «черновик ИИ» — собрано ИИ по источникам, ждёт диктовки Георгия;
// «надиктовано Георгием» — шаги из практики Георгия;
// «проверено» — сверено с источниками и мануалами после диктовки.
export type ScenarioStatus = 'черновик ИИ' | 'надиктовано Георгием' | 'проверено';

export type Source = {
  id: string;              // номер из исследования: Н1, М3, С7, П16 …
  title: string;
  url: string;
  checked: string | null;  // дата проверки ссылки (ГГГГ-ММ-ДД); null — не открылась или не проверена
  alsoUrls?: string[];     // если у источника несколько страниц
};

export type Phase = {
  name: string;
  steps: string[];         // короткие организационные шаги, без универсальных чисел
  holdPoints: string[];    // точки остановки: дальше не идём, пока не выяснено
  photos: string[];        // что сфотографировать на этом этапе
};

export type Scenario = {
  id: string;              // S01 … S16
  title: string;
  cluster: string;         // id группы из CLUSTERS
  summary: string;         // одна-две фразы: что это за работа
  phases: Phase[];
  commonMistakes: string[];
  askGeorgy: string[];     // что Георгию надиктовать или уточнить
  sources: Source[];       // собираются автоматически из ссылок в тексте
  status: ScenarioStatus;
  updated: string;         // дата последней правки содержания (ГГГГ-ММ-ДД)
};

export type Cluster = { id: string; title: string; hint: string };

// Пункт чек-листа (шаг, точка остановки или фото) с устойчивым ключом для сохранения отметок
export type CheckKind = 'step' | 'hold' | 'photo';
export type CheckItem = { key: string; kind: CheckKind; text: string };
