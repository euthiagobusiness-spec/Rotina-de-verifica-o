import type { OperationalActivity, OperationalTask, OperationalVerification } from "./types";

export const OPERATIONAL_TASK_TITLES = [
  "Verificar alertas da Stays",
  "Conferir status dos canais: Airbnb, Booking, Expedia e Decolar",
  "Verificar calendário dos próximos 30 dias",
  "Responder mensagens pendentes",
  "Revisar preços dos próximos 14 dias",
  "acompanhar preço do mercado.",
  "Verificar imóveis sem procura",
  "Registrar ação tomada no dia",
];

export function createInitialTasks(): OperationalTask[] {
  return OPERATIONAL_TASK_TITLES.map((title, index) => ({
    id: `task-${index + 1}`,
    title,
    status: "pending",
    note: "",
    actionTaken: "",
    relatedItem: "",
    elapsedSeconds: 0,
    timerStartedAt: null,
    completedAt: null,
    problemNotifiedAt: null,
  }));
}

export function reconcileTasks(tasks: OperationalTask[]) {
  const initialTasks = createInitialTasks();

  return initialTasks.map((task) => {
    const existingTask = tasks.find((item) => item.title === task.title);

    if (!existingTask) return task;

    return {
      ...task,
      ...existingTask,
      id: task.id,
      title: task.title,
    };
  });
}

export function createActivity(
  type: OperationalActivity["type"],
  message: string,
  createdAt = new Date().toISOString(),
): OperationalActivity {
  return {
    id: `${type}-${createdAt}-${crypto.randomUUID()}`,
    type,
    message,
    createdAt,
  };
}

export function createVerification(date = toDateKey(new Date())): OperationalVerification {
  return {
    id: `verification-${date}`,
    date,
    status: "not_started",
    responsible: "Administrador",
    startedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    timerStartedAt: null,
    lastSavedAt: null,
    tasks: createInitialTasks(),
    activities: [],
  };
}

export function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatSeconds(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

export function getLiveElapsed(elapsedSeconds: number, startedAt: string | null, now = Date.now()) {
  if (!startedAt) return elapsedSeconds;

  return elapsedSeconds + Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

export function getVerificationStats(verification: OperationalVerification, now = Date.now()) {
  const completed = verification.tasks.filter((task) => task.status === "completed").length;
  const problems = verification.tasks.filter((task) => task.status === "problem").length;
  const pending = verification.tasks.filter((task) => task.status === "pending").length;
  const inProgress = verification.tasks.filter((task) => task.status === "in_progress").length;
  const progress = Math.round((completed / verification.tasks.length) * 100);

  return {
    completed,
    problems,
    pending,
    inProgress,
    progress,
    totalElapsed: getLiveElapsed(
      verification.elapsedSeconds,
      verification.status === "in_progress" ? verification.timerStartedAt : null,
      now,
    ),
  };
}
