// Bitrix24 REST: поиск сотрудника по email и постановка задачи на обучение.
// Ключ webhook хранится только в секретах Edge Function.

type BitrixUser = { ID: string; NAME?: string; LAST_NAME?: string; EMAIL?: string };

const WEBHOOK = Deno.env.get('BITRIX_WEBHOOK_URL') ?? '';

function endpoint(method: string): string {
  if (!/^https:\/\/[a-z0-9.-]+\/rest\/\d+\/[A-Za-z0-9]+\/?$/i.test(WEBHOOK)) {
    throw new Error('BITRIX_WEBHOOK_URL не задан или имеет неверный формат');
  }
  return `${WEBHOOK.replace(/\/$/, '')}/${method}.json`;
}

async function call<T>(method: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Bitrix24 вернул не JSON (${response.status})`); }
  if (!response.ok || data?.error) throw new Error(`Bitrix24 ${method}: ${data?.error_description ?? data?.error ?? response.status}`);
  return data as T;
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const data = await call<{ result?: BitrixUser[] }>('user.get', { FILTER: { EMAIL: email }, SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL'] });
  const list = data.result ?? [];
  const exact = list.find((u) => (u.EMAIL ?? '').toLowerCase() === email.toLowerCase());
  return exact?.ID ?? null;
}

export type TaskInput = {
  title: string;
  description: string;
  responsibleId: string;
  deadline?: string | null;
  observerEmails: string[];
  courseUrl: string;
};

export type TaskResult = {
  taskId: string | null;
  responsibleId: string | null;
  observers: string[];
  warnings: string[];
};

export async function createTrainingTask(input: TaskInput): Promise<TaskResult> {
  const warnings: string[] = [];
  const responsibleId = await findUserIdByEmail(input.responsibleId);
  if (!responsibleId) {
    return { taskId: null, responsibleId: null, observers: [], warnings: [`Сотрудник ${input.responsibleId} не найден в Bitrix24 — задача не создана`] };
  }
  const observerIds: string[] = [];
  for (const email of input.observerEmails.filter(Boolean)) {
    const id = await findUserIdByEmail(email);
    if (id) observerIds.push(id);
    else warnings.push(`${email} не найден в Bitrix24 — наблюдатель не добавлен`);
  }
  const fields: Record<string, unknown> = {
    TITLE: input.title,
    DESCRIPTION: input.description,
    RESPONSIBLE_ID: responsibleId,
    AUDITORS: observerIds,
    TASK_CONTROL: 'Y',
  };
  if (input.deadline) fields.DEADLINE = input.deadline;
  const data = await call<{ result?: { task?: { id?: string | number } } }>('tasks.task.add', { fields });
  const taskId = data.result?.task?.id;
  return { taskId: taskId != null ? String(taskId) : null, responsibleId, observers: observerIds, warnings };
}

export function buildDescription(input: { fullName: string; courseTitle: string; moduleCount: number; progressUrl: string; dueDate: string | null }): string {
  return [
    `Курс: ${input.courseTitle}`,
    `Сотрудник: ${input.fullName}`,
    `Модулей: ${input.moduleCount}`,
    input.dueDate ? `Срок: ${input.dueDate}` : 'Срок не задан',
    '',
    `Прогресс обучения: ${input.progressUrl}`,
    '',
    'Ссылка открывает актуальный процент прохождения без входа в систему.',
  ].join('\n');
}
