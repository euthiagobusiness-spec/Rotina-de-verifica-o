"use client";

import Image from "next/image";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Cloud,
  FileText,
  Mail,
  Pause,
  Play,
  Save,
  Settings,
  Square,
  UserCircle2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createActivity,
  createVerification,
  formatSeconds,
  getLiveElapsed,
  getVerificationStats,
  reconcileTasks,
  toDateKey,
} from "@/lib/operational-verification/tasks";
import type {
  OperationalActivity,
  OperationalEmailEvent,
  OperationalHistoryFile,
  OperationalTask,
  OperationalVerification,
  TaskStatus,
} from "@/lib/operational-verification/types";

const LOCAL_STORAGE_KEY = "mv2-operational-verification-current";
const LOCAL_HISTORY_KEY = "mv2-operational-verification-history";
const BRAND_LOGO = "/uploads/brand/logo-mv2-em-vetor-moderno.png";

type ViewMode = "daily" | "history" | "reports" | "settings";

const statusLabels: Record<TaskStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluída",
  problem: "Problema encontrado",
};

const verificationStatusLabels: Record<OperationalVerification["status"], string> = {
  not_started: "Não iniciada",
  in_progress: "Em andamento",
  completed: "Concluída",
};

export function OperationalVerificationApp() {
  const [view, setView] = useState<ViewMode>("daily");
  const [now, setNow] = useState(() => Date.now());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("Progresso salvo automaticamente a cada 30 segundos.");
  const [history, setHistory] = useState<OperationalVerification[]>([]);
  const [verification, setVerification] = useState<OperationalVerification>(() =>
    createVerification(),
  );
  const verificationRef = useRef(verification);

  const updateVerification = useCallback((next: OperationalVerification) => {
    verificationRef.current = next;
    setVerification(next);
  }, []);

  const updateLocalHistory = useCallback((next: OperationalVerification) => {
    setHistory((current) => {
      const merged = mergeHistory([next], current);
      window.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(merged));
      return merged;
    });
  }, []);

  const persistVerification = useCallback(
    async (input: OperationalVerification, showFeedback: boolean) => {
      const next = {
        ...input,
        lastSavedAt: new Date().toISOString(),
      };

      setIsSaving(true);
      updateVerification(next);
      updateLocalHistory(next);

      try {
        const response = await fetch("/api/operational-verifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });

        if (!response.ok) throw new Error("Falha ao salvar no servidor.");

        const data = (await response.json()) as { verification: OperationalVerification };
        updateLocalHistory(data.verification);
        if (showFeedback) setNotice("Progresso salvo com sucesso.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? `${error.message} Progresso mantido neste navegador.`
            : "Progresso mantido neste navegador.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [updateLocalHistory, updateVerification],
  );

  useEffect(() => {
    verificationRef.current = verification;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(verification));
  }, [verification]);

  useEffect(() => {
    window.queueMicrotask(() => {
      const localVerification = loadCurrentVerification();
      const localHistory = loadLocalHistory();

      updateVerification(localVerification);
      setHistory(localHistory);

      fetch("/api/operational-verifications")
        .then((response) => (response.ok ? response.json() : null))
        .then((data: OperationalHistoryFile | null) => {
          if (data?.verifications?.length) {
            setHistory(mergeHistory(data.verifications, localHistory));
          }
        })
        .catch(() => {
          setNotice("Histórico local carregado. API indisponível no momento.");
        });
    });
  }, [updateVerification]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void persistVerification(verificationRef.current, false);
    }, 30000);

    return () => window.clearInterval(interval);
  }, [persistVerification]);

  const stats = useMemo(
    () => getVerificationStats(verification, now),
    [verification, now],
  );
  const selectedTask = verification.tasks.find((task) => task.id === selectedTaskId) ?? null;

  async function notify(event: OperationalEmailEvent, input: OperationalVerification, taskId?: string) {
    updateLocalHistory(input);

    try {
      const response = await fetch("/api/operational-verifications/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, verification: input, taskId }),
      });
      const data = (await response.json()) as {
        verification?: OperationalVerification;
        email?: { ok: boolean; skipped: boolean; error?: string };
        message?: string;
      };

      if (data.verification) updateLocalHistory(data.verification);
      if (data.email?.ok) setNotice("E-mail enviado e progresso salvo.");
      else if (data.email?.skipped) setNotice("Progresso salvo. Configure SMTP para enviar e-mails.");
      else setNotice(data.message ?? "Progresso salvo, mas o e-mail falhou.");
    } catch {
      setNotice("Progresso salvo localmente, mas não foi possível enviar e-mail agora.");
    }
  }

  function startVerification() {
    const current = verificationRef.current;
    if (current.status === "completed") {
      const confirmed = window.confirm(
        "A verificação de hoje já foi concluída. Deseja reabrir para ajustes?",
      );
      if (!confirmed) return;
    }

    const startedAt = current.startedAt ?? new Date().toISOString();
    const next = {
      ...current,
      status: "in_progress" as const,
      startedAt,
      finishedAt: null,
      timerStartedAt: current.timerStartedAt ?? new Date().toISOString(),
      activities: addActivity(
        current.activities,
        createActivity("started", "Verificação iniciada"),
      ),
    };

    updateVerification(next);
    void notify("started", next);
  }

  function finishVerification() {
    const current = verificationRef.current;
    const finishedAt = new Date().toISOString();
    const finishedAtMs = new Date(finishedAt).getTime();
    const nextTasks = current.tasks.map((task) => stopTaskTimer(task, finishedAt));
    const next = {
      ...current,
      status: "completed" as const,
      finishedAt,
      timerStartedAt: null,
      elapsedSeconds: getLiveElapsed(current.elapsedSeconds, current.timerStartedAt, finishedAtMs),
      tasks: nextTasks,
      activities: addActivity(
        current.activities,
        createActivity("completed", "Verificação encerrada"),
      ),
    };

    updateVerification(next);
    void notify("completed", next);
  }

  function saveProgress() {
    const current = verificationRef.current;
    const next = {
      ...current,
      activities: addActivity(
        current.activities,
        createActivity("saved", "Progresso salvo manualmente"),
      ),
    };

    updateVerification(next);
    void persistVerification(next, true);
  }

  function setTaskStatus(taskId: string, status: TaskStatus) {
    const current = verificationRef.current;
    let shouldNotifyProblem = false;
    const timestamp = new Date().toISOString();
    const nextTasks = current.tasks.map((task) => {
      if (task.id !== taskId) return task;

      if (status === "in_progress") {
        return {
          ...task,
          status,
          timerStartedAt: task.timerStartedAt ?? timestamp,
          completedAt: null,
        };
      }

      if (status === "completed") {
        return {
          ...stopTaskTimer(task, timestamp),
          status,
          completedAt: timestamp,
        };
      }

      if (status === "problem") {
        shouldNotifyProblem = !task.problemNotifiedAt;
        return {
          ...stopTaskTimer(task, timestamp),
          status,
          problemNotifiedAt: task.problemNotifiedAt ?? timestamp,
        };
      }

      return {
        ...stopTaskTimer(task, timestamp),
        status,
        completedAt: null,
      };
    });
    const next = ensureVerificationRunning({
      ...current,
      tasks: nextTasks,
      activities: addTaskActivity(current.activities, taskId, status, nextTasks),
    });

    updateVerification(next);
    if (shouldNotifyProblem) void notify("problem", next, taskId);
  }

  function updateTaskField(
    taskId: string,
    field: "note" | "actionTaken" | "relatedItem",
    value: string,
  ) {
    const current = verificationRef.current;
    const next = {
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId ? { ...task, [field]: value.slice(0, 280) } : task,
      ),
    };

    updateVerification(next);
  }

  function pauseTask(taskId: string) {
    const current = verificationRef.current;
    const timestamp = new Date().toISOString();
    const next = {
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId ? stopTaskTimer(task, timestamp) : task,
      ),
    };

    updateVerification(next);
  }

  function startTask(taskId: string) {
    setTaskStatus(taskId, "in_progress");
  }

  function completeTask(taskId: string) {
    setTaskStatus(taskId, "completed");
  }

  return (
    <div className="min-h-screen bg-[#f7fbff] text-[#081a33] lg:grid lg:grid-cols-[286px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-[#102b45] text-white lg:min-h-screen">
        <div className="flex items-center gap-3 border-b border-white/5 px-6 py-8">
          <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-lg bg-white">
            <Image alt="MV2" height={34} priority src={BRAND_LOGO} width={34} />
          </div>
          <div>
            <p className="text-[1.02rem] font-black leading-tight">Verificação</p>
            <p className="text-[1.02rem] font-black leading-tight">Operacional</p>
          </div>
        </div>

        <nav className="grid gap-2 px-4 py-5">
          <SidebarButton
            active={view === "daily"}
            icon={<CheckCircle2 size={22} />}
            label="Verificação Diária"
            onClick={() => setView("daily")}
          />
          <SidebarButton
            active={view === "history"}
            icon={<CalendarDays size={22} />}
            label="Histórico"
            onClick={() => setView("history")}
          />
          <SidebarButton
            active={view === "reports"}
            icon={<FileText size={22} />}
            label="Relatórios"
            onClick={() => setView("reports")}
          />
          <SidebarButton
            active={view === "settings"}
            icon={<Settings size={22} />}
            label="Configurações"
            onClick={() => setView("settings")}
          />
        </nav>

        <div className="mt-auto grid gap-4 p-4">
          <div className="rounded-lg border border-white/12 bg-white/[0.04] p-4">
            <div className="flex items-center gap-3">
              <Building2 size={25} />
              <div>
                <p className="text-sm font-black">9 Apartamentos</p>
                <p className="mt-1 text-xs text-slate-200">Maranduba / Ubatuba - SP</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-slate-500">
                <UserCircle2 size={38} />
              </div>
              <div>
                <p className="text-sm font-black">{verification.responsible}</p>
                <p className="mt-1 text-xs text-slate-200">admin@email.com</p>
              </div>
            </div>
            <ChevronDown size={18} />
          </div>
        </div>
      </aside>

      <main className="min-w-0 px-5 py-7 lg:px-8">
        {view === "daily" ? (
          <DailyView
            finishVerification={finishVerification}
            isSaving={isSaving}
            notice={notice}
            now={now}
            pauseTask={pauseTask}
            saveProgress={saveProgress}
            selectedTask={selectedTask}
            selectedTaskId={selectedTaskId}
            setSelectedTaskId={setSelectedTaskId}
            setTaskStatus={setTaskStatus}
            startTask={startTask}
            startVerification={startVerification}
            stats={stats}
            updateTaskField={updateTaskField}
            completeTask={completeTask}
            verification={verification}
          />
        ) : null}

        {view === "history" ? <HistoryView history={history} /> : null}
        {view === "reports" ? <ReportsView history={history} verification={verification} /> : null}
        {view === "settings" ? <SettingsView /> : null}
      </main>
    </div>
  );
}

function DailyView({
  verification,
  stats,
  now,
  notice,
  isSaving,
  selectedTaskId,
  selectedTask,
  setSelectedTaskId,
  startVerification,
  finishVerification,
  saveProgress,
  setTaskStatus,
  pauseTask,
  startTask,
  completeTask,
  updateTaskField,
}: {
  verification: OperationalVerification;
  stats: ReturnType<typeof getVerificationStats>;
  now: number;
  notice: string;
  isSaving: boolean;
  selectedTaskId: string | null;
  selectedTask: OperationalTask | null;
  setSelectedTaskId: (taskId: string | null) => void;
  startVerification: () => void;
  finishVerification: () => void;
  saveProgress: () => void;
  setTaskStatus: (taskId: string, status: TaskStatus) => void;
  pauseTask: (taskId: string) => void;
  startTask: (taskId: string) => void;
  completeTask: (taskId: string) => void;
  updateTaskField: (
    taskId: string,
    field: "note" | "actionTaken" | "relatedItem",
    value: string,
  ) => void;
}) {
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-[0] text-[#081a33]">Verificação Diária</h1>
          <p className="mt-2 text-lg font-semibold text-[#526985]">{formatLongDate(verification.date)}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="inline-flex h-14 items-center gap-3 rounded-lg border border-[#cfdbea] bg-white px-6 text-sm font-black text-[#1b3658] shadow-sm"
            disabled={isSaving}
            onClick={saveProgress}
            type="button"
          >
            <Save size={22} />
            {isSaving ? "Salvando..." : "Salvar progresso"}
          </button>
          <button
            className="inline-flex h-14 items-center gap-3 rounded-lg border border-red-300 bg-white px-6 text-sm font-black text-red-600 shadow-sm"
            onClick={finishVerification}
            type="button"
          >
            <Square size={20} />
            Encerrar verificação
          </button>
        </div>
      </div>

      <section className="grid gap-5 rounded-lg border border-[#d8e2ef] bg-white p-4 shadow-sm xl:grid-cols-[1fr_1fr_1.6fr_280px] xl:items-center xl:p-5">
        <MetricPanel label="Status geral">
          <div className="flex items-center gap-5">
            <span className="rounded-full bg-[#e8f3ff] px-5 py-3 text-base font-black text-[#0061c9]">
              {verificationStatusLabels[verification.status]}
            </span>
            {verification.status === "in_progress" ? (
              <span className="h-7 w-7 animate-spin rounded-full border-4 border-[#62c8ff] border-r-transparent" />
            ) : null}
          </div>
        </MetricPanel>
        <MetricPanel label="Tempo total">
          <div className="flex items-center gap-4">
            <Clock3 className="text-[#526985]" size={28} />
            <div>
              <p className="font-mono text-3xl font-black text-[#081a33]">
                {formatSeconds(stats.totalElapsed)}
              </p>
              <p className="mt-1 text-sm font-black text-[#0067dc]">Ver detalhes</p>
            </div>
          </div>
        </MetricPanel>
        <MetricPanel label="Progresso">
          <div className="grid gap-2">
            <div className="flex items-center gap-7">
              <p className="text-3xl font-black">{stats.progress}%</p>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#edf1f7]">
                <div
                  className="h-full rounded-full bg-[#006fe7]"
                  style={{ width: `${stats.progress}%` }}
                />
              </div>
            </div>
            <p className="text-sm font-semibold text-[#526985]">
              {stats.completed} de {verification.tasks.length} tarefas concluídas
            </p>
          </div>
        </MetricPanel>
        <button
          className="inline-flex h-[72px] items-center justify-center gap-3 rounded-lg bg-[#066ee8] px-7 text-lg font-black text-white shadow-[0_14px_30px_rgba(0,103,220,0.2)] transition hover:bg-[#005ec7]"
          onClick={startVerification}
          type="button"
        >
          <Play size={23} />
          Iniciar verificação
        </button>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_374px]">
        <section className="overflow-hidden rounded-lg border border-[#d8e2ef] bg-white shadow-sm">
          <div className="grid grid-cols-[64px_minmax(260px,1fr)_225px_135px_128px] border-b border-[#e6edf5] px-5 py-4 text-sm font-black">
            <span />
            <span>Tarefa</span>
            <span>Status</span>
            <span>Tempo</span>
            <span>Ações</span>
          </div>
          <div>
            {verification.tasks.map((task, index) => {
              const isSelected = selectedTaskId === task.id;
              const taskElapsed = getLiveElapsed(task.elapsedSeconds, task.timerStartedAt, now);
              return (
                <div className="border-b border-[#e6edf5] last:border-b-0" key={task.id}>
                  <div
                    className="grid w-full cursor-pointer grid-cols-[64px_minmax(260px,1fr)_225px_135px_128px] items-center px-5 py-4 text-left transition hover:bg-[#f8fbff]"
                    onClick={() => setSelectedTaskId(isSelected ? null : task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTaskId(isSelected ? null : task.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-[#cad8e8] text-sm font-bold text-[#405773]">
                      {index + 1}
                    </span>
                    <span className="pr-5 text-base font-semibold leading-relaxed text-[#081a33]">
                      {task.title}
                    </span>
                    <span onClick={(event) => event.stopPropagation()}>
                      <StatusSelect
                        onChange={(value) => setTaskStatus(task.id, value)}
                        status={task.status}
                      />
                    </span>
                    <span className="font-mono text-sm font-semibold">{formatSeconds(taskElapsed)}</span>
                    <span
                      className="flex items-center gap-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {task.status === "completed" ? (
                        <ActionIcon
                          label="Concluída"
                          tone="success"
                          onClick={() => setTaskStatus(task.id, "pending")}
                        >
                          <Check size={20} />
                        </ActionIcon>
                      ) : null}
                      {task.timerStartedAt ? (
                        <ActionIcon
                          label="Pausar tarefa"
                          tone="primary"
                          onClick={() => pauseTask(task.id)}
                        >
                          <Pause size={18} />
                        </ActionIcon>
                      ) : task.status !== "completed" ? (
                        <ActionIcon
                          label="Iniciar tarefa"
                          tone="primary"
                          onClick={() => startTask(task.id)}
                        >
                          <Play size={18} />
                        </ActionIcon>
                      ) : null}
                      {task.status !== "completed" ? (
                        <ActionIcon
                          label="Concluir tarefa"
                          tone="muted"
                          onClick={() => completeTask(task.id)}
                        >
                          <Square size={17} />
                        </ActionIcon>
                      ) : null}
                    </span>
                  </div>
                  {isSelected ? (
                    <TaskDetails
                      task={task}
                      updateTaskField={updateTaskField}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="grid content-start gap-6">
          <SummaryCard
            stats={stats}
            verification={verification}
          />
          <ActivityCard activities={verification.activities} />
        </aside>
      </div>

      <div className="flex items-center gap-3 text-sm font-semibold text-[#526985]">
        <Cloud className="text-[#006fe7]" size={24} />
        {notice}
      </div>

      {selectedTask ? (
        <p className="sr-only">Tarefa selecionada: {selectedTask.title}</p>
      ) : null}
    </div>
  );
}

function SidebarButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "flex h-14 items-center gap-4 rounded-lg px-4 text-left text-base font-black transition",
        active
          ? "bg-[#0d5bb0] text-[#55b9ff] shadow-[inset_0_0_30px_rgba(45,140,255,0.2)]"
          : "text-white hover:bg-white/8",
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function MetricPanel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-24 border-[#d8e2ef] xl:border-r xl:px-3">
      <p className="mb-3 text-sm font-bold text-[#405773]">{label}</p>
      {children}
    </div>
  );
}

function StatusSelect({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
}) {
  const tone = {
    pending: "border-[#cfdbea] text-[#1b3658]",
    in_progress: "border-[#b9d8ff] bg-[#f7fbff] text-[#0067dc]",
    completed: "border-[#b8e0c8] bg-[#fbfffc] text-[#0d933d]",
    problem: "border-[#ffd47d] bg-[#fffaf0] text-[#dd8a00]",
  }[status];

  return (
    <select
      className={`h-10 w-[196px] rounded-md border bg-white px-3 text-sm font-black outline-none ${tone}`}
      onChange={(event) => onChange(event.target.value as TaskStatus)}
      value={status}
    >
      <option value="pending">{statusLabels.pending}</option>
      <option value="in_progress">{statusLabels.in_progress}</option>
      <option value="completed">{statusLabels.completed}</option>
      <option value="problem">{statusLabels.problem}</option>
    </select>
  );
}

function ActionIcon({
  children,
  label,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  tone: "primary" | "success" | "muted";
  onClick: () => void;
}) {
  const toneClass = {
    primary: "border-[#006fe7] text-[#006fe7]",
    success: "border-[#23a756] bg-[#23a756] text-white",
    muted: "border-[#cbd8e6] bg-[#f8fbff] text-[#60758d]",
  }[tone];

  return (
    <button
      aria-label={label}
      className={`grid h-9 w-9 place-items-center rounded-full border-2 ${toneClass}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function TaskDetails({
  task,
  updateTaskField,
}: {
  task: OperationalTask;
  updateTaskField: (
    taskId: string,
    field: "note" | "actionTaken" | "relatedItem",
    value: string,
  ) => void;
}) {
  return (
    <div className="grid gap-4 bg-[#f8fbff] px-6 pb-5 pt-1 md:grid-cols-3">
      <label className="grid gap-2 text-sm font-black text-[#405773]">
        Observação
        <input
          className="h-11 rounded-md border border-[#cfdbea] bg-white px-3 text-sm font-semibold text-[#081a33] outline-none focus:border-[#006fe7]"
          onChange={(event) => updateTaskField(task.id, "note", event.target.value)}
          value={task.note}
        />
      </label>
      <label className="grid gap-2 text-sm font-black text-[#405773]">
        Ação tomada
        <input
          className="h-11 rounded-md border border-[#cfdbea] bg-white px-3 text-sm font-semibold text-[#081a33] outline-none focus:border-[#006fe7]"
          onChange={(event) => updateTaskField(task.id, "actionTaken", event.target.value)}
          value={task.actionTaken}
        />
      </label>
      <label className="grid gap-2 text-sm font-black text-[#405773]">
        Valor, canal ou imóvel
        <input
          className="h-11 rounded-md border border-[#cfdbea] bg-white px-3 text-sm font-semibold text-[#081a33] outline-none focus:border-[#006fe7]"
          onChange={(event) => updateTaskField(task.id, "relatedItem", event.target.value)}
          value={task.relatedItem}
        />
      </label>
    </div>
  );
}

function SummaryCard({
  verification,
  stats,
}: {
  verification: OperationalVerification;
  stats: ReturnType<typeof getVerificationStats>;
}) {
  const rows = [
    {
      icon: <Play size={18} />,
      label: "Início",
      value: verification.startedAt ? formatShortDateTime(verification.startedAt) : "--",
      tone: "text-[#426185]",
    },
    {
      icon: <Clock3 size={18} />,
      label: "Tempo decorrido",
      value: formatSeconds(stats.totalElapsed),
      tone: "text-[#426185]",
    },
    {
      icon: <CheckCircle2 size={18} />,
      label: "Tarefas concluídas",
      value: String(stats.completed),
      tone: "text-[#2fac61]",
    },
    {
      icon: <AlertTriangle size={18} />,
      label: "Problemas encontrados",
      value: String(stats.problems),
      tone: "text-[#f39b08]",
    },
    {
      icon: <Circle size={18} />,
      label: "Pendentes",
      value: String(stats.pending),
      tone: "text-[#8ba0b7]",
    },
  ];

  return (
    <section className="rounded-lg border border-[#d8e2ef] bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black">Resumo do dia</h2>
      <div className="mt-6 grid gap-6">
        {rows.map((row) => (
          <div className="grid grid-cols-[26px_1fr_auto] items-center gap-3" key={row.label}>
            <span className={row.tone}>{row.icon}</span>
            <span className="font-semibold">{row.label}</span>
            <span className="font-mono text-sm font-semibold text-[#526985]">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivityCard({ activities }: { activities: OperationalActivity[] }) {
  const latest = activities.slice(0, 3);

  return (
    <section className="rounded-lg border border-[#d8e2ef] bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black">Última atividade</h2>
      <div className="mt-6 grid gap-4">
        {latest.length ? (
          latest.map((activity) => (
            <div
              className="grid grid-cols-[26px_1fr_auto] gap-3 border-b border-[#e6edf5] pb-4 last:border-b-0 last:pb-0"
              key={activity.id}
            >
              <span className={activity.type === "problem" ? "text-[#f39b08]" : "text-[#2fac61]"}>
                {activity.type === "problem" ? <AlertTriangle size={21} /> : <CheckCircle2 size={21} />}
              </span>
              <span className="text-sm font-semibold leading-relaxed text-[#1b3658]">
                {activity.message}
              </span>
              <span className="font-mono text-sm text-[#526985]">{formatTime(activity.createdAt)}</span>
            </div>
          ))
        ) : (
          <p className="text-sm font-semibold text-[#526985]">Nenhuma atividade registrada.</p>
        )}
      </div>
    </section>
  );
}

function HistoryView({ history }: { history: OperationalVerification[] }) {
  return (
    <section className="grid gap-5">
      <PageTitle title="Histórico" subtitle="Verificações operacionais salvas" />
      <div className="overflow-hidden rounded-lg border border-[#d8e2ef] bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_170px_170px_150px] border-b border-[#e6edf5] px-5 py-4 text-sm font-black">
          <span>Data</span>
          <span>Status</span>
          <span>Tempo total</span>
          <span>Problemas</span>
        </div>
        {history.length ? (
          history.map((item) => {
            const stats = getVerificationStats(item);
            return (
              <div
                className="grid grid-cols-[1fr_170px_170px_150px] border-b border-[#e6edf5] px-5 py-4 last:border-b-0"
                key={item.id}
              >
                <span className="font-black">{formatLongDate(item.date)}</span>
                <span>{verificationStatusLabels[item.status]}</span>
                <span className="font-mono">{formatSeconds(stats.totalElapsed)}</span>
                <span>{stats.problems}</span>
              </div>
            );
          })
        ) : (
          <p className="px-5 py-8 text-sm font-semibold text-[#526985]">
            Nenhuma verificação salva ainda.
          </p>
        )}
      </div>
    </section>
  );
}

function ReportsView({
  history,
  verification,
}: {
  history: OperationalVerification[];
  verification: OperationalVerification;
}) {
  const completedHistory = history.filter((item) => item.status === "completed");
  const problemCount = history.reduce(
    (total, item) => total + item.tasks.filter((task) => task.status === "problem").length,
    0,
  );
  const currentStats = getVerificationStats(verification);

  return (
    <section className="grid gap-5">
      <PageTitle title="Relatórios" subtitle="Resumo operacional consolidado" />
      <div className="grid gap-4 md:grid-cols-3">
        <ReportCard label="Verificações concluídas" value={completedHistory.length} />
        <ReportCard label="Problemas registrados" value={problemCount} />
        <ReportCard label="Progresso de hoje" value={`${currentStats.progress}%`} />
      </div>
    </section>
  );
}

function SettingsView() {
  return (
    <section className="grid gap-5">
      <PageTitle title="Configurações" subtitle="Envio de e-mails operacionais" />
      <div className="rounded-lg border border-[#d8e2ef] bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <Mail className="mt-1 text-[#006fe7]" size={28} />
          <div>
            <h2 className="text-lg font-black">SMTP por variáveis de ambiente</h2>
            <div className="mt-4 grid gap-2 font-mono text-sm text-[#405773]">
              <span>SMTP_HOST</span>
              <span>SMTP_PORT</span>
              <span>SMTP_USER</span>
              <span>SMTP_PASS</span>
              <span>EMAIL_FROM</span>
              <span>EMAIL_TO</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-3xl font-black">{title}</h1>
      <p className="mt-2 text-lg font-semibold text-[#526985]">{subtitle}</p>
    </div>
  );
}

function ReportCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[#d8e2ef] bg-white p-6 shadow-sm">
      <p className="text-sm font-black text-[#526985]">{label}</p>
      <p className="mt-3 text-4xl font-black text-[#081a33]">{value}</p>
    </div>
  );
}

function loadCurrentVerification() {
  const today = toDateKey(new Date());

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return createVerification(today);
    const parsed = JSON.parse(raw) as OperationalVerification;
    if (parsed.date !== today) return createVerification(today);
    return {
      ...parsed,
      tasks: reconcileTasks(parsed.tasks),
    };
  } catch {
    return createVerification(today);
  }
}

function loadLocalHistory() {
  try {
    const raw = window.localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OperationalVerification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeHistory(
  incoming: OperationalVerification[],
  current: OperationalVerification[],
) {
  const map = new Map<string, OperationalVerification>();
  [...incoming, ...current].forEach((item) => map.set(item.id, item));
  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function stopTaskTimer(task: OperationalTask, timestamp: string) {
  if (!task.timerStartedAt) return task;

  return {
    ...task,
    elapsedSeconds: getLiveElapsed(
      task.elapsedSeconds,
      task.timerStartedAt,
      new Date(timestamp).getTime(),
    ),
    timerStartedAt: null,
  };
}

function ensureVerificationRunning(verification: OperationalVerification) {
  if (verification.status === "in_progress") return verification;

  const timestamp = new Date().toISOString();
  return {
    ...verification,
    status: "in_progress" as const,
    startedAt: verification.startedAt ?? timestamp,
    finishedAt: null,
    timerStartedAt: verification.timerStartedAt ?? timestamp,
    activities: addActivity(
      verification.activities,
      createActivity("started", "Verificação iniciada"),
    ),
  };
}

function addTaskActivity(
  activities: OperationalActivity[],
  taskId: string,
  status: TaskStatus,
  tasks: OperationalTask[],
) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return activities;
  if (status === "completed") {
    return addActivity(activities, createActivity("task_completed", `Concluída: ${task.title}`));
  }
  if (status === "problem") {
    return addActivity(activities, createActivity("problem", `Problema em: ${task.title}`));
  }
  return activities;
}

function addActivity(
  activities: OperationalActivity[],
  activity: OperationalActivity,
) {
  return [activity, ...activities].slice(0, 20);
}

function formatLongDate(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
