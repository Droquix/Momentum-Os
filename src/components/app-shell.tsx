"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  CaptureParseResult,
  CaptureSource,
  DashboardSnapshot,
  FinanceEntryType,
  HabitCadence,
  MealCategory,
  Task,
  WorkoutIntensity
} from "@/lib/domain";
import { CaptureBox } from "@/components/capture-box";
import { TaskBoard } from "@/components/task-board";
import { calculatePriorityScore } from "@/lib/priority";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseConfig } from "@/lib/env";

interface AppShellProps {
  snapshot: DashboardSnapshot;
}

type AppView =
  | "overview"
  | "inbox"
  | "tasks"
  | "planning"
  | "focus"
  | "habits"
  | "workouts"
  | "meals"
  | "learning"
  | "finance"
  | "analytics"
  | "notes"
  | "assistant";

type SyncState = "local" | "syncing" | "synced" | "error";

interface AccountState {
  status: "loading" | "guest" | "signed_in";
  email?: string;
  fullName?: string;
  userId?: string;
}

interface AssistantMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
}

type AssistantAction =
  | {
      type: "add_task";
      title: string;
      description?: string;
      context?: "work" | "home" | "deep_work" | "errand" | "custom";
      energyLevel?: "low" | "medium" | "high";
      estimatedMinutes?: number;
      deadlineAt?: string;
      linkedGoalTitle?: string;
      linkedProjectTitle?: string;
      tags?: string[];
    }
  | {
      type: "add_habit";
      title: string;
      cadence?: "daily" | "weekly";
    }
  | {
      type: "add_goal";
      title: string;
      metricName?: string;
      targetValue?: number;
    }
  | {
      type: "add_project";
      title: string;
      goalTitle?: string;
      deadlineAt?: string;
    }
  | {
      type: "add_note";
      title: string;
      body?: string;
      tags?: string[];
    }
  | {
      type: "add_meal";
      title: string;
      category?: "breakfast" | "lunch" | "dinner" | "snack";
      calories?: number;
      proteinGrams?: number;
    }
  | {
      type: "add_workout";
      title: string;
      durationMinutes?: number;
      intensity?: "light" | "moderate" | "high";
      scheduledFor?: string;
      notes?: string;
    }
  | {
      type: "update_task_status";
      taskId: string;
      status: "not_started" | "active" | "done" | "blocked";
    }
  | {
      type: "update_goal_progress";
      goalTitle: string;
      currentValue?: number;
      progressPercent?: number;
    }
  | {
      type: "set_daily_plan";
      summary: string;
      overloadWarning?: string;
      blocks: Array<{
        taskId?: string;
        taskTitle: string;
        startLabel: string;
        endLabel: string;
        rationale: string;
      }>;
    };

const STORAGE_KEY = "momentum-os-next-local-state";
const CHAT_STORAGE_KEY = "momentum-os-assistant-chat";

export function AppShell({ snapshot }: AppShellProps) {
  const [state, setState] = useState<DashboardSnapshot>(() => normalizeDashboardSnapshot(snapshot, snapshot));
  const [activeView, setActiveView] = useState<AppView>("overview");
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  const [syncState, setSyncState] = useState<SyncState>("local");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickCapture, setQuickCapture] = useState("");

  const [goalTitle, setGoalTitle] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [habitTitle, setHabitTitle] = useState("");
  const [habitCadence, setHabitCadence] = useState<HabitCadence>("daily");
  const [mealTitle, setMealTitle] = useState("");
  const [mealCalories, setMealCalories] = useState("");
  const [mealCategory, setMealCategory] = useState<MealCategory>("lunch");
  const [workoutTitle, setWorkoutTitle] = useState("");
  const [workoutMinutes, setWorkoutMinutes] = useState("");
  const [workoutIntensity, setWorkoutIntensity] = useState<WorkoutIntensity>("moderate");
  const [learningTitle, setLearningTitle] = useState("");
  const [learningMinutes, setLearningMinutes] = useState("");
  const [financeTitle, setFinanceTitle] = useState("");
  const [financeAmount, setFinanceAmount] = useState("");
  const [financeType, setFinanceType] = useState<FinanceEntryType>("expense");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  const [focusPreset, setFocusPreset] = useState<25 | 50 | 90>(50);
  const [focusRunning, setFocusRunning] = useState(false);
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(50 * 60);

  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content:
        "I can help plan your day, suggest what to do next, create tasks and habits, and keep the system moving. Account settings stay off-limits."
    }
  ]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantPending, setAssistantPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function bootstrap() {
      let nextState = normalizeDashboardSnapshot(snapshot, snapshot);
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const savedChat = window.localStorage.getItem(CHAT_STORAGE_KEY);

      if (saved) {
        try {
          nextState = normalizeDashboardSnapshot(JSON.parse(saved), snapshot);
        } catch {
          nextState = normalizeDashboardSnapshot(snapshot, snapshot);
        }
      }

      if (savedChat) {
        try {
          const parsedChat = JSON.parse(savedChat) as AssistantMessage[];
          if (Array.isArray(parsedChat) && parsedChat.length) {
            setAssistantMessages(parsedChat);
          }
        } catch {
          setAssistantMessages((current) => current);
        }
      }

      if (!cancelled) {
        setState(nextState);
      }

      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setAccount({ status: "guest" });
          setSyncState("local");
          setIsBootstrapped(true);
        }
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (session?.user) {
        setAccount({
          status: "signed_in",
          email: session.user.email ?? undefined,
          fullName: readUserName(session.user.user_metadata),
          userId: session.user.id
        });

        const { data, error } = await supabase
          .from("user_workspace_snapshots")
          .select("snapshot, updated_at")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (!error && data?.snapshot) {
          setState(normalizeDashboardSnapshot(data.snapshot, snapshot));
          setLastSyncedAt(data.updated_at ?? null);
          setSyncState("synced");
        } else if (error) {
          setSyncState("error");
        } else {
          setSyncState("synced");
        }
      } else {
        setAccount({ status: "guest" });
        setSyncState("local");
      }

      const {
        data: { subscription }
      } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!nextSession?.user) {
          setAccount({ status: "guest" });
          setSyncState("local");
          setLastSyncedAt(null);
          return;
        }

        setAccount({
          status: "signed_in",
          email: nextSession.user.email ?? undefined,
          fullName: readUserName(nextSession.user.user_metadata),
          userId: nextSession.user.id
        });
      });

      unsubscribe = () => subscription.unsubscribe();

      if (!cancelled) {
        setIsBootstrapped(true);
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [snapshot]);

  useEffect(() => {
    if (!isBootstrapped) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [isBootstrapped, state]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(assistantMessages));
  }, [assistantMessages]);

  useEffect(() => {
    if (!isBootstrapped || account.status !== "signed_in" || !account.userId || !hasSupabaseConfig()) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        setSyncState("syncing");
        const supabase = createSupabaseBrowserClient();
        const timestamp = new Date().toISOString();
        const { error } = await supabase.from("user_workspace_snapshots").upsert({
          user_id: account.userId,
          snapshot: state,
          updated_at: timestamp
        });

        if (error) throw error;

        setLastSyncedAt(timestamp);
        setSyncState("synced");
      } catch {
        setSyncState("error");
      }
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [account.status, account.userId, isBootstrapped, state]);

  useEffect(() => {
    if (!focusRunning) return;

    const intervalId = window.setInterval(() => {
      setFocusSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          setFocusRunning(false);
          setState((currentState) => ({
            ...currentState,
            focusSessions: [
              {
                id: createId("focus"),
                taskId: state.tasks[0]?.id ?? "free-focus",
                plannedMinutes: focusPreset,
                actualMinutes: focusPreset,
                completed: true,
                brokeEarly: false
              },
              ...currentState.focusSessions
            ]
          }));
          return focusPreset * 60;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [focusPreset, focusRunning, state.tasks]);

  useEffect(() => {
    setFocusSecondsLeft(focusPreset * 60);
  }, [focusPreset]);

  const firstName = useMemo(() => {
    const raw = account.fullName ?? state.user.fullName ?? "Momentum";
    return raw.split(" ")[0] || raw;
  }, [account.fullName, state.user.fullName]);

  const greeting = useMemo(() => getGreeting(), []);
  const currentDate = useMemo(() => format(new Date(), "EEE, MMM d"), []);

  const openTasks = useMemo(() => state.tasks.filter((task) => task.status !== "done"), [state.tasks]);
  const doneTasks = useMemo(() => state.tasks.filter((task) => task.status === "done"), [state.tasks]);
  const todayPriorities = useMemo(() => {
    return [...openTasks]
      .sort((left, right) => {
        if (left.status === "active" && right.status !== "active") return -1;
        if (left.status !== "active" && right.status === "active") return 1;
        return right.priorityScore - left.priorityScore;
      })
      .slice(0, 3);
  }, [openTasks]);

  const focusMinutes = useMemo(
    () => state.focusSessions.reduce((total, session) => total + session.actualMinutes, 0),
    [state.focusSessions]
  );
  const habitScore = useMemo(() => average(state.habits.map((habit) => habit.completionPercent)), [state.habits]);
  const completedHabitCount = useMemo(
    () => state.habits.filter((habit) => habit.completionPercent >= 70).length,
    [state.habits]
  );
  const learningMinutesTotal = useMemo(
    () => state.learning.reduce((total, item) => total + item.minutes, 0),
    [state.learning]
  );
  const topHabit = useMemo(
    () =>
      [...state.habits].sort((left, right) => {
        if (right.streak !== left.streak) return right.streak - left.streak;
        return right.completionPercent - left.completionPercent;
      })[0],
    [state.habits]
  );
  const longestStreak = useMemo(() => Math.max(0, ...state.habits.map((habit) => habit.streak)), [state.habits]);
  const productivityScore = useMemo(() => {
    const completionRate = state.tasks.length ? (doneTasks.length / state.tasks.length) * 100 : 0;
    const sleepScore = state.sleep.qualityScore;
    return Math.round((completionRate * 0.5 + habitScore * 0.25 + sleepScore * 0.25) / 1);
  }, [doneTasks.length, habitScore, state.sleep.qualityScore, state.tasks.length]);
  const todayCalories = useMemo(
    () => state.meals.reduce((total, meal) => total + meal.calories, 0),
    [state.meals]
  );
  const hydrationPercent = useMemo(
    () => Math.round((state.hydration.currentGlasses / Math.max(state.hydration.targetGlasses, 1)) * 100),
    [state.hydration.currentGlasses, state.hydration.targetGlasses]
  );
  const weeklyTrend = useMemo(
    () => buildWeeklyTrend(productivityScore, habitScore, focusMinutes, state.sleep.qualityScore),
    [focusMinutes, habitScore, productivityScore, state.sleep.qualityScore]
  );
  const assistantHeroCopy = useMemo(() => {
    const activeTask = todayPriorities.find((task) => task.status === "active") ?? todayPriorities[0];

    if (activeTask) {
      return `Focus on ${activeTask.context.replace("_", " ")} work with "${activeTask.title}" while your energy is still good.`;
    }

    if (state.inbox.length) {
      return `Clear the inbox first so today’s plan stops competing with loose thoughts.`;
    }

    return `Use the next hour to protect momentum: capture, plan, and close one meaningful block.`;
  }, [state.inbox.length, todayPriorities]);
  const latestMood = state.moods[0]?.mood ?? "steady";
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    const results = [
      ...state.tasks.map((task) => ({
        id: task.id,
        label: task.title,
        meta: `Task • ${task.context.replace("_", " ")}`,
        view: "tasks" as const
      })),
      ...state.habits.map((habit) => ({
        id: habit.id,
        label: habit.title,
        meta: `Habit • ${habit.cadence}`,
        view: "habits" as const
      })),
      ...state.notes.map((note) => ({
        id: note.id,
        label: note.title,
        meta: `Note • ${note.tags.join(", ") || "untagged"}`,
        view: "notes" as const
      })),
      ...state.goals.map((goal) => ({
        id: goal.id,
        label: goal.title,
        meta: `Goal • ${goal.progressPercent}%`,
        view: "planning" as const
      }))
    ];

    return results.filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(query)).slice(0, 8);
  }, [searchQuery, state.goals, state.habits, state.notes, state.tasks]);

  const navGroups = [
    {
      label: "Core",
      items: [
        { id: "overview" as const, label: "Home", count: openTasks.length },
        { id: "inbox" as const, label: "Inbox", count: state.inbox.length },
        { id: "tasks" as const, label: "Tasks", count: state.tasks.length },
        { id: "planning" as const, label: "Calendar", count: state.dailyPlan.blocks.length },
        { id: "focus" as const, label: "Focus", count: Math.round(focusMinutes / 60) }
      ]
    },
    {
      label: "Growth",
      items: [
        { id: "habits" as const, label: "Habits", count: state.habits.length },
        { id: "workouts" as const, label: "Workouts", count: state.workouts.length },
        { id: "learning" as const, label: "Learning", count: state.learning.length },
        { id: "meals" as const, label: "Meals", count: state.meals.length },
        { id: "finance" as const, label: "Finance", count: state.finance.length }
      ]
    },
    {
      label: "Insights",
      items: [
        { id: "analytics" as const, label: "Analytics", count: productivityScore },
        { id: "assistant" as const, label: "AI Coach", count: assistantMessages.length - 1 }
      ]
    },
    {
      label: "Tools",
      items: [{ id: "notes" as const, label: "Notes", count: state.notes.length }]
    }
  ];

  function patchState(recipe: (current: DashboardSnapshot) => DashboardSnapshot) {
    setState((current) => normalizeDashboardSnapshot(recipe(current), snapshot));
  }

  function addCaptureToInbox(payload: { rawText: string; source: CaptureSource; parsed: CaptureParseResult }) {
    patchState((current) => ({
      ...current,
      inbox: [
        {
          id: createId("inbox"),
          rawText: payload.rawText,
          source: payload.source,
          status: "new",
          parsedPayload: payload.parsed,
          createdAt: new Date().toISOString()
        },
        ...current.inbox
      ]
    }));
  }

  function promoteInboxItem(itemId: string, kindOverride?: CaptureParseResult["kind"]) {
    patchState((current) => {
      const entry = current.inbox.find((item) => item.id === itemId);
      if (!entry) return current;

      const nextInbox = current.inbox.filter((item) => item.id !== itemId);
      const kind = kindOverride ?? entry.parsedPayload.kind;

      if (kind === "task") {
        const draftTask: Omit<Task, "priorityScore"> = {
          id: createId("task"),
          title: entry.parsedPayload.title,
          description: entry.rawText,
          status: "not_started",
          energyLevel: "medium",
          estimatedMinutes: 30,
          deadlineAt: entry.parsedPayload.detectedDate,
          context: entry.parsedPayload.contextHint ?? "work",
          tags: entry.parsedPayload.tags,
          linkedGoalId: current.goals[0]?.id
        };

        return {
          ...current,
          inbox: nextInbox,
          tasks: [
            {
              ...draftTask,
              priorityScore: calculatePriorityScore(draftTask, current.goals[0])
            },
            ...current.tasks
          ]
        };
      }

      if (kind === "project") {
        return {
          ...current,
          inbox: nextInbox,
          projects: [
            {
              id: createId("project"),
              title: entry.parsedPayload.title,
              goalId: current.goals[0]?.id,
              status: "planning",
              progressPercent: 0
            },
            ...current.projects
          ]
        };
      }

      return {
        ...current,
        inbox: nextInbox,
        notes: [
          {
            id: createId("note"),
            title: entry.parsedPayload.title,
            body: entry.rawText,
            tags: entry.parsedPayload.tags
          },
          ...current.notes
        ]
      };
    });

    if ((kindOverride ?? state.inbox.find((item) => item.id === itemId)?.parsedPayload.kind) === "task") {
      setActiveView("tasks");
    }
  }

  function updateTaskStatus(taskId: string, nextStatus: Task["status"]) {
    patchState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, status: nextStatus } : task))
    }));
  }

  function handleQuickCapture() {
    const raw = quickCapture.trim();
    if (!raw) return;

    const tags = Array.from(raw.matchAll(/#([\w-]+)/g)).map((match) => match[1]);
    const lowered = raw.toLowerCase();
    const kind: CaptureParseResult["kind"] =
      lowered.includes("note") || lowered.includes("idea") ? "note" : lowered.includes("project") ? "project" : "task";

    addCaptureToInbox({
      rawText: raw,
      source: "quick_capture",
      parsed: {
        kind,
        title: raw.replace(/#([\w-]+)/g, "").trim(),
        tags,
        priorityHint: lowered.includes("urgent") ? "high" : "medium",
        contextHint: lowered.includes("home") ? "home" : lowered.includes("deep") ? "deep_work" : "work",
        verb: raw.split(" ")[0]?.toLowerCase()
      }
    });

    setQuickCapture("");
    setActiveView("inbox");
  }

  function addGoal() {
    if (!goalTitle.trim()) return;
    patchState((current) => ({
      ...current,
      goals: [
        {
          id: createId("goal"),
          title: goalTitle.trim(),
          metricName: "Progress",
          targetValue: 100,
          currentValue: 0,
          progressPercent: 0
        },
        ...current.goals
      ]
    }));
    setGoalTitle("");
  }

  function addProject() {
    if (!projectTitle.trim()) return;
    patchState((current) => ({
      ...current,
      projects: [
        {
          id: createId("project"),
          title: projectTitle.trim(),
          goalId: current.goals[0]?.id,
          status: "planning",
          progressPercent: 0
        },
        ...current.projects
      ]
    }));
    setProjectTitle("");
  }

  function addHabit() {
    if (!habitTitle.trim()) return;
    patchState((current) => ({
      ...current,
      habits: [
        {
          id: createId("habit"),
          title: habitTitle.trim(),
          cadence: habitCadence,
          linkedGoalId: current.goals[0]?.id,
          streak: 0,
          completionPercent: 0
        },
        ...current.habits
      ]
    }));
    setHabitTitle("");
  }

  function addMeal() {
    if (!mealTitle.trim()) return;
    patchState((current) => ({
      ...current,
      meals: [
        {
          id: createId("meal"),
          title: mealTitle.trim(),
          category: mealCategory,
          calories: Number.parseInt(mealCalories || "0", 10) || 0,
          loggedAt: new Date().toISOString()
        },
        ...current.meals
      ]
    }));
    setMealTitle("");
    setMealCalories("");
  }

  function addWorkout() {
    if (!workoutTitle.trim()) return;
    patchState((current) => ({
      ...current,
      workouts: [
        {
          id: createId("workout"),
          title: workoutTitle.trim(),
          durationMinutes: Number.parseInt(workoutMinutes || "0", 10) || 30,
          intensity: workoutIntensity,
          status: "planned",
          scheduledFor: new Date().toISOString()
        },
        ...current.workouts
      ]
    }));
    setWorkoutTitle("");
    setWorkoutMinutes("");
  }

  function addLearning() {
    if (!learningTitle.trim()) return;
    patchState((current) => ({
      ...current,
      learning: [
        {
          id: createId("learning"),
          title: learningTitle.trim(),
          category: "practice",
          minutes: Number.parseInt(learningMinutes || "0", 10) || 20,
          completed: false
        },
        ...current.learning
      ]
    }));
    setLearningTitle("");
    setLearningMinutes("");
  }

  function addFinanceEntry() {
    if (!financeTitle.trim()) return;
    patchState((current) => ({
      ...current,
      finance: [
        {
          id: createId("finance"),
          title: financeTitle.trim(),
          type: financeType,
          amount: Number.parseInt(financeAmount || "0", 10) || 0,
          createdAt: new Date().toISOString()
        },
        ...current.finance
      ]
    }));
    setFinanceTitle("");
    setFinanceAmount("");
  }

  function addNote() {
    if (!noteTitle.trim()) return;
    patchState((current) => ({
      ...current,
      notes: [
        {
          id: createId("note"),
          title: noteTitle.trim(),
          body: noteBody.trim(),
          tags: extractTags(noteBody)
        },
        ...current.notes
      ]
    }));
    setNoteTitle("");
    setNoteBody("");
  }

  async function sendAssistantMessage() {
    const message = assistantInput.trim();
    if (!message || assistantPending) return;

    const userMessage: AssistantMessage = {
      id: createId("assistant-user"),
      role: "user",
      content: message
    };

    setAssistantMessages((current) => [...current, userMessage]);
    setAssistantInput("");
    setAssistantPending(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          state
        })
      });

      const payload = (await response.json()) as {
        reply: string;
        actions?: AssistantAction[];
      };

      if (Array.isArray(payload.actions) && payload.actions.length) {
        applyAssistantActions(payload.actions);
      }

      setAssistantMessages((current) => [
        ...current,
        {
          id: createId("assistant-reply"),
          role: "assistant",
          content: payload.reply
        }
      ]);
    } catch (error) {
      setAssistantMessages((current) => [
        ...current,
        {
          id: createId("assistant-error"),
          role: "assistant",
          content: error instanceof Error ? error.message : "The AI request failed."
        }
      ]);
    } finally {
      setAssistantPending(false);
    }
  }

  function applyAssistantActions(actions: AssistantAction[]) {
    patchState((current) => {
      let nextState = { ...current };

      for (const action of actions) {
        if (action.type === "add_task") {
          const goal = action.linkedGoalTitle
            ? nextState.goals.find((item) => item.title.toLowerCase() === action.linkedGoalTitle?.toLowerCase())
            : nextState.goals[0];
          const project = action.linkedProjectTitle
            ? nextState.projects.find((item) => item.title.toLowerCase() === action.linkedProjectTitle?.toLowerCase())
            : undefined;
          const draftTask: Omit<Task, "priorityScore"> = {
            id: createId("task"),
            title: action.title,
            description: action.description,
            status: "not_started",
            context: action.context ?? "work",
            energyLevel: action.energyLevel ?? "medium",
            estimatedMinutes: action.estimatedMinutes ?? 30,
            deadlineAt: action.deadlineAt,
            tags: action.tags ?? [],
            linkedGoalId: goal?.id,
            linkedProjectId: project?.id
          };

          nextState = {
            ...nextState,
            tasks: [
              {
                ...draftTask,
                priorityScore: calculatePriorityScore(draftTask, goal)
              },
              ...nextState.tasks
            ]
          };
        }

        if (action.type === "add_habit") {
          nextState = {
            ...nextState,
            habits: [
              {
                id: createId("habit"),
                title: action.title,
                cadence: action.cadence ?? "daily",
                linkedGoalId: nextState.goals[0]?.id,
                streak: 0,
                completionPercent: 0
              },
              ...nextState.habits
            ]
          };
        }

        if (action.type === "add_goal") {
          nextState = {
            ...nextState,
            goals: [
              {
                id: createId("goal"),
                title: action.title,
                metricName: action.metricName ?? "Progress",
                targetValue: action.targetValue ?? 100,
                currentValue: 0,
                progressPercent: 0
              },
              ...nextState.goals
            ]
          };
        }

        if (action.type === "add_project") {
          const goal = action.goalTitle
            ? nextState.goals.find((item) => item.title.toLowerCase() === action.goalTitle?.toLowerCase())
            : nextState.goals[0];

          nextState = {
            ...nextState,
            projects: [
              {
                id: createId("project"),
                title: action.title,
                goalId: goal?.id,
                deadlineAt: action.deadlineAt,
                status: "planning",
                progressPercent: 0
              },
              ...nextState.projects
            ]
          };
        }

        if (action.type === "add_note") {
          nextState = {
            ...nextState,
            notes: [
              {
                id: createId("note"),
                title: action.title,
                body: action.body ?? "",
                tags: action.tags ?? []
              },
              ...nextState.notes
            ]
          };
        }

        if (action.type === "add_meal") {
          nextState = {
            ...nextState,
            meals: [
              {
                id: createId("meal"),
                title: action.title,
                category: action.category ?? "lunch",
                calories: action.calories ?? 0,
                proteinGrams: action.proteinGrams,
                loggedAt: new Date().toISOString()
              },
              ...nextState.meals
            ]
          };
        }

        if (action.type === "add_workout") {
          nextState = {
            ...nextState,
            workouts: [
              {
                id: createId("workout"),
                title: action.title,
                durationMinutes: action.durationMinutes ?? 30,
                intensity: action.intensity ?? "moderate",
                status: "planned",
                scheduledFor: action.scheduledFor ?? new Date().toISOString(),
                notes: action.notes
              },
              ...nextState.workouts
            ]
          };
        }

        if (action.type === "update_task_status") {
          nextState = {
            ...nextState,
            tasks: nextState.tasks.map((task) =>
              task.id === action.taskId ? { ...task, status: action.status } : task
            )
          };
        }

        if (action.type === "update_goal_progress") {
          nextState = {
            ...nextState,
            goals: nextState.goals.map((goal) => {
              if (goal.title.toLowerCase() !== action.goalTitle.toLowerCase()) {
                return goal;
              }

              const nextCurrentValue = action.currentValue ?? goal.currentValue;
              const nextProgressPercent =
                action.progressPercent ??
                Math.min(100, Math.round((nextCurrentValue / Math.max(goal.targetValue, 1)) * 100));

              return {
                ...goal,
                currentValue: nextCurrentValue,
                progressPercent: nextProgressPercent
              };
            })
          };
        }

        if (action.type === "set_daily_plan") {
          const createdTasks: Task[] = [];
          const blocks = action.blocks.map((block) => {
            let matchedTask =
              (block.taskId ? nextState.tasks.find((task) => task.id === block.taskId) : undefined) ??
              nextState.tasks.find((task) => task.title.toLowerCase() === block.taskTitle.toLowerCase()) ??
              createdTasks.find((task) => task.title.toLowerCase() === block.taskTitle.toLowerCase());

            if (!matchedTask) {
              const draftTask: Omit<Task, "priorityScore"> = {
                id: createId("task"),
                title: block.taskTitle,
                description: block.rationale,
                status: "not_started",
                context: "work",
                energyLevel: "medium",
                estimatedMinutes: estimateMinutesFromRange(block.startLabel, block.endLabel),
                tags: ["ai-plan"],
                linkedGoalId: nextState.goals[0]?.id
              };

              matchedTask = {
                ...draftTask,
                priorityScore: calculatePriorityScore(draftTask, nextState.goals[0])
              };
              createdTasks.push(matchedTask);
            }

            return {
              taskId: matchedTask.id,
              title: block.taskTitle,
              startLabel: block.startLabel,
              endLabel: block.endLabel,
              rationale: block.rationale
            };
          });

          nextState = {
            ...nextState,
            tasks: [...createdTasks, ...nextState.tasks],
            dailyPlan: {
              summary: action.summary,
              overloadWarning: action.overloadWarning,
              blocks
            }
          };
        }
      }

      return nextState;
    });
  }

  function renderOverview() {
    return (
      <div className="dashboard-content">
        <section className="welcome-row">
          <div>
            <h1>
              {greeting}, {firstName}
              <span className="wave">👋</span>
            </h1>
            <p>
              {longestStreak > 0
                ? `You're on a ${longestStreak}-day streak. Let's make today count.`
                : "Let’s build a calm, high-output day from the right next move."}
            </p>
          </div>
        </section>

        {searchQuery.trim() ? (
          <section className="dashboard-panel search-panel">
            <div className="panel-head">
              <div>
                <span className="panel-kicker">Search</span>
                <h2>Results</h2>
              </div>
              <span className="pill">{searchResults.length} matches</span>
            </div>

            <div className="search-results">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className="search-result-row"
                  onClick={() => setActiveView(result.view)}
                >
                  <strong>{result.label}</strong>
                  <span>{result.meta}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="hero-panel">
          <div className="hero-panel__copy">
            <span className="panel-kicker">AI Coach</span>
            <h2>{assistantHeroCopy}</h2>
            <p>Use the planner to protect your best hours, not just fill your day.</p>
            <div className="hero-panel__actions">
              <button type="button" className="primary-button" onClick={() => setActiveView("planning")}>
                See my plan
              </button>
              <button type="button" className="ghost-button" onClick={() => setActiveView("assistant")}>
                Ask AI
              </button>
            </div>
          </div>

          <div className="hero-panel__metrics">
            <article className="score-orb">
              <span>Productivity Score</span>
              <strong>{productivityScore}</strong>
              <em>+12% this week</em>
            </article>
            <article className="trend-card">
              <span>Weekly arc</span>
              <MiniTrend values={weeklyTrend} />
              <div className="trend-days">
                {["M", "T", "W", "T", "F", "S", "S"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="dashboard-panel priorities-panel">
          <div className="panel-head">
            <div>
              <h2>Today's Priorities</h2>
            </div>
            <div className="head-actions">
              <span className="pill">{todayPriorities.length} tasks</span>
              <button type="button" className="ghost-button ghost-button--small" onClick={() => setActiveView("tasks")}>
                View all
              </button>
            </div>
          </div>

          <div className="priority-list">
            {todayPriorities.map((task, index) => {
              const planBlock = state.dailyPlan.blocks.find((block) => block.taskId === task.id);
              return (
                <article key={task.id} className="priority-row">
                  <button
                    type="button"
                    className={`priority-check priority-check--${task.status}`}
                    onClick={() => updateTaskStatus(task.id, task.status === "done" ? "active" : "done")}
                    aria-label={`Mark ${task.title} as ${task.status === "done" ? "active" : "done"}`}
                  />
                  <div className="priority-row__body">
                    <div className="priority-row__titleline">
                      <strong>{task.title}</strong>
                      <div className="priority-chips">
                        <span className={`tone-chip tone-chip--${task.context}`}>{task.context.replace("_", " ")}</span>
                        {planBlock ? (
                          <span className="soft-chip">
                            {planBlock.startLabel} - {planBlock.endLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p>{task.description}</p>
                  </div>
                  <div className={`priority-level priority-level--${index === 0 ? "high" : "medium"}`}>
                    {index === 0 ? "High" : "Medium"}
                  </div>
                </article>
              );
            })}

            <button type="button" className="priority-add" onClick={() => setActiveView("inbox")}>
              + Add a task
            </button>
          </div>
        </section>

        <section className="stat-strip">
          <StatCard label="Focus Time" value={`${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60}m`} meta="18% from yesterday" accent="mint" />
          <StatCard label="Tasks Done" value={`${doneTasks.length} / ${state.tasks.length}`} meta="Strong completion pace" accent="blue" />
          <StatCard label="Habit Score" value={`${habitScore}%`} meta={`${completedHabitCount} habits in rhythm`} accent="violet" />
          <StatCard label="Learning" value={`${learningMinutesTotal}m`} meta="Practice and reading today" accent="amber" />
        </section>

        <section className="dashboard-panel week-panel">
          <div className="panel-head">
            <div>
              <h2>This Week Overview</h2>
            </div>
            <span className="pill">Weekly</span>
          </div>

          <div className="week-grid">
            <InsightTile
              title="Productivity"
              value={`${productivityScore}%`}
              caption="+12% vs last week"
              chart={<MiniTrend values={weeklyTrend} tone="green" />}
            />
            <InsightTile
              title="Focus Consistency"
              value={`${Math.min(state.focusSessions.length + 4, 7)} / 7`}
              caption="Days achieved"
              chart={<DotCalendar values={weeklyTrend} />}
            />
            <InsightTile
              title="Top Habit"
              value={topHabit?.title ?? "No habit yet"}
              caption={topHabit ? `${topHabit.streak}-day streak` : "Create a repeatable habit"}
            />
            <InsightTile
              title="Mood Trend"
              value={titleCase(latestMood)}
              caption={state.moods[0]?.note ?? "Mostly stable and productive"}
              chart={<MiniTrend values={[48, 52, 50, 60, 58, 66, 72]} tone="amber" />}
            />
          </div>
        </section>
      </div>
    );
  }

  function renderInbox() {
    const inboxItems = filterByQuery(state.inbox, searchQuery, (item) => [item.rawText, item.parsedPayload.title]);

    return (
      <div className="stack-view">
        <CaptureBox onCaptured={addCaptureToInbox} />

        <section className="dashboard-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Inbox</span>
              <h2>Review captured items</h2>
            </div>
            <span className="pill">{inboxItems.length} waiting</span>
          </div>

          <div className="feed-list">
            {inboxItems.map((item) => (
              <article key={item.id} className="feed-card">
                <div className="feed-card__meta">
                  <span>{item.source.replace("_", " ")}</span>
                  <span>{format(new Date(item.createdAt), "MMM d, h:mm a")}</span>
                </div>
                <h3>{item.parsedPayload.title}</h3>
                <p>{item.rawText}</p>
                <div className="chip-line">
                  <span>{item.parsedPayload.kind}</span>
                  {item.parsedPayload.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
                <div className="row-actions">
                  <button type="button" className="primary-button" onClick={() => promoteInboxItem(item.id, "task")}>
                    Promote to task
                  </button>
                  <button type="button" className="ghost-button ghost-button--small" onClick={() => promoteInboxItem(item.id, "note")}>
                    Note
                  </button>
                  <button type="button" className="ghost-button ghost-button--small" onClick={() => promoteInboxItem(item.id, "project")}>
                    Project
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderPlanning() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Goals</span>
            <h3>New goal</h3>
            <input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Launch v1 publicly" />
            <button type="button" className="primary-button" onClick={addGoal}>
              Add goal
            </button>
          </div>

          <div className="mini-form">
            <span className="panel-kicker">Projects</span>
            <h3>New project</h3>
            <input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Polish onboarding flow" />
            <button type="button" className="primary-button" onClick={addProject}>
              Add project
            </button>
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-head">
            <div>
              <h2>Daily Plan</h2>
            </div>
            <span className="pill">{state.dailyPlan.blocks.length} blocks</span>
          </div>
          <p className="support-copy">{state.dailyPlan.summary}</p>
          {state.dailyPlan.overloadWarning ? <div className="warning-banner">{state.dailyPlan.overloadWarning}</div> : null}
          <div className="schedule-list">
            {state.dailyPlan.blocks.map((block) => (
              <article key={`${block.taskId}-${block.startLabel}`} className="schedule-row">
                <div>
                  <strong>
                    {block.startLabel} - {block.endLabel}
                  </strong>
                  <p>{block.title}</p>
                </div>
                <span>{block.rationale}</span>
              </article>
            ))}
          </div>
        </section>

        <div className="two-column-grid">
          <section className="dashboard-panel">
            <div className="panel-head">
              <h2>Goals</h2>
            </div>
            <div className="feed-list compact-feed">
              {filterByQuery(state.goals, searchQuery, (goal) => [goal.title, goal.metricName]).map((goal) => (
                <article key={goal.id} className="feed-card feed-card--compact">
                  <strong>{goal.title}</strong>
                  <p>{goal.metricName}</p>
                  <div className="meter">
                    <span style={{ width: `${goal.progressPercent}%` }} />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="panel-head">
              <h2>Projects</h2>
            </div>
            <div className="feed-list compact-feed">
              {filterByQuery(state.projects, searchQuery, (project) => [project.title, project.status]).map((project) => (
                <article key={project.id} className="feed-card feed-card--compact">
                  <strong>{project.title}</strong>
                  <p>{titleCase(project.status)}</p>
                  <div className="meter">
                    <span style={{ width: `${project.progressPercent}%` }} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderHabits() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Habits</span>
            <h3>Create habit</h3>
            <input value={habitTitle} onChange={(event) => setHabitTitle(event.target.value)} placeholder="Read for 20 minutes" />
            <select value={habitCadence} onChange={(event) => setHabitCadence(event.target.value as HabitCadence)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <button type="button" className="primary-button" onClick={addHabit}>
              Add habit
            </button>
          </div>
          <div className="mini-spotlight">
            <span className="panel-kicker">Consistency</span>
            <strong>{habitScore}% average score</strong>
            <p>Track streaks, rhythm, and repeatable wins instead of relying on memory.</p>
          </div>
        </section>

        <section className="card-grid">
          {filterByQuery(state.habits, searchQuery, (habit) => [habit.title, habit.cadence]).map((habit) => (
            <article key={habit.id} className="dashboard-panel habit-card">
              <div className="panel-head">
                <h2>{habit.title}</h2>
                <span className="pill">{habit.cadence}</span>
              </div>
              <div className="habit-stats">
                <div>
                  <span>Streak</span>
                  <strong>{habit.streak} days</strong>
                </div>
                <div>
                  <span>Completion</span>
                  <strong>{habit.completionPercent}%</strong>
                </div>
              </div>
              <div className="meter">
                <span style={{ width: `${habit.completionPercent}%` }} />
              </div>
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderMeals() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Meals</span>
            <h3>Log meal</h3>
            <input value={mealTitle} onChange={(event) => setMealTitle(event.target.value)} placeholder="Chicken rice bowl" />
            <div className="inline-fields">
              <select value={mealCategory} onChange={(event) => setMealCategory(event.target.value as MealCategory)}>
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
              </select>
              <input value={mealCalories} onChange={(event) => setMealCalories(event.target.value)} placeholder="Calories" />
            </div>
            <button type="button" className="primary-button" onClick={addMeal}>
              Add meal
            </button>
          </div>
          <div className="mini-spotlight">
            <span className="panel-kicker">Nutrition</span>
            <strong>{todayCalories} kcal logged</strong>
            <p>{state.hydration.currentGlasses} of {state.hydration.targetGlasses} glasses of water completed.</p>
          </div>
        </section>

        <section className="card-grid">
          {filterByQuery(state.meals, searchQuery, (meal) => [meal.title, meal.category]).map((meal) => (
            <article key={meal.id} className="dashboard-panel feed-card feed-card--compact">
              <strong>{meal.title}</strong>
              <p>{titleCase(meal.category)} • {meal.calories} kcal</p>
              <span>{format(new Date(meal.loggedAt), "MMM d, h:mm a")}</span>
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderWorkouts() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Workouts</span>
            <h3>Schedule session</h3>
            <input value={workoutTitle} onChange={(event) => setWorkoutTitle(event.target.value)} placeholder="Upper body strength" />
            <div className="inline-fields">
              <input value={workoutMinutes} onChange={(event) => setWorkoutMinutes(event.target.value)} placeholder="Minutes" />
              <select value={workoutIntensity} onChange={(event) => setWorkoutIntensity(event.target.value as WorkoutIntensity)}>
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
              </select>
            </div>
            <button type="button" className="primary-button" onClick={addWorkout}>
              Add workout
            </button>
          </div>
          <div className="mini-spotlight">
            <span className="panel-kicker">Training</span>
            <strong>{state.workouts.filter((workout) => workout.status === "completed").length} sessions done</strong>
            <p>Keep training connected to energy, recovery, and tomorrow’s focus quality.</p>
          </div>
        </section>

        <section className="card-grid">
          {filterByQuery(state.workouts, searchQuery, (workout) => [workout.title, workout.intensity, workout.status]).map((workout) => (
            <article key={workout.id} className="dashboard-panel habit-card">
              <div className="panel-head">
                <h2>{workout.title}</h2>
                <span className={`pill pill--${workout.status}`}>{titleCase(workout.status)}</span>
              </div>
              <p>{workout.durationMinutes} minutes • {titleCase(workout.intensity)} intensity</p>
              {workout.notes ? <span className="subtle-copy">{workout.notes}</span> : null}
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderLearning() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Learning</span>
            <h3>Add study block</h3>
            <input value={learningTitle} onChange={(event) => setLearningTitle(event.target.value)} placeholder="Prompt systems reading" />
            <input value={learningMinutes} onChange={(event) => setLearningMinutes(event.target.value)} placeholder="Minutes" />
            <button type="button" className="primary-button" onClick={addLearning}>
              Add learning
            </button>
          </div>
          <div className="mini-spotlight">
            <span className="panel-kicker">Growth</span>
            <strong>{learningMinutesTotal} minutes tracked</strong>
            <p>Make learning visible so it grows like any other serious workload.</p>
          </div>
        </section>

        <section className="card-grid">
          {filterByQuery(state.learning, searchQuery, (item) => [item.title, item.category]).map((item) => (
            <article key={item.id} className="dashboard-panel feed-card feed-card--compact">
              <strong>{item.title}</strong>
              <p>{titleCase(item.category)} • {item.minutes}m</p>
              <span>{item.completed ? "Completed" : "Queued"}</span>
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderFinance() {
    const netAmount = state.finance.reduce((total, entry) => {
      if (entry.type === "income") return total + entry.amount;
      if (entry.type === "saving") return total + entry.amount;
      return total - entry.amount;
    }, 0);

    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Finance</span>
            <h3>Add entry</h3>
            <input value={financeTitle} onChange={(event) => setFinanceTitle(event.target.value)} placeholder="Trading profit" />
            <div className="inline-fields">
              <select value={financeType} onChange={(event) => setFinanceType(event.target.value as FinanceEntryType)}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="saving">Saving</option>
              </select>
              <input value={financeAmount} onChange={(event) => setFinanceAmount(event.target.value)} placeholder="Amount" />
            </div>
            <button type="button" className="primary-button" onClick={addFinanceEntry}>
              Add entry
            </button>
          </div>
          <div className="mini-spotlight">
            <span className="panel-kicker">Snapshot</span>
            <strong>{formatCurrency(netAmount)}</strong>
            <p>Track the money side without breaking the main productivity flow.</p>
          </div>
        </section>

        <section className="card-grid">
          {filterByQuery(state.finance, searchQuery, (item) => [item.title, item.type]).map((item) => (
            <article key={item.id} className="dashboard-panel feed-card feed-card--compact">
              <strong>{item.title}</strong>
              <p>{titleCase(item.type)} • {formatCurrency(item.amount)}</p>
              <span>{format(new Date(item.createdAt), "MMM d, h:mm a")}</span>
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderFocus() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel focus-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Focus Mode</span>
              <h2>Single-task deep work</h2>
            </div>
            <span className="pill">{focusRunning ? "Running" : "Ready"}</span>
          </div>

          <div className="focus-panel__body">
            <div className="focus-clock">{formatTimer(focusSecondsLeft)}</div>
            <div className="preset-row">
              {[25, 50, 90].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={focusPreset === preset ? "preset-button is-active" : "preset-button"}
                  onClick={() => setFocusPreset(preset as 25 | 50 | 90)}
                >
                  {preset}m
                </button>
              ))}
            </div>
            <div className="row-actions">
              <button type="button" className="primary-button" onClick={() => setFocusRunning((current) => !current)}>
                {focusRunning ? "Pause focus" : "Start focus"}
              </button>
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => {
                  setFocusRunning(false);
                  setFocusSecondsLeft(focusPreset * 60);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-head">
            <h2>Recent sessions</h2>
          </div>
          <div className="schedule-list">
            {state.focusSessions.map((session) => (
              <article key={session.id} className="schedule-row">
                <div>
                  <strong>{session.plannedMinutes} minute block</strong>
                  <p>{session.completed ? "Completed cleanly" : "Ended early"}</p>
                </div>
                <span>{session.actualMinutes}m actual</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderAnalytics() {
    return (
      <div className="stack-view">
        <section className="stat-strip">
          <StatCard label="Productivity" value={`${productivityScore}%`} meta="Blend of tasks, habits, sleep" accent="violet" />
          <StatCard label="Hydration" value={`${hydrationPercent}%`} meta={`${state.hydration.currentGlasses}/${state.hydration.targetGlasses} glasses`} accent="mint" />
          <StatCard label="Sleep" value={`${state.sleep.hours}h`} meta={`Quality ${state.sleep.qualityScore}%`} accent="blue" />
          <StatCard label="Mood" value={titleCase(latestMood)} meta="Current operating baseline" accent="amber" />
        </section>

        <section className="dashboard-panel">
          <div className="panel-head">
            <h2>Performance bars</h2>
          </div>
          <div className="bar-stack">
            <MetricBar label="Task completion rate" value={Math.round((doneTasks.length / Math.max(state.tasks.length, 1)) * 100)} />
            <MetricBar label="Habit consistency" value={habitScore} />
            <MetricBar label="Hydration" value={hydrationPercent} />
            <MetricBar label="Sleep quality" value={state.sleep.qualityScore} />
          </div>
        </section>
      </div>
    );
  }

  function renderNotes() {
    return (
      <div className="stack-view">
        <section className="dashboard-panel split-panel">
          <div className="mini-form">
            <span className="panel-kicker">Second Brain</span>
            <h3>Create note</h3>
            <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="A thought worth keeping" />
            <textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} rows={6} placeholder="Use #tags and write freely." />
            <button type="button" className="primary-button" onClick={addNote}>
              Save note
            </button>
          </div>
          <div className="mini-spotlight">
            <span className="panel-kicker">Context</span>
            <strong>{state.notes.length} notes stored</strong>
            <p>Keep ideas, research, and operating principles connected to the work instead of scattered around.</p>
          </div>
        </section>

        <section className="card-grid">
          {filterByQuery(state.notes, searchQuery, (note) => [note.title, note.body, ...note.tags]).map((note) => (
            <article key={note.id} className="dashboard-panel feed-card">
              <strong>{note.title}</strong>
              <p>{note.body}</p>
              <div className="chip-line">
                {note.tags.map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderAssistant() {
    return (
      <section className="assistant-view">
        <div className="dashboard-panel assistant-panel">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">AI Coach</span>
              <h2>Plan, decide, and steer the system</h2>
            </div>
            <span className="pill">{assistantPending ? "Thinking..." : "Live"}</span>
          </div>

          <div className="assistant-thread">
            {assistantMessages.map((message) => (
              <article
                key={message.id}
                className={message.role === "assistant" ? "assistant-bubble assistant-bubble--assistant" : "assistant-bubble assistant-bubble--user"}
              >
                {message.content}
              </article>
            ))}
          </div>

          <div className="assistant-composer">
            <textarea
              value={assistantInput}
              onChange={(event) => setAssistantInput(event.target.value)}
              rows={4}
              placeholder="Ask for planning help, habits, goals, meals, workouts, or what to do next."
            />
            <button type="button" className="primary-button" onClick={sendAssistantMessage} disabled={assistantPending}>
              {assistantPending ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  function renderActiveView() {
    if (activeView === "overview") return renderOverview();
    if (activeView === "inbox") return renderInbox();
    if (activeView === "tasks") {
      return (
        <TaskBoard
          tasks={state.tasks}
          projects={state.projects}
          goals={state.goals}
          searchQuery={searchQuery}
          onStatusChange={updateTaskStatus}
        />
      );
    }
    if (activeView === "planning") return renderPlanning();
    if (activeView === "focus") return renderFocus();
    if (activeView === "habits") return renderHabits();
    if (activeView === "workouts") return renderWorkouts();
    if (activeView === "meals") return renderMeals();
    if (activeView === "learning") return renderLearning();
    if (activeView === "finance") return renderFinance();
    if (activeView === "analytics") return renderAnalytics();
    if (activeView === "notes") return renderNotes();
    return renderAssistant();
  }

  return (
    <main className={sidebarCollapsed ? "workspace-shell sidebar-collapsed" : "workspace-shell"}>
      <aside className="dashboard-sidebar">
        <div className="window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="profile-card">
          <div className="profile-card__avatar">{initials(account.fullName ?? state.user.fullName)}</div>
          <div className="profile-card__body">
            <strong>{account.fullName ?? state.user.fullName}</strong>
            <span>{account.status === "signed_in" ? account.email : "Guest workspace"}</span>
            <button type="button" className="profile-pill" onClick={() => (window.location.href = "/sign-in")}>
              {account.status === "signed_in"
                ? syncState === "synced"
                  ? "Synced"
                  : syncState === "syncing"
                    ? "Syncing..."
                    : "Cloud issue"
                : "Sign in"}
            </button>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <section key={group.label} className="nav-group">
              <span className="nav-group__label">{group.label}</span>
              <div className="nav-group__items">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={activeView === item.id ? "nav-item is-active" : "nav-item"}
                    onClick={() => setActiveView(item.id)}
                  >
                    <span className="nav-item__icon">
                      <NavGlyph view={item.id} />
                    </span>
                    <span className="nav-item__label">{item.label}</span>
                    <span className="nav-item__count">{item.count}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="sidebar-cta">
          <strong>Sync your workspace</strong>
          <p>Log in and keep your plans safe across devices.</p>
          <Link href="/sign-in" className="sidebar-cta__button">
            {account.status === "signed_in" ? "Manage account" : "Sign in"}
          </Link>
          {lastSyncedAt ? <span>Last sync {format(new Date(lastSyncedAt), "MMM d, h:mm a")}</span> : null}
        </div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <button
            type="button"
            className="topbar-icon"
            aria-label="Toggle sidebar"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <label className="topbar-search">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M13.75 12.5 17 15.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8.75" cy="8.75" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search anything..."
              aria-label="Search"
            />
            <span className="topbar-shortcut">K</span>
          </label>

          <div className="topbar-actions">
            <Link href="/sign-in" className="topbar-link">
              {account.status === "signed_in" ? "Account" : "Login"}
            </Link>
            <button type="button" className="topbar-bell" aria-label="Notifications">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M10 4.25a3.25 3.25 0 0 0-3.25 3.25v1.18c0 .56-.17 1.11-.48 1.58l-.94 1.39c-.3.44.01 1.05.55 1.05h8.24c.54 0 .85-.61.55-1.05l-.94-1.39a2.85 2.85 0 0 1-.48-1.58V7.5A3.25 3.25 0 0 0 10 4.25Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path d="M8.25 14.25a1.75 1.75 0 0 0 3.5 0" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>
        </header>

        {renderActiveView()}
      </section>

      <aside className="dashboard-rail">
        <section className="rail-card">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Today's Plan</span>
              <h2>{currentDate}</h2>
            </div>
          </div>
          <div className="rail-schedule">
            {state.dailyPlan.blocks.map((block, index) => (
              <article key={`${block.taskId}-${block.startLabel}`} className="rail-schedule__item">
                <div className="rail-schedule__time">
                  {block.startLabel} - {block.endLabel}
                </div>
                <strong>{block.title}</strong>
                <span>{index === 0 ? "Deep Work" : index === 1 ? "Important" : "Routine"}</span>
              </article>
            ))}
          </div>
          <button type="button" className="rail-action" onClick={() => setActiveView("planning")}>
            + Add time block
          </button>
        </section>

        <section className="rail-card rail-card--focus">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Focus Session</span>
              <h2>{focusRunning ? "Locked in" : "Ready to focus?"}</h2>
            </div>
          </div>
          <div className="rail-focus__clock">{formatTimer(focusSecondsLeft)}</div>
          <button type="button" className="focus-launch" onClick={() => setFocusRunning((current) => !current)}>
            {focusRunning ? "Pause Focus" : "Start Focus"}
          </button>
        </section>

        <section className="rail-card">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Streaks</span>
              <h2>{longestStreak} Days</h2>
            </div>
          </div>
          <div className="streak-row">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} className={index < Math.min(longestStreak, 8) ? "flame-dot is-active" : "flame-dot"} />
            ))}
          </div>
          <p className="support-copy">Best: {Math.max(longestStreak, 21)} days</p>
        </section>

        <section className="rail-card">
          <div className="panel-head">
            <div>
              <span className="panel-kicker">Quick Capture</span>
              <h2>What's on your mind?</h2>
            </div>
          </div>
          <textarea
            value={quickCapture}
            onChange={(event) => setQuickCapture(event.target.value)}
            rows={4}
            placeholder="Dump the thought here and sort it after."
          />
          <div className="quick-actions">
            <button type="button" className="quick-icon">
              Mic
            </button>
            <button type="button" className="quick-icon">
              Shot
            </button>
            <button type="button" className="quick-icon" onClick={handleQuickCapture}>
              Send
            </button>
          </div>
        </section>
      </aside>
    </main>
  );
}

function StatCard({
  label,
  value,
  meta,
  accent
}: {
  label: string;
  value: string;
  meta: string;
  accent: "mint" | "blue" | "violet" | "amber";
}) {
  return (
    <article className={`stat-card stat-card--${accent}`}>
      <div className="stat-card__ring" aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{meta}</p>
      </div>
    </article>
  );
}

function InsightTile({
  title,
  value,
  caption,
  chart
}: {
  title: string;
  value: string;
  caption: string;
  chart?: ReactNode;
}) {
  return (
    <article className="insight-tile">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{caption}</p>
      {chart ? <div className="insight-tile__chart">{chart}</div> : null}
    </article>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-bar">
      <div className="metric-bar__head">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="meter">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function MiniTrend({ values, tone = "violet" }: { values: number[]; tone?: "violet" | "green" | "amber" }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className={`mini-trend mini-trend--${tone}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotCalendar({ values }: { values: number[] }) {
  return (
    <div className="dot-calendar">
      {values.map((value, index) => (
        <span key={`${value}-${index}`} style={{ opacity: Math.max(0.2, value / 100) }} />
      ))}
    </div>
  );
}

function NavGlyph({ view }: { view: AppView }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" } as const;

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {view === "overview" ? (
        <>
          <path {...common} d="M3.5 10 10 4.5 16.5 10" />
          <path {...common} d="M5.5 9.5v6h9v-6" />
        </>
      ) : null}
      {view === "inbox" ? (
        <>
          <path {...common} d="M3.5 5.5h13v9h-13z" />
          <path {...common} d="M4.5 8.5h3l1 2h3l1-2h3" />
        </>
      ) : null}
      {view === "tasks" ? (
        <>
          <path {...common} d="M6 6.5h8" />
          <path {...common} d="M6 10h8" />
          <path {...common} d="M6 13.5h8" />
          <path {...common} d="M4 6.5h.01M4 10h.01M4 13.5h.01" />
        </>
      ) : null}
      {view === "planning" ? (
        <>
          <rect {...common} x="4" y="5" width="12" height="11" rx="2" />
          <path {...common} d="M4 8.5h12M7 4v3M13 4v3" />
        </>
      ) : null}
      {view === "focus" ? (
        <>
          <circle {...common} cx="10" cy="10" r="5.5" />
          <path {...common} d="M10 7v3l2 1.5" />
        </>
      ) : null}
      {view === "habits" ? (
        <>
          <path {...common} d="M10 4.5c2.5 0 4.5 2 4.5 4.5S12.5 13.5 10 13.5 5.5 11.5 5.5 9" />
          <path {...common} d="M10 4.5 7.5 7" />
          <path {...common} d="m4 11 2.3 2.3L10 9.6" />
        </>
      ) : null}
      {view === "workouts" ? (
        <>
          <path {...common} d="M4.5 8.5h2v3h-2zM13.5 8.5h2v3h-2z" />
          <path {...common} d="M6.5 10h7M8 7.5v5M12 7.5v5" />
        </>
      ) : null}
      {view === "learning" ? (
        <>
          <path {...common} d="M4.5 6.5 10 4l5.5 2.5V14L10 16l-5.5-2z" />
          <path {...common} d="M10 4v12" />
        </>
      ) : null}
      {view === "meals" ? (
        <>
          <path {...common} d="M6 4.5v5.5M8 4.5v5.5M7 10v5.5" />
          <path {...common} d="M12.5 4.5c1.5 1.6 1.5 4.2 0 5.8v5.2" />
        </>
      ) : null}
      {view === "finance" ? (
        <>
          <circle {...common} cx="10" cy="10" r="5.5" />
          <path {...common} d="M10 7v6M8.2 8.2c.4-.5 1-.7 1.8-.7 1.1 0 1.9.5 1.9 1.4 0 .8-.4 1.2-1.7 1.5-1.6.4-2.3.9-2.3 2 0 1 .9 1.7 2.3 1.7.8 0 1.5-.2 2-.7" />
        </>
      ) : null}
      {view === "analytics" ? (
        <>
          <path {...common} d="M5 14V9M10 14V6M15 14v-4" />
          <path {...common} d="M4 14.5h12" />
        </>
      ) : null}
      {view === "notes" ? (
        <>
          <path {...common} d="M5 4.5h7l3 3v8H5z" />
          <path {...common} d="M12 4.5v3h3M7 10h6M7 12.5h4.5" />
        </>
      ) : null}
      {view === "assistant" ? (
        <>
          <path {...common} d="M6 7.5a4 4 0 0 1 8 0c0 1.4-.7 2.6-1.8 3.3l.3 1.7-2.5-1.1c-.3.1-.7.1-1 .1a4 4 0 0 1-3.999-4Z" />
          <path {...common} d="M8 8.5h.01M10 8.5h.01M12 8.5h.01" />
        </>
      ) : null}
    </svg>
  );
}

function normalizeDashboardSnapshot(candidate: unknown, fallback: DashboardSnapshot): DashboardSnapshot {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const source = candidate as Partial<DashboardSnapshot>;

  return {
    user: source.user ?? fallback.user,
    inbox: Array.isArray(source.inbox) ? source.inbox : fallback.inbox,
    tasks: Array.isArray(source.tasks) ? source.tasks : fallback.tasks,
    projects: Array.isArray(source.projects) ? source.projects : fallback.projects,
    goals: Array.isArray(source.goals) ? source.goals : fallback.goals,
    habits: Array.isArray(source.habits) ? source.habits : fallback.habits,
    meals: Array.isArray(source.meals) ? source.meals : fallback.meals,
    workouts: Array.isArray(source.workouts) ? source.workouts : fallback.workouts,
    sleep:
      source.sleep && typeof source.sleep === "object" && typeof source.sleep.hours === "number"
        ? source.sleep
        : fallback.sleep,
    hydration:
      source.hydration &&
      typeof source.hydration === "object" &&
      typeof source.hydration.currentGlasses === "number"
        ? source.hydration
        : fallback.hydration,
    moods: Array.isArray(source.moods) ? source.moods : fallback.moods,
    learning: Array.isArray(source.learning) ? source.learning : fallback.learning,
    finance: Array.isArray(source.finance) ? source.finance : fallback.finance,
    socialChallenges: Array.isArray(source.socialChallenges) ? source.socialChallenges : fallback.socialChallenges,
    achievements: Array.isArray(source.achievements) ? source.achievements : fallback.achievements,
    notes: Array.isArray(source.notes) ? source.notes : fallback.notes,
    calendarBlocks: Array.isArray(source.calendarBlocks) ? source.calendarBlocks : fallback.calendarBlocks,
    focusSessions: Array.isArray(source.focusSessions) ? source.focusSessions : fallback.focusSessions,
    dailyPlan:
      source.dailyPlan &&
      typeof source.dailyPlan === "object" &&
      Array.isArray(source.dailyPlan.blocks) &&
      typeof source.dailyPlan.summary === "string"
        ? {
            summary: source.dailyPlan.summary,
            overloadWarning: source.dailyPlan.overloadWarning,
            blocks: source.dailyPlan.blocks
          }
        : fallback.dailyPlan
  };
}

function readUserName(userMetadata: unknown) {
  if (!userMetadata || typeof userMetadata !== "object") return undefined;

  const source = userMetadata as Record<string, unknown>;
  const fullName = source.full_name;
  const name = source.name;

  if (typeof fullName === "string" && fullName.trim()) return fullName;
  if (typeof name === "string" && name.trim()) return name;
  return undefined;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function initials(value: string) {
  return value
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function buildWeeklyTrend(productivity: number, habit: number, focusMinutes: number, sleepQuality: number) {
  const base = Math.max(42, Math.round((productivity + habit + sleepQuality) / 3) - 8);
  const lift = Math.min(18, Math.round(focusMinutes / 20));
  return [base - 4, base + 2, base - 6, base + 4, base + 1, base + 8, base + lift];
}

function extractTags(text: string) {
  return Array.from(text.matchAll(/#([\w-]+)/g)).map((match) => match[1]);
}

function filterByQuery<T>(items: T[], query: string, pickText: (item: T) => string[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => pickText(item).join(" ").toLowerCase().includes(normalizedQuery));
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}

function estimateMinutesFromRange(startLabel: string, endLabel: string) {
  const startMinutes = parseClockLabel(startLabel);
  const endMinutes = parseClockLabel(endLabel);

  if (startMinutes === null || endMinutes === null) {
    return 45;
  }

  const diff = endMinutes - startMinutes;
  return diff > 0 ? diff : 45;
}

function parseClockLabel(label: string) {
  const match = label.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
