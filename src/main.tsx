import React, { useEffect, useRef, useState } from "react";
import { hasAgentMention, activeMentionAt, insertAgentMention } from "./mentions";
import { accumulateDownload, installApprovedUpdate, type DownloadState } from "./update-installation";
import { persistOnboardingName, previewOnboardingComplete } from "./onboarding-persistence";
import { isRepositorySync, updateProviderHealth, type ProviderFailure } from "./provider-events";
import { MessageContent } from "./message-content";
import { messagePreview } from "./message-blocks";
import { activityMessage } from "./activity-labels";
import { latestRequest } from "./latest-request";
import { submitOnce } from "./submission";
import { readThreadSnapshot, mergeThreadSnapshot } from "./thread-refresh";
import { persistAppearance, readPreviewAppearance, type AppearanceSetting } from "./appearance-persistence";
import { createRoot } from "react-dom/client";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
const LazyEditor = React.lazy(async () => {
  const module = await import("./editor");
  return { default: module.CodeEditor };
});
const LazyDiffEditor = React.lazy(async () => {
  const module = await import("./editor");
  return { default: module.CodeDiffEditor };
});
import {
  Activity,
  Bell,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  FolderGit2,
  GitPullRequest,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Sun,
  TerminalSquare,
  TimerReset,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";
import "./layout.css";
import "./theme.css";
import "./premium.css";
import "./account.css";
import "./chrome-redesign.css";
import "./chrome-fixes.css";
import "./ui-corrections.css";
import "./provider-ui.css";
import "./responsive-fix.css";
import "./premium-plus.css";
import "./threads.css";
import "./native-ui.css";
import "./minimal-ui.css";
import brandIcon from "../src-tauri/icons/wand.svg";

function WandBrand() {
  return <span className="product-brand"><img src={brandIcon} alt="" /><span>Wand</span><em>beta</em></span>;
}

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
type RuntimePlatform = "macos" | "windows" | "linux";
type ThemeName = "obsidian" | "daylight";
type FontName = "system" | "fira-code" | "jetbrains-mono" | "avenir";
const normalizeTheme = (value: string | null | undefined): ThemeName => {
  if (["daylight", "porcelain", "paper", "mint", "lavender"].includes(value || ""))
    return "daylight";
  return "obsidian";
};
const normalizeFont = (value: string | null | undefined): FontName => {
  if (["system", "fira-code", "jetbrains-mono", "avenir"].includes(value || "")) {
    return value as FontName;
  }
  return "system";
};
const fontOptions: Array<{ id: FontName; name: string; description: string }> = [
  { id: "system", name: "System UI", description: "Native and polished" },
  { id: "fira-code", name: "Fira Code", description: "Technical and expressive" },
  { id: "jetbrains-mono", name: "JetBrains Mono", description: "Calm developer focus" },
  { id: "avenir", name: "Avenir Next", description: "Warm and editorial" },
];
const formatWorkspaceTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};
const runtimePlatform = (): RuntimePlatform => {
  if (typeof navigator === "undefined") return "linux";
  const identity = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (identity.includes("mac")) return "macos";
  if (identity.includes("win")) return "windows";
  return "linux";
};
const invoke = <T = unknown,>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> =>
  isTauriRuntime()
    ? tauriInvoke<T>(command, args)
    : Promise.reject(
        new Error("Wand native features are available in the desktop app."),
      );
const listen = <T = unknown,>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> =>
  isTauriRuntime() ? tauriListen<T>(event, handler) : Promise.resolve(() => {});

type View = "home" | "code" | "threads" | "tasks" | "notifications";
type Repo = {
  name: string;
  path: string;
  color: string;
  count: number;
  provider?: string;
};
type Agent = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  color: string;
  scope?: string;
  cli?: string;
  model?: string;
};
type Task = {
  id: string;
  name: string;
  provider: string;
  repo: string;
  cron: string;
  active: boolean;
  status?: string;
  agents: string[];
};
type AgentWorkflow = { name: string; agents: string[]; steps: string[] };
const defaultRepos: Repo[] = [];
const agents: Agent[] = [
  {
    id: "planner",
    name: "Planner",
    role: "Breaks work into executable slices",
    skills: ["planning", "repo analysis"],
    color: "#a98cff",
  },
  {
    id: "builder",
    name: "Builder",
    role: "Implements features and fixes",
    skills: ["typescript", "rust", "testing"],
    color: "#76c6f5",
  },
  {
    id: "reviewer",
    name: "Code reviewer",
    role: "Reviews changes and suggests fixes",
    skills: ["code review", "security"],
    color: "#f9c86a",
  },
  {
    id: "sentinel",
    name: "Sentinel",
    role: "Runs verification in the background",
    skills: ["ci", "dependency audit", "regression"],
    color: "#6fdaa0",
  },
  {
    id: "docs",
    name: "Docs writer",
    role: "Keeps technical docs current",
    skills: ["documentation", "changelog"],
    color: "#f38ba8",
  },
];
const defaultTasks: Task[] = [];
const emptyRepo: Repo = {
  name: "No repository selected",
  path: ".",
  color: "#89b4fa",
  count: 0,
};
const load = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
};
const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};
type ModalField = {
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  secret?: boolean;
  check?: boolean;
  options?: string[];
  optionsFor?: (values: Record<string, string>) => string[];
  multiline?: boolean;
  maxLength?: number;
  directory?: boolean;
};
type ModalRequest = {
  title: string;
  description?: string;
  fields: ModalField[];
  resolve: (values: Record<string, string> | null) => void;
};
const askModal = (title: string, fields: ModalField[], description?: string) =>
  new Promise<Record<string, string> | null>((resolve) =>
    window.dispatchEvent(
      new CustomEvent<ModalRequest>("wand:modal", {
        detail: { title, description, fields, resolve },
      }),
    ),
  );

let desktopNotificationPermission: Promise<boolean> | undefined;
const ensureDesktopNotificationPermission = () => {
  desktopNotificationPermission ??= (async () => {
    try {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  })();
  return desktopNotificationPermission;
};
const notificationPreferenceEnabled = async (category: string) => {
  try {
    const raw = await invoke<string | null>("workspace_setting", {
      key: "notification-prefs",
    });
    if (!raw) return true;
    const prefs = JSON.parse(raw) as Record<string, boolean>;
    return prefs[category] !== false;
  } catch {
    return true;
  }
};
const notifyDesktop = async (category: string, title: string, body: string) => {
  if (!(await notificationPreferenceEnabled(category))) return;
  try {
    if (await ensureDesktopNotificationPermission()) {
      sendNotification({ title, body });
    }
  } catch {}
};
const publishNotice = (category: string, title: string, body = title) => {
  void (async () => {
    if (!(await notificationPreferenceEnabled(category))) return;
    window.dispatchEvent(new CustomEvent("wand:notice", { detail: title }));
    await notifyDesktop(category, title, body);
  })();
};
function App() {
  const [notificationCount, setNotificationCount] = useState(0);
  useEffect(() => {
    const onNotice = (event: Event) => {
      setNotice((event as CustomEvent<string>).detail);
    };
    window.addEventListener("wand:notice", onNotice);
    return () => window.removeEventListener("wand:notice", onNotice);
  }, []);
  useEffect(() => {
    const refresh = () =>
      invoke<any[]>("list_notifications")
        .then((rows) =>
          setNotificationCount(rows.filter((row) => row.unread).length),
        )
        .catch(() => setNotificationCount(0));
    refresh();
    const stop = listen("wand://notifications", refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      stop.then((unsubscribe) => unsubscribe());
      window.clearInterval(timer);
    };
  }, []);
  const [view, setView] = useState<View>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("appearance");
  const openSettings = (tab = "appearance") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  const [repos, setRepos] = useState(() =>
    isTauriRuntime() ? defaultRepos : load("wand.repos", defaultRepos),
  );
  const [tasks, setTasks] = useState(() =>
    isTauriRuntime() ? defaultTasks : load("wand.tasks", defaultTasks),
  );
  const [repo, setRepo] = useState<Repo>(() => {
    const initial = isTauriRuntime()
      ? defaultRepos
      : load<Repo[]>("wand.repos", defaultRepos);
    return initial[0] || emptyRepo;
  });
  const [userName, setUserName] = useState("there");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ id: string; label: string; detail: string; target: View; repo?: string }>>([]);
  const [notice, setNotice] = useState("");
  const [agentCatalog, setAgentCatalog] = useState<Agent[]>(agents);
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [enabledClis, setEnabledClis] = useState<string[]>([]);
  useEffect(() => {
    if (!isTauriRuntime()) {
      localStorage.setItem("wand.repos", JSON.stringify(repos));
    }
  }, [repos]);
  useEffect(() => {
    if (!isTauriRuntime()) {
      localStorage.setItem("wand.tasks", JSON.stringify(tasks));
    }
  }, [tasks]);
  useEffect(() => {
    const refreshTasks = () =>
      invoke<any[]>("list_tasks")
        .then((rows) =>
          setTasks(
            rows.map((r) => ({
              ...r,
              provider: "Agent chain",
              active: !["failed", "cancelled", "completed"].includes(r.status),
              agents: parseJson<string[]>(r.agents, []),
            })),
          ),
        )
        .catch(() => {});
    const stop = listen("wand://task", refreshTasks);
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, []);
  useEffect(() => {
    const term = query.trim().toLowerCase();
    if (!term) { setSearchResults([]); return; }
    let active = true;
    const search = async () => {
      const results: Array<{ id: string; label: string; detail: string; target: View; repo?: string }> = [];
      repos.forEach((item) => {
        if (`${item.name} ${item.path} ${item.provider}`.toLowerCase().includes(term)) results.push({ id: `repo:${item.name}`, label: item.name, detail: `${item.provider} repository`, target: "threads", repo: item.name });
      });
      tasks.forEach((item) => { if (`${item.name} ${item.repo} ${item.status}`.toLowerCase().includes(term)) results.push({ id: `task:${item.id}`, label: item.name, detail: `Task · ${item.status}`, target: "tasks" }); });
      agentCatalog.forEach((item) => { if (`${item.name} ${item.role} ${item.skills.join(" ")}`.toLowerCase().includes(term)) results.push({ id: `agent:${item.id}`, label: `@${item.name}`, detail: `Agent · ${item.role}`, target: "home" }); });
      const [notifications, events] = await Promise.all([
        invoke<any[]>("list_notifications").catch(() => []),
        invoke<any[]>("list_events", { limit: 100 }).catch(() => []),
      ]);
      notifications.forEach((item) => { if (`${item.title} ${item.body} ${item.repo} ${item.author}`.toLowerCase().includes(term)) results.push({ id: `notice:${item.id}`, label: item.title, detail: `${item.provider} · ${item.repo}`, target: "notifications" }); });
      events.forEach((item) => { if (`${item.kind} ${item.message}`.toLowerCase().includes(term)) results.push({ id: `event:${item.id}`, label: item.message, detail: `Activity · ${item.created_at}`, target: "home" }); });
      if (active) setSearchResults(results.slice(0, 12));
    };
    void search();
    return () => { active = false; };
  }, [query, repos, tasks, agentCatalog]);
  useEffect(() => {
    invoke<any[]>("list_tasks")
      .then((rows) =>
        setTasks(
          rows.map((r) => ({
            ...r,
            provider: "Agent chain",
            active: !["failed", "cancelled", "completed"].includes(r.status),
            agents: parseJson<string[]>(r.agents, []),
          })),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (settingsOpen) return;
    invoke<any[]>("list_agents")
      .then((rows) =>
        setAgentCatalog(
          rows.map((r) => ({ ...r, skills: parseJson<string[]>(r.skills, []) })),
        ),
      )
      .catch(() => {});
    invoke<AgentWorkflow[]>("list_agent_workflows")
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
    invoke<string[]>("cli_access")
      .then(setEnabledClis)
      .catch(() => setEnabledClis([]));
  }, [settingsOpen]);
  useEffect(() => {
    invoke<string | null>("user_name")
      .then((value) => {
        if (value) setUserName(value);
      })
      .catch(() => {});
    invoke<any[]>("list_repositories")
      .then((rows) => {
        const next = rows.map((r) => ({
          name: r.name,
          path: r.path,
          provider: r.provider || "local",
          color: "#89b4fa",
          count: 0,
        }));
        setRepos(next);
        setRepo(
          (current) =>
            next.find((item) => item.name === current.name) ||
            next[0] ||
            emptyRepo,
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onName = (event: Event) =>
      setUserName((event as CustomEvent<string>).detail || "there");
    window.addEventListener("wand:user-name", onName);
    return () => window.removeEventListener("wand:user-name", onName);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        (
          document.querySelector(".search input") as HTMLInputElement | null
        )?.focus();
      }
      if (event.key === "Escape") {
        setQuery("");
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Routine sync heartbeats belong in BackgroundStatus, not user notifications.
  useEffect(() => {
    const refreshRepos = () =>
      invoke<any[]>("list_repositories")
        .then((rows) => {
          const next = rows.map((r) => ({
            name: r.name,
            path: r.path,
            provider: r.provider || "local",
            color: "#89b4fa",
            count: 0,
          }));
          setRepos(next);
          setRepo(
            (current) =>
              next.find((item) => item.name === current.name) ||
              next[0] ||
              emptyRepo,
          );
        })
        .catch(() => {});
    const subscriptions = [
      listen<any>("wand://provider", (event) => {
        // Health/error events have no repository count and must never announce success.
        if (!isRepositorySync(event.payload)) return;
        refreshRepos();
        const provider = event.payload?.provider || "Provider";
        const count = event.payload?.count ?? 0;
        publishNotice(
          "provider",
          `${provider} sync completed`,
          `${count} repositories are available in Wand.`,
        );
      }),
      listen<any>("wand://agents", () => {
        invoke<any[]>("list_agents")
          .then((rows) =>
            setAgentCatalog(rows.map((r) => ({ ...r, skills: parseJson<string[]>(r.skills, []) }))),
          )
          .catch(() => {});
      }),
      listen<any>("wand://notifications", (event) => {
        const added = event.payload?.added ?? 0;
        if (added > 0) {
          publishNotice(
            "provider",
            "New review activity",
            `${added} new pull-request notification${added === 1 ? "" : "s"} arrived.`,
          );
        }
      }),
      listen<any>("wand://scheduler", (event) => {
        if (event.payload?.status !== "due") return;
        const name = event.payload?.name || "Scheduled task";
        const message = `${name} is starting in the background.`;
        publishNotice("task", "Scheduled task started", message);
      }),
      listen<any>("wand://agent", (event) => {
        const status = event.payload?.status;
        if (
          status === "completed" ||
          status === "verified" ||
          status === "failed"
        ) {
          const agent = event.payload?.agent || "Agent";
          const title =
            status === "failed"
              ? `${agent} failed`
              : status === "verified"
                ? `${agent} verified the work`
                : `${agent} completed`;
          publishNotice(
            "agent",
            title,
            event.payload?.error || "A background agent stage has finished.",
          );
        }
      }),
    ];
    return () => {
      subscriptions.forEach((subscription) =>
        subscription.then((unsubscribe) => unsubscribe()),
      );
    };
  }, []);
  useEffect(() => {
    document.body.dataset.view = view;
    const go = (e: Event) => setView((e as CustomEvent<View>).detail);
    window.addEventListener("wand:navigate", go);
    return () => window.removeEventListener("wand:navigate", go);
  }, [view]);
  const addRepo = async () => {
    const values = await askModal(
      "Add repository",
      [
        { id: "name", label: "Repository name", placeholder: "wand" },
        {
          id: "path",
          label: "Local folder path",
          placeholder: "~/Code/wand",
          directory: true,
        },
      ],
      "Add a local repository to your Wand workspace.",
    );
    if (!values?.name || !values.path) return;
    try {
      const saved = await invoke<any>("save_repository", {
        name: values.name.trim(),
        path: values.path.trim(),
      });
      const next = {
        name: saved.name,
        path: saved.path,
        color: "#89b4fa",
        count: 0,
      };
      setRepos((current) => [
        ...current.filter((item) => item.name !== next.name),
        next,
      ]);
      setRepo(next);
      setView("threads");
    } catch (error) {
      setNotice(String(error));
    }
  };
  const addTask = async () => {
    const localRepos = repos.filter(
      (item) => !item.provider || item.provider === "local",
    );
    if (!localRepos.length) {
      setNotice(
        "Choose a repository folder in Settings before scheduling a task.",
      );
      openSettings("workspace");
      return;
    }
    if (repo.provider && repo.provider !== "local") {
      setNotice("Tasks run against local folders. Choose a local repository first.");
      return;
    }
    const runtimeAccess = await invoke<string[]>("cli_access").catch(
      () => enabledClis,
    );
    const available = agentCatalog.filter(
      (a) =>
        (!a.scope || a.scope === "workspace" || a.scope === `repo:${repo.name}`) &&
        runtimeAccess.includes(a.cli || "codex"),
    );
    if (!available.length) {
      setNotice("Enable an installed CLI and a compatible agent in Settings first.");
      openSettings("agents");
      return;
    }
    const values = await askModal(
      "Schedule an agent task",
      [
        {
          id: "name",
          label: "Task name",
          placeholder: "Implement the next feature",
        },
        {
          id: "cron",
          label: "Cron expression",
          placeholder: "Leave blank for one-off",
        },
        ...(workflows.length
          ? [{
              id: "workflow",
              label: "Imported workflow (optional)",
              options: ["Manual agent tags", ...workflows.map((workflow) => workflow.name)],
            }]
          : []),
        ...available.map((a) => ({
          id: `agent:${a.id}`,
          label: `Tag ${a.name} · ${a.skills.join(", ")}`,
          check: true,
          value: "false",
        })),
      ],
      "Choose the work and tag the specialists who should handle it.",
    );
    if (!values?.name) return;
    const selected = available
      .filter((a) => values[`agent:${a.id}`] === "true")
      .map((a) => a.id);
    const workflow = workflows.find((item) => item.name === values.workflow);
    const workflowAgents = workflow?.steps?.length ? workflow.steps : workflow?.agents;
    const task = {
      id: crypto.randomUUID(),
      name: values.name.trim(),
      provider: "Agent chain",
      repo: repo.name,
      cron: values.cron?.trim() || "one-off",
      active: true,
      agents: workflowAgents?.length
        ? workflowAgents
        : selected.length
          ? selected
          : ["planner", "builder", "reviewer", "sentinel"].filter((id) =>
              available.some((agent) => agent.id === id),
            ),
    };
    try {
      await invoke("create_task", {
        task: {
          id: task.id,
          name: task.name,
          repo: task.repo,
          cron: task.cron,
          agents: task.agents,
        },
      });
    } catch (error) {
      setNotice(String(error));
      return;
    }
    setTasks((current) => [
      task,
      ...current.filter((item) => item.id !== task.id),
    ]);
    setNotice(`Task saved with ${available.length} applicable agents`);
    setView("tasks");
  };
  const runTask = async (t: Task) => {
    const selected = t.agents
      .map((id) => agentCatalog.find((a) => a.id === id))
      .filter(Boolean) as Agent[];
    const chain = selected.map((a) => a.name).join(" → ");
    const instructions = selected
      .map((a) => `${a.name}: ${a.role}`)
      .join("\n");
    const enabled = await invoke<string[]>("cli_access").catch(() =>
      JSON.parse(localStorage.getItem("wand.clis") || "[]") as string[],
    );
    const configured = selected.find((a) => a.cli && enabled.includes(a.cli));
    const cli = configured?.cli || enabled[0] || "codex";
    const model = configured?.model || "default";
    const agent_configs = Object.fromEntries(
      selected.map((a) => [
        a.id,
        {
          cli: a.cli && enabled.includes(a.cli) ? a.cli : cli,
          model: a.model || "default",
          responsibility: a.role || "",
          skills: a.skills,
        },
      ]),
    );
    try {
      await invoke("run_agent_chain_v2", {
        req: {
          task_id: t.id,
          prompt: `${t.name}\nHandoff chain: ${chain}\nAgent instructions:\n${instructions}\nThe final Sentinel verifier must inspect the complete result in the background.`,
          repo_path: repos.find((r) => r.name === t.repo)?.path || ".",
          agents: t.agents,
          cli,
          model,
          agent_configs,
        },
      });
      setNotice(
        `Started ${chain || "agent chain"} using enabled runtimes; verifier queued`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setNotice(
        `Could not start ${chain || "agent chain"}: ${reason || "check the task, repository, and enabled CLI settings"}`,
      );
    }
  };
  const cancelTask = async (t: Task) => {
    try {
      await invoke("cancel_task", { taskId: t.id });
      setTasks((current) =>
        current.map((item) =>
          item.id === t.id ? { ...item, active: false, status: "cancelled" } : item,
        ),
      );
      setNotice(`Cancelled ${t.name}`);
    } catch (error) {
      setNotice(String(error));
    }
  };
  const nav = (v: View) => (
    <button
      className={view === v ? "nav active" : "nav"}
      onClick={() => {
        setQuery("");
        setView(v);
      }}
    >
      {v === "home" ? (
        <LayoutDashboard />
      ) : v === "code" ? (
        <Code2 />
      ) : v === "threads" ? (
        <MessageSquare />
      ) : v === "tasks" ? (
        <Clock3 />
      ) : v === "notifications" ? (
        <Bell />
      ) : (
        <Settings />
      )}
      <span>{v[0].toUpperCase() + v.slice(1)}</span>
    </button>
  );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <WandBrand />
        </div>
        <div className="navgroup">
          {nav("home")}
          {nav("code")}
          {nav("threads")}
          {nav("tasks")}
          {nav("notifications")}
        </div>
        <div className="navgroup repos">
          <label>
            Repositories{" "}
            <button className="sideplus" onClick={addRepo}>
              <Plus size={13} />
            </button>
          </label>
          {repos.map((r) => (
            <button
              key={r.name}
              className={"repo " + (repo.name === r.name ? "selected" : "")}
              onClick={() => {
                setRepo(r);
                setView("threads");
              }}
            >
              <i style={{ background: r.color }} />
              <span>{r.name}</span>
              <em>{r.count}</em>
            </button>
          ))}
        </div>
      </aside>
      <main>
        <header>
          <div className="actions">
            <div className="search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anything"
              />
              <kbd>⌘ K</kbd>
            </div>
            <button
              className="iconbtn"
              onClick={() => setView("notifications")}
              title={notificationCount ? `${notificationCount} unread notifications` : "Notifications"}
              aria-label={notificationCount ? `${notificationCount} unread notifications` : "Notifications"}
            >
              <Bell size={17} />
              {notificationCount > 0 && (
                <span className="notification-badge" aria-hidden="true">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              )}
            </button>
            <AccountMenu onSettings={() => openSettings()} />
          </div>
        </header>
        {query.trim() && (
          <div className="search-palette">
            {searchResults.map((result) => (
                <button
                  key={result.id}
                  onMouseDown={() => {
                    if (result.id.startsWith("agent:")) openSettings("agents");
                    else { if (result.repo) { const selectedRepo = repos.find((item) => item.name === result.repo); if (selectedRepo) setRepo(selectedRepo); } setView(result.target); }
                    setQuery("");
                  }}
                >
                  <span>{result.label}</span>
                  <small>{result.detail}</small>
                </button>
              ))}
            {searchResults.length === 0 && <div className="search-empty">No matching repositories, tasks, agents, activity, or notifications.</div>}
          </div>
        )}
        {notice && (
          <button className="toast" onClick={() => setNotice("")}>
            {notice} ×
          </button>
        )}
        {view === "home" ? (
          <Home
            openSettings={openSettings}
            settingsOpen={settingsOpen}
            openTasks={() => setView("tasks")}
            userName={userName}
          />
        ) : view === "code" ? (
          <CodeWorkspace key={`${repo.name}:${repo.path}`} repo={repo} />
        ) : view === "threads" ? (
          <Threads key={repo.name} repo={repo} agents={agentCatalog} />
        ) : view === "tasks" ? (
          <Tasks tasks={tasks} addTask={addTask} runTask={runTask} cancelTask={cancelTask} />
        ) : (
          <Notifications />
        )}
      </main>
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          repos={repos}
          setRepos={setRepos}
          initialTab={settingsTab}
        />
      )}
    </div>
  );
}
function Home({
  settingsOpen,
  openSettings,
  openTasks,
  userName,
}: {
  settingsOpen: boolean;
  openSettings: (tab?: string) => void;
  openTasks: () => void;
  userName: string;
}) {
  type Event = {
    id: number;
    kind: string;
    message: string;
    created_at: string;
  };
  const [events, setEvents] = useState<Event[]>([]);
  const [homeAgents, setHomeAgents] = useState<Array<{ id: string; name: string; role: string; cli: string; model: string }>>([]);
  const [loadError, setLoadError] = useState("");
  const [loadingActivity, setLoadingActivity] = useState(true);
  const activityRequests = useRef(latestRequest());
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [localHour, setLocalHour] = useState<number | null>(null);
  const refresh = () => {
    const isCurrent = activityRequests.current.begin();
    setLoadingActivity(true);
    Promise.all([
      invoke<Event[]>("list_events", { limit: 12 }),
      invoke<typeof homeAgents>("list_agents"),
    ]).then(([nextEvents, agents]) => {
      if (!isCurrent()) return;
      setEvents(nextEvents); setHomeAgents(agents); setLoadError("");
    }).catch(() => {
      if (isCurrent()) setLoadError("Could not refresh your activity. Try again.");
    }).finally(() => { if (isCurrent()) setLoadingActivity(false); });
  };
  useEffect(() => {
    refresh();
    const names = ["wand://agent", "wand://agents", "wand://scheduler", "wand://notifications"];
    const stops = names.map((name) => listen(name, refresh));
    return () => {
      activityRequests.current.invalidate();
      stops.forEach((stop) => stop.then((fn) => fn()).catch(() => {}));
    };
  }, [settingsOpen]);
  useEffect(() => {
    const readLocalHour = () => {
      invoke<number>("local_hour")
        .then(setLocalHour)
        .catch(() => setLocalHour(new Date().getHours()));
    };
    readLocalHour();
    const timer = window.setInterval(readLocalHour, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const runs = events.filter((e) => e.kind.startsWith("agent.")).length;
  const reviews = events.filter(
    (e) => e.kind.includes("comment") || e.kind.includes("notification"),
  ).length;
  const hour = localHour ?? new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <section className="content">
      <div className="hero">
        <div>
          <h1>{greeting}, {userName}.</h1>
          <p className="sub">
            Your agents are ready to work across your repositories.
          </p>
        </div>
        <button className="primary" onClick={openTasks}>
          <Plus size={16} /> New task
        </button>
      </div>
      {loadError && <div className="inline-error" role="alert">{loadError} <button className="textbtn" onClick={refresh}>Retry</button></div>}
      <div className="stats">
        <Stat
          icon={Zap}
          value={String(runs)}
          label="Agent events"
          hint="In recent activity"
        />
        <Stat
          icon={GitPullRequest}
          value={String(reviews)}
          label="Review notifications"
          hint="In recent activity"
        />
        <Stat
          icon={TimerReset}
          value={String(events.length)}
          label="Recent events"
          hint="Recent activity"
        />
      </div>
      <div className="sectionhead">
        <div>
          <h2>Activity</h2>
          <p>Events synced to this local workspace.</p>
        </div>
      </div>
      <div className="timeline" aria-busy={loadingActivity}>
        {events.length === 0 && (
          <div className="emptyhint">
            <Sparkles size={20} />
            <h3>{loadingActivity ? "Loading activity…" : loadError ? "Activity unavailable" : "No activity yet"}</h3>
            <p>
              {loadingActivity ? "Reading your recent workspace history." : loadError ? "Retry to load your activity. Your saved history has not been removed." : "Run a task or sync a provider to start your local activity history."}
            </p>
          </div>
        )}
        {(showAllEvents ? events : events.slice(0, 5)).map((event) => (
          <article className="event" key={event.id}>
            <div className="eventicon">
              <Activity size={17} />
            </div>
            <div className="eventbody">
              <div className="eventtop">
                <span className="kind">{event.kind}</span>
                <span className="time">{formatWorkspaceTime(event.created_at)}</span>
              </div>
              <h3>{activityMessage(event.kind, event.message, homeAgents)}</h3>
            </div>
          </article>
        ))}
      </div>
      {events.length > 5 && <button className="textbtn activity-expand" onClick={() => setShowAllEvents(!showAllEvents)}>{showAllEvents ? "Show less" : `Show all ${events.length} events`}</button>}
      <div className="sectionhead agents">
        <div>
          <h2>Your agents</h2>
          <p>Configured coding specialists.</p>
        </div>
        <button className="textbtn" onClick={() => openSettings("agents")}>
          Manage agents →
        </button>
      </div>
      <div className="agentgrid">
        {homeAgents.slice(0, 3).map((agent) => <Agent key={agent.id} icon={Bot} name={agent.name} desc={agent.role} status={`${agent.cli} · ${agent.model === "default" ? "CLI default model" : agent.model}`} />)}
        {!homeAgents.length && <p className="sub">{loadingActivity ? "Loading agents…" : loadError ? "Agent list could not be refreshed." : "Configure your first agent in Settings."}</p>}
      </div>
    </section>
  );
}
function Stat({
  icon: Icon,
  value,
  label,
  hint,
}: {
  icon: any;
  value: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="stat">
      <Icon size={18} />
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{hint}</small>
    </div>
  );
}
function Agent({
  icon: Icon,
  name,
  desc,
  status,
}: {
  icon: any;
  name: string;
  desc: string;
  status: string;
}) {
  return (
    <div className="agent">
      <div className="agenticon">
        <Icon size={18} />
      </div>
      <div>
        <h3>{name}</h3>
        <p>{desc}</p>
        <small>
          {status}
        </small>
      </div>
    </div>
  );
}
function CodeWorkspace({ repo }: { repo: Repo }) {
  const [editorTheme, setEditorTheme] = useState<"vs" | "vs-dark">(() =>
    normalizeTheme(document.body.dataset.theme) === "daylight" ? "vs" : "vs-dark",
  );
  const [path, setPath] = useState("");
  const [draftPath, setDraftPath] = useState("README.md");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [mode, setMode] = useState<"file" | "diff">("file");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const loadRequest = useRef(0);
  const [worktreeStatus, setWorktreeStatus] = useState("");
  useEffect(() => {
    const sync = () =>
      setEditorTheme(
        normalizeTheme(document.body.dataset.theme) === "daylight" ? "vs" : "vs-dark",
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const load = async () => {
    if (saving) return;
    const request = ++loadRequest.current;
    const requestedPath = draftPath;
    setLoading(true);
    setPath("");
    setSaveStatus("");
    try {
      setError("");
      const versions = await invoke<{ original: string; modified: string }>(
        "git_file_versions",
        { repoPath: repo.path, relativePath: requestedPath },
      );
      if (request !== loadRequest.current) return;
      setPath(requestedPath);
      setOriginal(versions.original);
      setContent(versions.modified);
    } catch (e) {
      if (request === loadRequest.current) setError(String(e));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };
  const save = async () => {
    if (saving || loading || !path) return;
    try {
      setSaving(true);
      setError("");
      await invoke("write_repo_file", {
        repoPath: repo.path,
        relativePath: path,
        content,
      });
      // Saving the working tree must not replace the HEAD comparison baseline.
      setSaveStatus(`Saved ${path}. Git diff still compares against HEAD.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  const createWorktree = async () => {
    const values = await askModal("Create worktree", [
      { id: "branch", label: "New branch", placeholder: "feature/my-change" },
    ], "Creates an isolated sibling checkout for this repository.");
    if (!values?.branch) return;
    try {
      const created = await invoke<{ path: string; branch: string }>("create_worktree", {
        repoPath: repo.path,
        branch: values.branch,
      });
      setWorktreeStatus(`Created ${created.branch} at ${created.path}`);
    } catch (cause) {
      setWorktreeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const applyPatch = async () => {
    const values = await askModal("Apply Git patch", [
      { id: "patch", label: "Unified diff patch", multiline: true, placeholder: "diff --git a/... b/..." },
    ], "Applies this patch to the selected repository. Review it before continuing.");
    if (!values?.patch) return;
    try {
      await invoke("apply_git_patch", { repoPath: repo.path, patch: values.patch });
      setWorktreeStatus("Patch applied. Refresh the file or Git diff to review it.");
      await load();
    } catch (cause) {
      setWorktreeStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => {
    load();
  }, [repo.name]);
  const language = path.endsWith(".rs")
    ? "rust"
    : path.endsWith(".ts") || path.endsWith(".tsx")
      ? "typescript"
      : path.endsWith(".json")
        ? "json"
        : "markdown";
  return (
    <section className="content code-workspace">
      <div className="code-toolbar">
        <div>
          <p className="eyebrow">
            <Code2 size={14} /> REPOSITORY CODE
          </p>
          <h1>{repo.name}</h1>
          <p className="sub">
            Edit files and inspect Git changes without leaving Wand.
          </p>
        </div>
        <div className="code-controls">
          <input
            value={draftPath}
            onChange={(e) => setDraftPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="relative path, e.g. src/main.tsx"
          />
          <div className="code-mode-controls" aria-label="Editor mode">
            <button
              className={"outline" + (mode === "file" ? " active" : "")}
              onClick={() => setMode("file")}
            >
              File
            </button>
            <button
              className={"outline" + (mode === "diff" ? " active" : "")}
              onClick={() => setMode("diff")}
            >
              Git diff
            </button>
          </div>
          <div className="code-action-controls" aria-label="Repository actions">
            <button
              className="outline"
              disabled={mode !== "file" || saving || loading || !path}
              onClick={save}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="outline" disabled={!repo.path} onClick={createWorktree}>
              New worktree
            </button>
            <button className="outline" disabled={!repo.path} onClick={applyPatch}>
              Apply patch
            </button>
            <button className="primary" disabled={saving || loading} onClick={load}>
              Open
            </button>
          </div>
        </div>
      </div>
      {worktreeStatus && <p className="code-operation-status" role="status">{worktreeStatus}</p>}
      {saveStatus && <p className="code-operation-status" role="status">{saveStatus}</p>}
      {loading ? <div className="editor-loading" role="status">Loading file…</div> : error ? (
        <div className="emptyhint">
          <h3>Unable to open file</h3>
          <p>{error}</p>
        </div>
      ) : (
        <div className="editor-shell">
          <React.Suspense fallback={<div className="editor-loading">Loading editor…</div>}>
          {mode === "file" ? (
            <LazyEditor
              height="100%"
              theme={editorTheme}
              language={language}
              value={content}
              onChange={(value) => setContent(value || "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          ) : (
            <LazyDiffEditor
              height="100%"
                theme={editorTheme}
              language={language}
              original={original}
              modified={content}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                readOnly: true,
                automaticLayout: true,
              }}
            />
          )}
          </React.Suspense>
        </div>
      )}
    </section>
  );
}
function Threads({ repo, agents }: { repo: Repo; agents: Agent[] }) {
  type Message = {
    id: number;
    repo?: string;
    author: string;
    body: string;
    created_at: string;
    agent_ids: string[];
    parent_id?: number | null;
  };
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [tagged, setTagged] = useState<string[]>([]);
  const [postError, setPostError] = useState("");
  const [posting, setPosting] = useState(false);
  const postLock = useRef(false);
  const [selected, setSelected] = useState<Message | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<number, string>>({});
  const [pendingPost, setPendingPost] = useState<number | null>(null);
  const commentLock = useRef(false);
  const [refreshError, setRefreshError] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const loadVersion = useRef(0);
  const comment = selected ? commentDrafts[selected.id] || "" : "";
  const commentError = selected ? commentErrors[selected.id] || "" : "";
  const commentPending = pendingPost !== null;
  const setComment = (value: string) => {
    if (selected) setCommentDrafts((drafts) => ({ ...drafts, [selected.id]: value }));
  };
  const addComment = async () => {
    if (!selected || !comment.trim() || commentPending) return;
    const postId = selected.id;
    const submittedDraft = comment;
    await submitOnce(commentLock, async () => {
      setPendingPost(postId);
      setCommentErrors((errors) => ({ ...errors, [postId]: "" }));
      try {
        await invoke("create_thread_message", {
          repo: repo.name, author: "You", body: comment.trim(),
          agentIds: [], parentId: postId,
        });
        setCommentDrafts((drafts) => drafts[postId] === submittedDraft
          ? { ...drafts, [postId]: "" } : drafts);
        await load();
      } catch (error) { setCommentErrors((errors) => ({ ...errors, [postId]: String(error) })); }
      finally { setPendingPost(null); }
    });
  };
  const hasRepo = repo.name !== emptyRepo.name;
  const load = async () => {
    if (!hasRepo) return;
    const version = ++loadVersion.current;
    setLoadingMessages(true);
    setRefreshError("");
    const result = await readThreadSnapshot(() => invoke<Message[]>("list_thread_messages", { repo: repo.name }));
    if (version !== loadVersion.current) return;
    if (result.messages !== null) setMessages(current => mergeThreadSnapshot(current, result.messages));
    setRefreshError(result.error || "");
    setLoadingMessages(false);
  };
  useEffect(() => {
    load();
  }, [repo.name, hasRepo]);
  useEffect(() => {
    if (!hasRepo) return;
    const stop = listen<Message>("wand://thread", (event) => {
      if (event.payload.repo !== repo.name) return;
      setMessages(current => mergeThreadSnapshot(current, [event.payload]));
    });
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, [repo.name, hasRepo]);
  const create = async () => {
    if (!hasRepo || !draft.trim()) return;
    await submitOnce(postLock, async () => {
      setPosting(true);
      setPostError("");
      try {
        await invoke("create_thread_message", {
          repo: repo.name,
          author: "You",
          body: draft.trim(),
          agentIds: tagged,
        });
        setDraft("");
        setTagged([]);
        await load();
      } catch (cause) {
        setPostError(
          cause instanceof Error ? cause.message : String(cause),
        );
      } finally {
        setPosting(false);
      }
    });
  };
  return (
    <section className="content threads-page">
      <div className="hero compact">
        <div>
          <p className="eyebrow">
            <FolderGit2 size={14} /> REPOSITORY
          </p>
          <h1>{hasRepo ? repo.name : "Repository threads"}</h1>
          <p className="sub">
            {hasRepo
              ? "Threads and agent context for this local repository."
              : "Select a repository to start a local conversation with your agents."}
          </p>
        </div>
      </div>
      {!hasRepo ? (
        <div className="emptyhint threads-empty">
          <FolderGit2 size={24} />
          <h3>Select a repository to start a thread</h3>
          <p>
            Choose a repository from the sidebar to keep messages and agent
            context scoped to that project.
          </p>
        </div>
      ) : (
        <>
          <div className="thread-composer" aria-busy={posting}>
            <AgentMentionInput
              repo={repo.name}
              value={draft}
              onChange={setDraft}
              agents={agents}
              tagged={tagged}
              onTagged={setTagged}
              placeholder="Write a repository thread… Type @ to tag an agent"
              disabled={posting}
            />
            <button className="primary" disabled={posting || !draft.trim()} onClick={create}>
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
          {postError && (
            <div className="thread-error" role="alert">
              Could not post this thread: {postError}
            </div>
          )}
          {refreshError && <div className="thread-error thread-refresh-error" role="alert">
            <span>Could not refresh posts: {refreshError}. {messages.length > 0 ? "Previously loaded posts are still shown." : "Try loading the repository history again."}</span>
            <button className="outline" disabled={loadingMessages} onClick={() => void load()}>Retry loading posts</button>
          </div>}
          <div className={`thread-layout${selected ? " has-detail" : ""}`}>
          <div className="threadlist" aria-busy={loadingMessages}>
            {messages.length === 0 ? (
              <div className="emptyhint">
                <MessageSquare size={20} />
                <h3>{loadingMessages ? "Loading posts…" : refreshError ? "Posts unavailable" : "No repository messages yet"}</h3>
                <p>
                  {loadingMessages ? "Reading this repository’s history." : refreshError ? "Retry loading to see this repository’s history." : "Start the conversation for this repository and keep the context local."}
                </p>
              </div>
            ) : (
              messages.filter((message) => !message.parent_id).map((message) => (
                <button className={"thread thread-card " + (selected?.id === message.id ? "selected" : "")} key={message.id} onClick={() => setSelected(message)}>
                  <div className="threadicon">
                    <Hash size={16} />
                  </div>
                  <div>
                    <h3>{messagePreview(message.body)}</h3>
                    <p>
                      {message.author} · {formatWorkspaceTime(message.created_at)}
                    </p>
                  </div>
                  {message.agent_ids?.map((id) => <span className="agent-mention" key={id}>@{agents.find((agent) => agent.id === id)?.name || id}</span>)}
                  <span className="tag blue">post</span>
                  <ChevronDown size={14} />
                </button>
              ))
            )}
          </div>
          {selected && <section className="thread-detail-pane" aria-label="Post details">
            <div className="thread-detail-head"><div><span className="eyebrow">POST DETAILS</span><h2>{selected.author}</h2></div><button className="iconbtn" aria-label="Close post details" onClick={() => setSelected(null)}>×</button></div>
            <p className="thread-detail-time">{formatWorkspaceTime(selected.created_at)}</p>
            <MessageContent content={selected.body} />
            {selected.agent_ids?.length > 0 && <div className="thread-detail-tags">{selected.agent_ids.map((id) => <span className="agent-mention" key={id}>@{agents.find((agent) => agent.id === id)?.name || id}</span>)}</div>}
            <div className="thread-comments">
              <h3>Comments</h3>
              {messages.filter((message) => message.parent_id === selected.id).map((message) => (
                <article key={message.id} className="post-comment">
                  <strong>{agents.find((agent) => agent.id === message.author)?.name || message.author}</strong>
                  <time>{formatWorkspaceTime(message.created_at)}</time>
                  <MessageContent content={message.body} />
                </article>
              ))}
              <textarea aria-label="Comment on selected post" placeholder="Write a comment…" value={comment} onChange={(event) => setComment(event.target.value)} />
              {commentError && <p role="alert">{commentError}</p>}
              <button className="primary" disabled={commentPending || !comment.trim()} onClick={addComment}>{commentPending ? "Posting…" : "Post comment"}</button>
            </div>
          </section>}
          </div>
        </>
      )}
    </section>
  );
}
function Tasks({
  tasks,
  addTask,
  runTask,
  cancelTask,
}: {
  tasks: Task[];
  addTask: () => void;
  runTask: (t: Task) => void;
  cancelTask: (t: Task) => void;
}) {
  type Run = {
    id: string;
    task_id: string;
    scheduled_at: string;
    started_at?: string;
    finished_at?: string;
    status: string;
    error?: string;
  };
  type Transcript = {
    id: number; run_id: string; task_id: string; repo: string; agent: string;
    stage: number; status: string; content: string; created_at: string;
  };
  type AgentEvent = {
    run_id?: string; task_id?: string; agent?: string; stage?: number; status?: string;
  };
  type AgentOutput = {
    run_id: string; task_id: string; agent: string; stage: number;
    stream: "stdout" | "stderr"; chunk: string;
  };
  type LiveOutput = {
    agent: string; stage: number; content: string; truncated: boolean;
  };
  const liveOutputLimit = 128_000;
  const [runs, setRuns] = useState<Run[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript[]>>({});
  const [liveOutputs, setLiveOutputs] = useState<Record<string, LiveOutput>>({});
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const load = () =>
    invoke<Run[]>("list_task_runs", { limit: 30 })
      .then(setRuns)
      .catch(() => setRuns([]));
  useEffect(() => {
    load();
    const stops = [
      listen("wand://scheduler", load),
      listen<AgentEvent>("wand://agent", (event) => {
        load();
        const payload = event.payload;
        if (!payload.run_id || !payload.stage || !payload.agent) return;
        if (payload.status === "running") {
          setLiveOutputs((current) => {
            const previous = current[payload.run_id!];
            return {
              ...current,
              [payload.run_id!]: previous?.stage === payload.stage
                ? previous
                : { agent: payload.agent!, stage: payload.stage!, content: "", truncated: false },
            };
          });
          return;
        }
        if (["completed", "verified", "failed", "cancelled"].includes(payload.status || "")) {
          if (payload.task_id) {
            invoke<Transcript[]>("list_agent_transcripts", { taskId: payload.task_id })
              .then((rows) => setTranscripts((current) => ({
                ...current,
                [payload.run_id!]: rows.filter((row) => row.run_id === payload.run_id),
              })))
              .catch(() => {});
          }
          setLiveOutputs((current) => {
            if (current[payload.run_id!]?.stage !== payload.stage) return current;
            const next = { ...current };
            delete next[payload.run_id!];
            return next;
          });
        }
      }),
      listen<AgentOutput>("wand://agent-output", (event) => {
        const payload = event.payload;
        if (!payload.run_id || !payload.chunk) return;
        setLiveOutputs((current) => {
          const previous = current[payload.run_id];
          const combined = `${previous?.stage === payload.stage ? previous.content : ""}${payload.chunk}`;
          const truncated = combined.length > liveOutputLimit || previous?.truncated === true;
          return {
            ...current,
            [payload.run_id]: {
              agent: payload.agent,
              stage: payload.stage,
              content: combined.slice(-liveOutputLimit),
              truncated,
            },
          };
        });
      }),
    ];
    return () => {
      stops.forEach((stop) => stop.then((fn) => fn()));
    };
  }, []);
  const summary = {
    running: runs.filter((r) => r.status === "running").length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
  };
  const summaryItems: Array<[string, number, string]> = [
    ["running", summary.running, "Running"],
    ["completed", summary.completed, "Completed"],
    ["failed", summary.failed, "Failed"],
  ];
  const retry = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) runTask(task);
  };
  const toggleTranscript = async (run: Run) => {
    if (expandedRun === run.id) { setExpandedRun(null); return; }
    setExpandedRun(run.id);
    if (!transcripts[run.id]) {
      const rows = await invoke<Transcript[]>("list_agent_transcripts", { taskId: run.task_id }).catch(() => []);
      setTranscripts((current) => ({ ...current, [run.id]: rows.filter((row) => row.run_id === run.id) }));
    }
  };
  return (
    <section className="content">
      <div className="hero compact">
        <div>
          <p className="eyebrow">
            <Clock3 size={14} /> AUTOMATIONS
          </p>
          <h1>Scheduled tasks</h1>
          <p className="sub">
            Persisted locally and ready for agent execution.
          </p>
        </div>
        <button className="primary" onClick={addTask}>
          <Plus size={16} /> Schedule task
        </button>
      </div>
      {tasks.map((t) => (
        <div className="taskcard" key={t.id}>
          <div className="taskicon">
            <Zap size={17} />
          </div>
          <div>
            <h3>{t.name}</h3>
            <p>
              {t.provider} · {t.repo}
            </p>
          </div>
          <code>{t.cron}</code>
          <span className={"tag " + (t.active ? "green" : t.status === "failed" ? "red" : "blue")}>
            {t.status === "cancelled"
              ? "Cancelled"
              : t.status === "completed"
                ? "Completed"
                : t.status === "failed"
                  ? "Failed"
                  : t.active
                    ? "Active"
                    : "Paused"}
          </span>
          <button className="run" onClick={() => runTask(t)}>
            <Play size={14} /> Run now
          </button>
          {t.active && (
            <button className="run" onClick={() => cancelTask(t)}>
              Cancel
            </button>
          )}
        </div>
      ))}
      <div className="sectionhead">
        <div>
          <h2>Run history</h2>
          <p>Durable run history for this local workspace.</p>
        </div>
        {runs.length > 0 && (
          <div className="run-summary">
            {summaryItems
              .filter((item: [string, number, string]) => item[1] > 0)
              .map((item) => (
                <span
                  className={"summary-chip summary-" + item[0]}
                  key={item[0]}
                >
                  <i />
                  <b>{item[1]}</b>
                  {item[2]}
                </span>
              ))}
          </div>
        )}
      </div>
      <div className="run-history">
        {runs.length === 0 ? (
          <div className="emptyhint">
            <Sparkles size={20} />
            <h3>No scheduled runs yet</h3>
            <p>
              When a cron slot starts, its status and any failure are recorded
              here.
            </p>
          </div>
        ) : (
          runs.map((run) => {
            const live = liveOutputs[run.id];
            return <React.Fragment key={run.id}>
            <div className="run-row">
              <div>
                <b>
                  {tasks.find((t) => t.id === run.task_id)?.name || run.task_id}
                </b>
                <small>
                  {formatWorkspaceTime(run.scheduled_at)}
                  {run.error ? " · " + run.error : ""}
                </small>
              </div>
              <span
                className={
                  "tag " +
                  (run.status === "completed"
                    ? "green"
                    : run.status === "failed"
                      ? "red"
                      : "blue")
                }
              >
                {run.status}
              </span>
              {live && <span className="tag purple live-output-tag"><i /> Streaming</span>}
              <button className="retry-run" onClick={() => toggleTranscript(run)}>
                <ChevronDown size={13} /> {expandedRun === run.id ? "Hide output" : live ? "View live output" : "View transcript"}
              </button>
              {run.status === "failed" ? (
                <button
                  className="retry-run"
                  onClick={() => retry(run.task_id)}
                >
                  <RotateCcw size={13} /> Retry
                </button>
              ) : run.status === "running" ? (
                <button
                  className="retry-run"
                  onClick={() => retry(run.task_id)}
                >
                  <Play size={13} /> Re-run
                </button>
              ) : null}
            </div>
            {expandedRun === run.id && (
              <div className="transcript-panel">
                {live && (
                  <article className="transcript-stage transcript-stage-live">
                    <div><b>Stage {live.stage} · {live.agent}</b><span className="tag purple"><i /> streaming</span></div>
                    <pre role="log" aria-live="polite">{live.truncated ? "[Earlier live output hidden]\n" : ""}{live.content || "Waiting for agent output…"}</pre>
                  </article>
                )}
                {!live && (transcripts[run.id] || []).length === 0 ? <p className="sub">No persisted stage output for this run yet.</p> : (transcripts[run.id] || []).map((stage) => (
                  <article className="transcript-stage" key={stage.id}>
                    <div><b>Stage {stage.stage} · {stage.agent}</b><span className={"tag " + (stage.status === "failed" ? "red" : stage.status === "verified" ? "green" : "blue")}>{stage.status}</span></div>
                    <MessageContent content={stage.content} />
                  </article>
                ))}
              </div>
            )}
            </React.Fragment>
          })
        )}
      </div>
    </section>
  );
}
function Notifications() {
  type Notice = {
    id: string;
    provider: string;
    repo: string;
    title: string;
    body: string;
    url: string;
    author: string;
    unread: boolean;
    created_at: string;
  };
  const [actionMessage, setActionMessage] = useState("");
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const load = () =>
    invoke<Notice[]>("list_notifications")
      .then(setItems)
      .catch(() => setItems([]));
  useEffect(() => {
    load();
    const stop = listen("wand://notifications", load);
    return () => {
      stop.then((fn) => fn());
    };
  }, []);
  const sync = async () => {
    setLoading(true);
    setActionMessage("");
    try {
      const statuses = await Promise.all(
          ["github", "azure-devops", "linear"].map(async (provider) => [
            provider,
            await invoke<boolean>("provider_status", { provider }).catch(() => false),
          ] as const),
      );
      const connected = new Set(
        statuses.filter(([, isConnected]) => isConnected).map(([provider]) => provider),
      );
      const syncTargets = Array.from(connected);

      if (syncTargets.length === 0) {
        setActionMessage("Connect GitHub, Azure DevOps, or Linear in Settings before syncing activity.");
        return;
      }

      const outcomes = await Promise.allSettled(
        syncTargets.map(async (provider) => {
          if (provider === "linear") {
            return ["Linear", await invoke<number>("sync_linear_activity")] as const;
          }
          if (provider === "github") {
            return ["GitHub", await invoke<number>("sync_github_activity")] as const;
          }
          const providerUrl = await invoke<string | null>("provider_url", { provider });
          if (!providerUrl) {
            throw new Error("Add your Azure DevOps organization URL in Settings before syncing.");
          }
          return ["Azure DevOps", await invoke<number>("sync_azure_activity", { providerUrl })] as const;
        }),
      );
      const completed: Array<readonly [string, number]> = [];
      const failures: string[] = [];
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") completed.push(outcome.value);
        else failures.push(String(outcome.reason));
      }

      if (completed.length > 0) {
        const summary = completed
          .map(([provider, added]) => `${provider}${added > 0 ? ` (${added} new)` : ""}`)
          .join(" and ");
        setActionMessage(`Synced ${summary}.`);
      }
      if (failures.length > 0) {
        setActionMessage(
          completed.length > 0
            ? `Synced ${completed.map(([provider]) => provider).join(" and ")}. ${failures[0]}`
            : failures[0],
        );
      }
      await load();
    } catch (error) {
      setActionMessage(String(error));
    } finally {
      setLoading(false);
    }
  };
  const mark = async () => {
    await invoke("mark_notifications_read").catch(() => {});
    setItems(items.map((x) => ({ ...x, unread: false })));
  };
  const actOnPullRequest = async (item: Notice, action: "comment" | "approve") => {
    if (item.provider !== "github") return;
    const match = item.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
    if (!match) {
      setActionMessage("This notification does not contain a GitHub pull-request URL.");
      return;
    }
    const values = await askModal(
      action === "approve" ? "Approve pull request" : "Comment on pull request",
      [{ id: "body", label: action === "approve" ? "Optional review note" : "Comment", placeholder: "Share context with the team…", multiline: true, maxLength: 4000 }],
      `${match[1]} · pull request #${match[2]}`,
    );
    if (!values) return;
    try {
      const message = await invoke<string>("github_pull_request_action", { repo: match[1], pullNumber: Number(match[2]), action, body: values.body || "" });
      setActionMessage(message);
      await sync();
    } catch (error) {
      setActionMessage(String(error));
    }
  };
  const commentOnAzurePullRequest = async (item: Notice) => {
    const values = await askModal("Comment on Azure pull request", [{ id: "body", label: "Comment", placeholder: "Share context with the team…", multiline: true, maxLength: 4000 }], item.repo);
    if (!values?.body) return;
    try {
      setActionMessage(await invoke<string>("azure_pull_request_comment", { url: item.url, body: values.body }));
      await sync();
    } catch (error) {
      setActionMessage(String(error));
    }
  };
  const approveAzurePullRequest = async (item: Notice) => {
    const confirmed = await askModal("Approve Azure pull request", [], item.repo);
    if (!confirmed) return;
    try {
      setActionMessage(await invoke<string>("azure_pull_request_approve", { url: item.url }));
      await sync();
    } catch (error) {
      setActionMessage(String(error));
    }
  };
  return (
    <section className="content">
      <div className="hero compact">
        <div>
          <p className="eyebrow">
            <Bell size={14} /> INBOX
          </p>
          <h1>Notifications</h1>
          <p className="sub">
            PR comments and agent events that need your attention.
          </p>
        </div>
        <div className="notice-actions">
          <button className="outline" onClick={sync}>
            {loading ? "Syncing…" : "Sync"}
          </button>
          <button className="textbtn" onClick={mark}>
            Mark all read
          </button>
        </div>
      </div>
      {actionMessage && <p className="provider-message">{actionMessage}</p>}
      {items.length === 0 ? (
        <div className="emptyhint">
          <MessageSquare size={20} />
          <h3>Your inbox is clear</h3>
          <p>
            Connect a provider and sync to surface pull-request comments here.
          </p>
        </div>
      ) : (
        items.map((item) => (
          <div
            className={"notice " + (item.unread ? "unread" : "")}
            key={item.id}
          >
            <div className="eventicon purple">
              <MessageSquare size={17} />
            </div>
            <div>
              <b>{item.title}</b>
              <p>
                {item.author} · {item.repo} — {item.body}
              </p>
            </div>
            <span>{item.provider}</span>
            <div className="notice-actions">
              <a className="textbtn" href={item.url || "#"} target="_blank" rel="noreferrer">Open</a>
              {item.provider === "github" && <button className="textbtn" onClick={() => actOnPullRequest(item, "comment")}>Comment</button>}
              {item.provider === "github" && <button className="textbtn" onClick={() => actOnPullRequest(item, "approve")}>Approve</button>}
              {item.provider === "azure-devops" && <button className="textbtn" onClick={() => commentOnAzurePullRequest(item)}>Comment</button>}
              {item.provider === "azure-devops" && <button className="textbtn" onClick={() => approveAzurePullRequest(item)}>Approve</button>}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
function SettingsView({
  repos,
  setRepos,
}: {
  repos: Repo[];
  setRepos: React.Dispatch<React.SetStateAction<Repo[]>>;
}) {
  const [root, setRoot] = useState("");
  const [scanError, setScanError] = useState("");
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    invoke<string | null>("workspace_root")
      .then((value) => {
        if (value) setRoot(value);
      })
      .catch(() => {});
  }, []);
  const scan = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose your repositories folder",
    });
    if (typeof selected !== "string") return;
    setScanning(true);
    setScanError("");
    try {
      const rows = await invoke<any[]>("scan_repositories", {
        rootPath: selected,
      });
      await invoke("save_workspace_root", { root: selected });
      setRoot(selected);
      setRepos(
        rows.map((r) => ({
          name: r.name,
          path: r.path,
          color: "#89b4fa",
          count: 0,
        })),
      );
    } catch (error) {
      setScanError(String(error));
    } finally {
      setScanning(false);
    }
  };
  return (
    <section className="content settings-page">
      <div className="hero compact">
        <div>
          <p className="eyebrow">
            <Settings size={14} /> PREFERENCES
          </p>
          <h1>Settings</h1>
          <p className="sub">
            One control center for providers, CLIs, agents, themes, and
            workspace access.
          </p>
        </div>
      </div>
      <SettingsGroup
        number="01"
        title="Workspace"
        description="Your local repositories and project context."
      >
        <div className="settingscard">
          <h2>Repository workspace</h2>
          <p>
            {root ||
              "Choose one folder and Wand will scan its immediate Git repositories."}
          </p>
          <div className="folder">
            <FolderGit2 size={18} />
            <span>{repos.length} repositories in this local workspace</span>
            <button className="outline" onClick={scan} disabled={scanning}>
              {scanning ? "Scanning…" : "Choose folder & scan"}
            </button>
          </div>
          {scanError && <p className="provider-message" role="alert">{scanError}</p>}
        </div>
      </SettingsGroup>
      <SettingsGroup
        number="02"
        title="Appearance"
        description="The way Wand looks in your workspace."
      >
        <ThemeSection />
      </SettingsGroup>
      <SettingsGroup
        number="03"
        title="Connections"
        description="Services and local tools that Wand can use."
      >
        <ProviderAccess />
        <CliManager />
      </SettingsGroup>
      <SettingsGroup
        number="04"
        title="Agent team"
        description="The specialists available in this workspace."
      >
        <AgentManager repos={repos} />
      </SettingsGroup>
      <SettingsGroup
        number="05"
        title="Notifications"
        description="Choose which work deserves your attention."
      >
        <NotificationPreferencesSection />
      </SettingsGroup>
      <SettingsGroup
        number="06"
        title="About Wand"
        description="Release notes and product updates."
      >
        <WhatsNewSection />
      </SettingsGroup>
    </section>
  );
}
function SettingsGroup({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const id = `settings-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section className="settings-group" aria-labelledby={id}>
      <div className="settings-group-heading">
        <span>{number}</span>
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
type DetectedCli = {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  version?: string;
};

const onboardingProviders = [
  { id: "github", name: "GitHub", description: "Pull requests, repositories, and activity" },
  { id: "azure-devops", name: "Azure DevOps", description: "Repos and pull-request reporting" },
  { id: "linear", name: "Linear", description: "Issues and project signals" },
] as const;

const cliInstallGuides: Record<string, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/overview",
  codex: "https://developers.openai.com/codex/cli/",
  gemini: "https://github.com/google-gemini/gemini-cli",
  kimi: "https://www.kimi.com/code",
};

const localCliFallback: DetectedCli[] = [
  { id: "claude", name: "Claude", command: "claude", installed: false },
  { id: "codex", name: "Codex", command: "codex", installed: false },
  { id: "kimi", name: "Kimi", command: "kimi", installed: false },
  { id: "gemini", name: "Gemini CLI", command: "gemini", installed: false },
];

function Onboarding({ done }: { done: (name: string) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveInFlight = useRef(false);
  const finish = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await done(name);
    } catch (cause) {
      setSaveError(`Could not save your name: ${String(cause)}. Please try again.`);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [providerMessage, setProviderMessage] = useState("");
  const [clis, setClis] = useState<DetectedCli[]>([]);
  const [enabledClis, setEnabledClis] = useState<string[]>([]);
  const [checkingClis, setCheckingClis] = useState(false);
  const [cliMessage, setCliMessage] = useState("");
  const slides = [
    ["Welcome to Wand", "Your local-first AI engineering workspace. Plan, build, review, and verify without losing the thread."],
    ["Connect your tools", "Choose where Wand can read repository and project activity. Credentials are protected by your operating system's credential store."],
    ["Prepare your local tools", "Wand found the coding CLIs available on this machine. Enable only the runtimes you want your agents to use."],
    ["You're ready", "Your workspace remains local, every handoff is visible, and you can change providers or tools anytime in Settings."],
  ];
  const current = slides[step];

  const refreshProviders = async () => {
    const rows = await Promise.all(
      onboardingProviders.map(async ({ id }) => [
        id,
        await invoke<boolean>("provider_status", { provider: id }).catch(() => false),
      ] as const),
    );
    setProviders(Object.fromEntries(rows));
  };

  const refreshClis = async () => {
    setCheckingClis(true);
    setCliMessage("");
    try {
      const [detected, access] = await Promise.all([
        invoke<DetectedCli[]>("detect_clis"),
        invoke<string[]>("cli_access"),
      ]);
      setClis(detected);
      setEnabledClis(access);
    } catch (cause) {
      setClis(localCliFallback);
      setCliMessage(isTauriRuntime() ? `Could not check local tools: ${String(cause)}` : "Open Wand Desktop to scan and enable local tools.");
    } finally {
      setCheckingClis(false);
    }
  };

  useEffect(() => {
    void refreshProviders();
    void refreshClis();
  }, []);

  const connectProvider = async (provider: string) => {
    const providerName = onboardingProviders.find((item) => item.id === provider)?.name || provider;
    const values = await askModal(
      `Connect ${providerName}`,
      [{ id: "token", label: "Personal access token", placeholder: "Paste your token", secret: true }],
      "Wand saves this token in your operating system's credential store.",
    );
    if (!values?.token) return;
    try {
      await invoke("save_provider_token", { provider, token: values.token });
      await refreshProviders();
      setProviderMessage(`${providerName} is connected securely.`);
    } catch (cause) {
      setProviderMessage(`Could not connect ${providerName}: ${String(cause)}`);
    }
  };

  const toggleCli = async (id: string) => {
    const previous = enabledClis;
    const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
    setEnabledClis(next);
    try {
      await invoke("save_cli_access", { clis: next });
    } catch (cause) {
      setEnabledClis(previous);
      setCliMessage(`Could not save local tool access: ${String(cause)}`);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboard-card">
        <div className="onboard-mark"><WandBrand /></div>
        <p className="eyebrow">WAND / GETTING STARTED</p>
        <h1>{current[0]}</h1>
        <p>{current[1]}</p>
        {step === 0 && (
          <label className="onboard-field">
            <span>What should Wand call you?</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) setStep(1);
              }}
            />
          </label>
        )}
        {step === 1 && (
          <div className="onboard-setup" aria-label="Report providers">
            {onboardingProviders.map((provider) => (
              <div className="onboard-setup-row" key={provider.id}>
                <span className={providers[provider.id] ? "onboard-state connected" : "onboard-state"} aria-hidden="true" />
                <div>
                  <strong>{provider.name}</strong>
                  <small>{providers[provider.id] ? "Connected securely" : provider.description}</small>
                </div>
                <button
                  className={providers[provider.id] ? "outline enabled" : "outline"}
                  onClick={() => void connectProvider(provider.id)}
                >
                  {providers[provider.id] ? "Connected" : "Connect"}
                </button>
              </div>
            ))}
            <p className="onboard-hint">You can skip this for now and connect or replace providers later in Settings.</p>
            {providerMessage && <p className="onboard-message">{providerMessage}</p>}
          </div>
        )}
        {step === 2 && (
          <div className="onboard-setup" aria-label="Local coding tools">
            <div className="onboard-setup-heading">
              <span>{checkingClis ? "Scanning local tools…" : "Local coding tools"}</span>
              <button className="textbtn" onClick={() => void refreshClis()} disabled={checkingClis}>
                <RotateCcw size={12} className={checkingClis ? "spin" : ""} /> Refresh
              </button>
            </div>
            {clis.map((cli) => (
              <div className="onboard-setup-row" key={cli.id}>
                <span className={cli.installed ? "onboard-state connected" : "onboard-state"} aria-hidden="true" />
                <div>
                  <strong>{cli.name}</strong>
                  <small>{cli.installed ? cli.version || "Installed on this machine" : `Command: ${cli.command}`}</small>
                </div>
                {cli.installed ? (
                  <button className={enabledClis.includes(cli.id) ? "outline enabled" : "outline"} onClick={() => void toggleCli(cli.id)}>
                    {enabledClis.includes(cli.id) ? "Enabled" : "Enable"}
                  </button>
                ) : (
                  <a className="outline onboard-install" href={cliInstallGuides[cli.id]} target="_blank" rel="noreferrer">Install ↗</a>
                )}
              </div>
            ))}
            <p className="onboard-hint">Installation always opens the provider's official guide; Wand never runs installers without your explicit action.</p>
            {cliMessage && <p className="onboard-message">{cliMessage}</p>}
          </div>
        )}
        <div className="onboard-dots">
          {slides.map((_, i) => (
            <i className={i === step ? "on" : ""} key={i} />
          ))}
        </div>
        <div className="onboard-actions">
          {step > 0 ? (
            <button className="textbtn" disabled={saving} onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            className="primary"
            disabled={saving || !name.trim()}
            onClick={() =>
              step < slides.length - 1 ? setStep(step + 1) : void finish()
            }
          >
            {saving ? "Saving…" : step < slides.length - 1 ? "Continue" : "Enter Wand"}
          </button>
        </div>
        {saveError && <p className="onboard-message" role="alert">{saveError}</p>}
      </div>
    </div>
  );
}
function CliManager() {
  const [clis, setClis] = useState<any[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [detected, access] = await Promise.all([
        invoke<any[]>("detect_clis"),
        invoke<string[]>("cli_access"),
      ]);
      setClis(detected);
      setEnabled(access);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (!isTauriRuntime()) {
        setClis([
          { id: "claude", name: "Claude", command: "claude", installed: false },
          { id: "codex", name: "Codex", command: "codex", installed: false },
          { id: "kimi", name: "Kimi", command: "kimi", installed: false },
          { id: "gemini", name: "Gemini CLI", command: "gemini", installed: false },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const toggle = async (id: string) => {
    const next = enabled.includes(id)
      ? enabled.filter((x) => x !== id)
      : [...enabled, id];
    setEnabled(next);
    try {
      await invoke("save_cli_access", { clis: next });
    } catch (cause) {
      setEnabled(enabled);
      setError(
        `Could not save CLI access: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  return (
    <div className="cli-manager">
      <div className="sectionhead">
        <div>
          <h2>Local CLI access</h2>
          <p>Choose which coding runtimes Wand may use.</p>
        </div>
        <button className="outline" onClick={() => void refresh()} disabled={loading}>
          <RotateCcw size={13} className={loading ? "spin" : ""} />
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      {error && (
        <div className="settings-inline-error" role="alert">
          Could not read local CLI access. {error} Try Refresh after Wand finishes starting.
        </div>
      )}
      {!loading && !error && clis.length === 0 && (
        <div className="settings-inline-empty">
          No supported CLI runtimes were detected on this machine.
        </div>
      )}
      {clis.map((c) => (
        <div className="cli-row" key={c.id}>
          <div className={"cli-state " + (c.installed ? "ready" : "missing")} />
          <div>
            <b>{c.name}</b>
            <small>
              {c.installed
                ? c.version || "Installed and detected"
                : `Install “${c.command}” to enable`}
            </small>
          </div>
          <button
            className={"outline " + (enabled.includes(c.id) ? "enabled" : "")}
            disabled={!c.installed}
            onClick={() => void toggle(c.id)}
          >
            {enabled.includes(c.id) ? "Enabled" : "Enable"}
          </button>
        </div>
      ))}
    </div>
  );
}
function ProviderAccess() {
  const providerLabel = (provider: string) => provider === "github" ? "GitHub" : provider === "azure-devops" ? "Azure DevOps" : "Linear";
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState("");
  const [testing, setTesting] = useState("");
  const [message, setMessage] = useState("");
  const refresh = () =>
    Promise.all(
      ["github", "azure-devops", "linear"].map(
        async (p) =>
          [
            p,
            await invoke<boolean>("provider_status", { provider: p }).catch(
              () => false,
            ),
          ] as const,
      ),
    ).then((x) => setStatus(Object.fromEntries(x)));
  useEffect(() => {
    refresh();
  }, []);
  const connect = async (provider: string) => {
    const values = await askModal(
      `Connect ${providerLabel(provider)}`,
      [
        {
          id: "token",
          label: "Personal access token",
          placeholder: "Paste your PAT",
          secret: true,
        },
      ],
      "The token is saved in your operating system's credential store.",
    );
    if (!values?.token) return;
    try {
      await invoke("save_provider_token", { provider, token: values.token });
      await refresh();
      setMessage(`${providerLabel(provider)} connected securely.`);
    } catch (cause) {
      setMessage(
        `Could not save ${providerLabel(provider)} credentials: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  const disconnect = async (provider: string) => {
    const confirmed = await askModal(
      `Disconnect ${provider === "github" ? "GitHub" : "Azure DevOps"}`,
      [],
      "This removes Wand's saved credential and Azure organization settings from this installation.",
    );
    if (!confirmed) return;
    try {
      await invoke("disconnect_provider", { provider });
      setMessage(`${providerLabel(provider)} disconnected and its agent was removed.`);
      await refresh();
    } catch (error) {
      setMessage(String(error));
    }
  };
  const sync = async (provider: string) => {
    try {
      setSyncing(provider);
      setMessage("");
      let providerUrl = "";
      if (provider === "azure-devops") {
        const values = await askModal(
          "Azure DevOps organization",
          [
            {
              id: "url",
              label: "Organization URL",
              placeholder: "https://dev.azure.com/your-org",
            },
          ],
          "Wand uses this organization to find repositories and pull-request activity.",
        );
        providerUrl = values?.url || "";
        if (!providerUrl) return;
        await invoke("save_provider_url", { provider, url: providerUrl });
      }
      const args = provider === "azure-devops" ? { providerUrl } : {};
      const rows = await invoke<any[]>(
        provider === "github" ? "sync_github" : provider === "linear" ? "sync_linear" : "sync_azure_devops",
        args,
      );
      setMessage(
        `${rows.length} ${providerLabel(provider)} ${provider === "linear" ? "teams" : "repositories"} synced. ${providerLabel(provider)} is now available as a taggable agent.`,
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSyncing("");
    }
  };
  const test = async (provider: string) => {
    try {
      setTesting(provider);
      setMessage("");
      let providerUrl: string | undefined;
      if (provider === "azure-devops") {
        providerUrl =
          (await invoke<string | null>("provider_url", { provider })) ||
          undefined;
        if (!providerUrl) {
          const values = await askModal("Azure DevOps organization", [
            {
              id: "url",
              label: "Organization URL",
              placeholder: "https://dev.azure.com/your-org",
            },
          ]);
          providerUrl = values?.url || undefined;
          if (!providerUrl) return;
          await invoke("save_provider_url", { provider, url: providerUrl });
        }
      }
      const result = await invoke<string>("test_provider_connection", {
        provider,
        providerUrl,
      });
      setMessage(`${providerLabel(provider)}: ${result}.`);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setTesting("");
    }
  };
  return (
    <div className="provider-access">
      <div className="sectionhead">
        <div>
          <h2>Provider credentials</h2>
          <p>Tokens never enter the React layer after submission.</p>
        </div>
      </div>
      {[
        ["github", "GitHub"],
        ["azure-devops", "Azure DevOps"],
        ["linear", "Linear"],
      ].map(([id, name]) => (
        <div className="provider-row" key={id}>
          <div>
            <b>{name}</b>
            <small>
              {status[id]
                ? "Connected through the system credential store"
                : "Not connected"}
            </small>
          </div>
          <button className="outline" onClick={() => connect(id)}>
            {status[id] ? "Replace PAT" : "Connect"}
          </button>
          {status[id] && (
            <button className="textbtn danger" onClick={() => disconnect(id)}>
              Disconnect
            </button>
          )}
          <button
            className="outline"
            disabled={!status[id] || !!syncing || !!testing}
            onClick={() => test(id)}
          >
            {testing === id ? "Testing…" : "Test connection"}
          </button>
          <button
            className="outline"
            disabled={!status[id] || !!syncing}
            onClick={() => sync(id)}
          >
            {syncing === id ? "Syncing…" : "Sync repos"}
          </button>
        </div>
      ))}
      {message && <p className="provider-message">{message}</p>}
    </div>
  );
}
function AgentManager({ repos }: { repos: Repo[] }) {
  type StoredAgent = {
    id: string;
    name: string;
    role: string;
    skills: string[];
    color: string;
    cli: string;
    model: string;
    scope: string;
    built_in: boolean;
  };
  const [items, setItems] = useState<StoredAgent[]>([]);
  const [enabledClis, setEnabledClis] = useState<string[]>([]);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const load = () =>
    invoke<any[]>("list_agents")
      .then((rows) =>
        setItems(
          rows.map((r) => ({ ...r, skills: parseJson<string[]>(r.skills, []) })),
        ),
      )
      .catch(() => {});
  useEffect(() => {
    load();
    invoke<string[]>("cli_access").then(setEnabledClis).catch(() => {});
  }, []);
  const importWorkflow = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: "Import a Wand agent workflow",
      filters: [{ name: "Wand workflow", extensions: ["json"] }],
    });
    if (typeof selected !== "string") return;
    try {
      const result = await invoke<{ name: string; agents_imported: number; steps: string[] }>(
        "import_agent_workflow",
        { path: selected },
      );
      setWorkflowMessage(
        `Imported ${result.name}: ${result.agents_imported} agent${result.agents_imported === 1 ? "" : "s"}${result.steps.length ? ` · ${result.steps.length}-step workflow` : ""}.`,
      );
      load();
    } catch (error) {
      setWorkflowMessage(String(error));
    }
  };
  const edit = async (agent?: StoredAgent) => {
    const cliOptions = enabledClis;
    if (!cliOptions.length) {
      setWorkflowMessage("Enable an installed runtime in CLI Access before configuring an agent.");
      return;
    }
    const selectedCli = cliOptions.includes(agent?.cli || "")
      ? agent?.cli || cliOptions[0]
      : cliOptions[0];
    const values = await askModal(
      agent ? "Edit agent" : "Create an agent",
      [
        {
          id: "name",
          label: "Agent name",
          placeholder: "Release engineer",
          value: agent?.name,
        },
        {
          id: "role",
          label: "Responsibility",
          placeholder: "Describe exactly what this agent owns…",
          value: agent?.role,
          multiline: true,
          maxLength: 1000,
        },
        {
          id: "skills",
          label: "Skills",
          placeholder: "release, changelog, testing",
          value: agent?.skills.join(", "),
        },
        {
          id: "cli",
          label: "CLI runtime",
          value: selectedCli,
          options: cliOptions,
        },
        {
          id: "model",
          label: "Model",
          value: agent?.model || "default",
          placeholder: "default, or a model ID supported by your CLI and account",
        },
        {
          id: "scope",
          label: "Scope",
          value: agent?.scope || "workspace",
          options: ["workspace", ...repos.map((repo) => `repo:${repo.name}`)],
        },
      ],
      "Give each agent one clear responsibility. Use default for your CLI's configured model, or enter a model ID your runtime and account support.",
    );
    if (!values?.name) return;
    try {
      await invoke("save_agent", {
        agent: {
          id: agent?.id || values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: values.name.trim(),
          role: (values.role || "").slice(0, 1000),
          skills: (values.skills || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          color: agent?.color || "#a98cff",
          cli: values.cli || "codex",
          model: values.model || "default",
          scope: values.scope || "workspace",
        },
      });
      setWorkflowMessage(`${values.name.trim()} was ${agent ? "updated" : "added"}.`);
      load();
    } catch (error) {
      setWorkflowMessage(String(error));
    }
  };
  const remove = async (agent: StoredAgent) => {
    const confirmed = await askModal(
      `Delete ${agent.name}?`,
      [],
      "This removes the agent from your team. You can create a replacement at any time.",
    );
    if (!confirmed) return;
    try {
      await invoke("delete_agent", { id: agent.id });
      setWorkflowMessage(`${agent.name} was removed from your agent team.`);
      load();
    } catch (error) {
      setWorkflowMessage(String(error));
    }
  };
  return (
    <div className="agent-management">
      <div className="sectionhead">
        <div>
          <h2>Agent team</h2>
          <p>
            Persistent specialists with one responsibility, a CLI runtime,
            model, skills, and repository scope.
          </p>
        </div>
        <button className="outline" onClick={() => edit()}>
          <Plus size={14} /> Add agent
        </button>
        <button className="outline" onClick={importWorkflow}>
          Import workflow
        </button>
      </div>
      {workflowMessage && <p className="provider-message">{workflowMessage}</p>}
      <div className="agent-config-grid">
        {items.map((agent) => (
          <div className="agent-config" key={agent.id}>
            <div className="agent-config-top">
              <b>{agent.name}</b>
              <span className="tag blue">
                {agent.built_in ? "Built-in" : "Custom"}
              </span>
            </div>
            <p>{agent.role}</p>
            <small>{agent.skills.join(" · ")}</small>
            <footer>
              <code>{agent.cli}</code>
              <code>{agent.model}</code>
              <code>{agent.scope}</code>
              <button className="textbtn" onClick={() => edit(agent)}>
                Edit
              </button>
              <button className="textbtn danger" onClick={() => remove(agent)}>
                Delete
              </button>
            </footer>
          </div>
        ))}
      </div>
    </div>
  );
}
function AgentMentionInput({
  repo,
  value,
  onChange,
  agents,
  tagged,
  onTagged,
  placeholder,
  disabled = false,
}: {
  repo: string;
  value: string;
  onChange: (value: string) => void;
  agents: Agent[];
  tagged: string[];
  onTagged: (ids: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const menuId = React.useId();
  const context = activeMentionAt(value, caret);
  const query = context?.query || "";
  const [highlighted, setHighlighted] = useState(0);
  const available = agents.filter(
    (agent) =>
      !agent.scope ||
      agent.scope === "workspace" ||
      agent.scope === `repo:${repo}`,
  );
  const choose = (agent: Agent) => {
    if (disabled) return;
    const next = insertAgentMention(value, caret, agent.name);
    if (!next) return;
    pendingCaret.current = next.caret;
    onChange(next.text);
    onTagged(tagged.includes(agent.id) ? tagged : [...tagged, agent.id]);
    setOpen(false);
    setCaret(next.caret);
    setHighlighted(0);
  };
  useEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);
  const locateMention = (next: string, position: number) => {
    setCaret(position);
    const range = activeMentionAt(next, position);
    const alreadySelected = range && available.some(agent => tagged.includes(agent.id) &&
      (range.query === agent.name || range.query.startsWith(agent.name + ' ')));
    setOpen(Boolean(range && !alreadySelected));
    setHighlighted(0);
  };
  const update = (next: string, position: number) => {
    onChange(next);
    onTagged(tagged.filter((id) => {
      const agent = available.find((candidate) => candidate.id === id);
      return agent ? hasAgentMention(next, agent.name) : false;
    }));
    locateMention(next, position);
  };
  const matches = available
    .filter((agent) =>
      agent.name
        .toLowerCase()
        .replace(/\s+/g, "")
        .includes(query.toLowerCase().replace(/\s+/g, "")),
    )
    .slice(0, 8);
  return (
    <div className="mention-composer">
      <textarea
        ref={input}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={open && !disabled ? menuId : undefined}
        aria-activedescendant={open && !disabled && matches.length ? `${menuId}-${highlighted % matches.length}` : undefined}
        aria-label={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => update(event.target.value, event.target.selectionStart)}
        onSelect={(event) => locateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          } else if (open && event.key === "ArrowDown" && matches.length) {
            event.preventDefault();
            setHighlighted((index) => (index + 1) % matches.length);
          } else if (open && event.key === "ArrowUp" && matches.length) {
            event.preventDefault();
            setHighlighted((index) => (index - 1 + matches.length) % matches.length);
          } else if (open && event.key === "Enter" && matches.length) {
            event.preventDefault();
            choose(matches[highlighted % matches.length]);
          }
        }}
      />
      {open && !disabled && (
        <div className="mention-menu" id={menuId} role="listbox" aria-label="Agents to tag">
          {matches.map((agent, index) => (
              <button
                type="button"
                key={agent.id}
                id={`${menuId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className={index === highlighted ? "highlighted" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => choose(agent)}
              >
                <span
                  className="mention-avatar"
                  style={{ background: agent.color }}
                >
                  {agent.name[0]}
                </span>
                <span>
                  <b>@{agent.name}</b>
                  <small>{agent.role}</small>
                </span>
              </button>
            ))}
          {matches.length === 0 && <span className="mention-empty">No matching agents</span>}
        </div>
      )}
      {tagged.length > 0 && (
        <div className="mention-tags">
          {tagged.map((id) => (
            <span className="tag purple" key={id}>
              @{agents.find((agent) => agent.id === id)?.name || id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationPreferencesSection() {
  type Prefs = {
    provider: boolean;
    agent: boolean;
    task: boolean;
    thread: boolean;
  };
  const defaults: Prefs = {
    provider: true,
    agent: true,
    task: true,
    thread: true,
  };
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [saved, setSaved] = useState(false);
  const [desktopAllowed, setDesktopAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    invoke<string | null>("workspace_setting", { key: "notification-prefs" })
      .then((value) => {
        if (!value) return;
        try {
          setPrefs({ ...defaults, ...JSON.parse(value) });
        } catch {
          // Keep the safe defaults when a legacy value is malformed.
        }
      })
      .catch(() => {});
    isPermissionGranted().then(setDesktopAllowed).catch(() => setDesktopAllowed(false));
  }, []);
  const toggle = async (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    if (next[key] && desktopAllowed !== true) {
      setDesktopAllowed(await ensureDesktopNotificationPermission());
    }
    setPrefs(next);
    void invoke("save_workspace_setting", {
      key: "notification-prefs",
      value: JSON.stringify(next),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  return (
    <div className="settings-section notification-preferences-section">
      <div className="settings-section-head">
        <div>
          <p className="eyebrow">
            <Bell size={14} /> NOTIFICATIONS
          </p>
          <h2>Notification Preferences</h2>
          <p>
            Choose which categories trigger in-app toasts and native OS desktop
            notifications.
          </p>
        </div>
        {saved ? <span className="tag green">Saved</span> : desktopAllowed === false ? <span className="tag yellow">Desktop alerts off</span> : null}
      </div>
      <div className="notification-preferences-list">
        {[
          [
            "provider",
            "Provider updates",
            "Pull request comments, activity sync, and repository events",
          ],
          [
            "agent",
            "Agent handoffs & verification",
            "Multi-agent chain transitions and background verifier results",
          ],
          [
            "task",
            "Scheduled task runs",
            "Cron triggers and automated scheduler execution updates",
          ],
          [
            "thread",
            "Repository threads",
            "Direct human and agent messages in local repo threads",
          ],
        ].map(([key, label, hint]) => (
          <label className="notification-setting" key={key}>
            <span>
              <b>{label}</b>
              <small>{hint}</small>
            </span>
            <input
              type="checkbox"
              checked={prefs[key as keyof Prefs]}
              onChange={() => void toggle(key as keyof Prefs)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function WhatsNewSection() {
  const releases = [
    {
      version: "v0.1.0",
      date: "August 2026",
      badge: "Latest",
      highlights: [
        {
          title: "Typographic Brand Identity & Magic Sparkles",
          desc: "Sparkle W wordmark with a metallic theme gradient and subtle magic accents.",
          icon: Sparkles,
        },
        {
          title: "Settings & Preferences Control Center",
          desc: "A single routed Settings page for themes, workspace folders, providers, CLI access, agents, notifications, and release notes.",
          icon: Settings,
        },
        {
          title: "Monaco Code & Git Diff Workspace",
          desc: "Integrated code editor and side-by-side Git diff viewer built right into your main workflow.",
          icon: Code2,
        },
      ],
    },
    {
      version: "v0.0.9",
      date: "July 2026",
      highlights: [
        {
          title: "Multi-Agent Execution Chains",
          desc: "Tag Planner, Builder, Reviewer, and Sentinel agents to hand off work automatically across local CLI runtimes.",
          icon: Bot,
        },
        {
          title: "Local-First Privacy",
          desc: "Repository locations stay local. Provider tokens are protected by your system credential store.",
          icon: Zap,
        },
      ],
    },
  ];

  return (
    <div className="settings-section whats-new-section">
      <div className="settings-section-head">
        <div>
          <p className="eyebrow">
            <Sparkles size={13} /> RELEASE TIMELINE
          </p>
          <h2>What’s New in Wand</h2>
          <p>Chronological updates, enhancements, and feature highlights.</p>
        </div>
      </div>
      <div className="whats-new-timeline">
        {releases.map((rel, i) => (
          <div className="timeline-release" key={rel.version}>
            <div className="timeline-node">
              <span className="node-dot" />
              {i < releases.length - 1 && <span className="node-line" />}
            </div>
            <div className="timeline-content">
              <div className="release-header">
                <h3>{rel.version}</h3>
                <span className="release-date">{rel.date}</span>
                {rel.badge && <span className="tag green">{rel.badge}</span>}
              </div>
              <div className="release-highlights">
                {rel.highlights.map((h, j) => {
                  const Icon = h.icon;
                  return (
                    <div className="timeline-card" key={j}>
                      <div className="timeline-icon">
                        <Icon size={15} />
                      </div>
                      <div>
                        <h4>{h.title}</h4>
                        <p>{h.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemeSection() {
  const [theme, setTheme] = useState(() => normalizeTheme(document.body.dataset.theme));
  const [font, setFont] = useState<FontName>(() => normalizeFont(document.body.dataset.font));
  const [loading, setLoading] = useState(isTauriRuntime());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState("");
  const saveLock = useRef(false);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    Promise.all([
      invoke<string | null>("workspace_setting", { key: "theme" }),
      invoke<string | null>("workspace_setting", { key: "font" }),
    ]).then(([savedTheme, savedFont]) => {
      if (cancelled) return;
      const nextTheme = normalizeTheme(savedTheme), nextFont = normalizeFont(savedFont);
      setTheme(nextTheme); setFont(nextFont);
      document.body.dataset.theme = nextTheme;
      document.body.dataset.font = nextFont;
    }).catch(error => {
      if (!cancelled) setSaveError(`Could not read saved appearance: ${String(error)}`);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const isLight = theme === "daylight";
  const save = async (setting: AppearanceSetting) => {
    if (loading) return;
    await submitOnce(saveLock, async () => {
      setSaving(true); setSaveError(""); setStatus("");
      try {
        await persistAppearance(setting, isTauriRuntime(), value => invoke("save_workspace_setting", value), () => localStorage);
        if (setting.key === "theme") { setTheme(setting.value); document.body.dataset.theme = setting.value; }
        else { setFont(setting.value); document.body.dataset.font = setting.value; }
        setStatus("Appearance saved.");
      } catch (error) {
        setSaveError(`Appearance was not saved. Your previous choice is unchanged. Select the option again to retry. ${String(error)}`);
      } finally { setSaving(false); }
    });
  };
  const setMode = (mode: "dark" | "light") => {
    void save({ key: "theme", value: mode === "light" ? "daylight" : "obsidian" });
  };
  const chooseFont = (name: FontName) => {
    void save({ key: "font", value: name });
  };
  return (
    <div className="settings-section appearance-section" aria-busy={loading || saving}>
      <div className="settings-section-head">
        <div>
          <h2>Appearance</h2>
          <p>Choose between Wand’s focused dark and light appearances.</p>
        </div>
      </div>
      {(loading || saving || status) && <p role="status">{loading ? "Loading saved appearance…" : saving ? "Saving appearance…" : status}</p>}
      {saveError && <p className="thread-error" role="alert">{saveError}</p>}
      <div className="mode-toggle-group">
        <button
          className={"mode-btn " + (!isLight ? "active" : "")}
          onClick={() => setMode("dark")}
          disabled={loading || saving}
          aria-pressed={!isLight}
        >
          <Moon size={16} />
          <span>Dark Mode</span>
        </button>
        <button
          className={"mode-btn " + (isLight ? "active" : "")}
          onClick={() => setMode("light")}
          disabled={loading || saving}
          aria-pressed={isLight}
        >
          <Sun size={16} />
          <span>Light Mode</span>
        </button>
      </div>
      <div className="font-picker">
        <div className="font-picker-head">
          <div>
            <h3>Typography</h3>
            <p>Try a typeface across the whole workspace.</p>
          </div>
          <span className="font-picker-current">{fontOptions.find((option) => option.id === font)?.name}</span>
        </div>
        <div className="font-option-grid" role="group" aria-label="Interface font">
          {fontOptions.map((option) => (
            <button
              key={option.id}
              className={"font-option font-option-" + option.id + (font === option.id ? " active" : "")}
              onClick={() => chooseFont(option.id)}
              disabled={loading || saving}
              aria-pressed={font === option.id}
            >
              <strong>{option.name}</strong>
              <span>{option.description}</span>
              <em aria-hidden="true">Ag</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  onClose,
  repos,
  setRepos,
  initialTab,
}: {
  onClose: () => void;
  repos: Repo[];
  setRepos: React.Dispatch<React.SetStateAction<Repo[]>>;
  initialTab?: string;
}) {
  const [tab, setTab] = useState<
    | "appearance"
    | "workspace"
    | "providers"
    | "clis"
    | "agents"
    | "notifications"
    | "whats-new"
  >((initialTab as any) || "appearance");
  const [root, setRoot] = useState("");

  useEffect(() => {
    invoke<string | null>("workspace_root")
      .then((value) => {
        if (value) setRoot(value);
      })
      .catch(() => {});
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const scan = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose your repositories folder",
    });
    if (typeof selected !== "string") return;
    const rows = await invoke<any[]>("scan_repositories", {
      rootPath: selected,
    }).catch(() => []);
    await invoke("save_workspace_root", { root: selected }).catch(() => {});
    setRoot(selected);
    if (rows.length)
      setRepos(
        rows.map((r) => ({
          name: r.name,
          path: r.path,
          color: "#89b4fa",
          count: 0,
        })),
      );
  };

  const tabs = [
    { id: "appearance", label: "Appearance", icon: Sun },
    { id: "workspace", label: "Workspace", icon: FolderGit2 },
    { id: "providers", label: "Providers", icon: Zap },
    { id: "clis", label: "CLI Access", icon: TerminalSquare },
    { id: "agents", label: "Agent Team", icon: Bot },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "whats-new", label: "What’s New", icon: Sparkles },
  ] as const;

  return (
    <div
      className="settings-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Wand Settings"
      >
        <header className="settings-modal-header">
          <div>
            <p className="eyebrow">
              <Settings size={13} /> WAND PREFERENCES
            </p>
            <h2>Settings</h2>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>
        <div className="settings-modal-body">
          <nav className="settings-modal-nav">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <React.Fragment key={t.id}>
                  {t.id === "whats-new" && (
                    <hr className="settings-nav-divider" />
                  )}
                  <button
                    className={
                      "settings-nav-item " +
                      (tab === t.id ? "active" : "") +
                      " " +
                      (t.id === "whats-new" ? "whats-new-nav" : "")
                    }
                    onClick={() => setTab(t.id)}
                  >
                    <Icon size={16} />
                    <span>{t.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
          <main className="settings-modal-content">
            {tab === "appearance" && <ThemeSection />}
            {tab === "workspace" && (
              <div className="settingscard modal-card">
                <div className="sectionhead">
                  <div>
                    <h2>Repository workspace</h2>
                    <p>Local folder scanned for Git repositories.</p>
                  </div>
                </div>
                <p>
                  {root ||
                    "Choose one folder and Wand will scan its immediate Git repositories."}
                </p>
                <div className="folder">
                  <FolderGit2 size={18} />
                  <span>
                    {repos.length} repositories in this local workspace
                  </span>
                  <button className="outline" onClick={scan}>
                    Choose folder & scan
                  </button>
                </div>
              </div>
            )}
            {tab === "providers" && <ProviderAccess />}
            {tab === "clis" && <CliManager />}
            {tab === "agents" && <AgentManager repos={repos} />}
            {tab === "notifications" && <NotificationPreferencesSection />}
            {tab === "whats-new" && <WhatsNewSection />}
          </main>
        </div>
      </section>
    </div>
  );
}

function AccountMenu({
  onSettings,
}: {
  onSettings: () => void;
}) {
  return (
    <div className="account-menu">
      <button
        className="account-trigger"
        aria-label="Open settings"
        title="Settings"
        onClick={onSettings}
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
function ModalHost() {
  const [request, setRequest] = useState<ModalRequest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<ModalRequest>).detail;
      setValues(
        Object.fromEntries(
          next.fields.map((field) => [
            field.id,
            field.value ?? (field.check ? "false" : ""),
          ]),
        ),
      );
      setRequest(next);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && request) {
        request.resolve(null);
        setRequest(null);
      }
    };
    window.addEventListener("wand:modal", open);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("wand:modal", open);
      document.removeEventListener("keydown", key);
    };
  }, [request]);
  if (!request) return null;
  const finish = () => {
    request.resolve(values);
    setRequest(null);
  };
  return (
    <div
      className="wand-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          request.resolve(null);
          setRequest(null);
        }
      }}
    >
      <section
        className="wand-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wand-modal-title"
      >
        <div className="wand-modal-top">
          <div>
            <p className="eyebrow">WAND / WORKFLOW</p>
            <h2 id="wand-modal-title">{request.title}</h2>
            {request.description && <p>{request.description}</p>}
          </div>
          <button
            className="modal-close"
            onClick={() => {
              request.resolve(null);
              setRequest(null);
            }}
          >
            ×
          </button>
        </div>
        <div className="wand-modal-fields">
          {request.fields.map((field) =>
            field.check ? (
              <label className="modal-check" key={field.id}>
                <input
                  type="checkbox"
                  checked={values[field.id] === "true"}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field.id]: event.target.checked ? "true" : "false",
                    }))
                  }
                />
                <span>{field.label}</span>
              </label>
            ) : (
              <label className="modal-field" key={field.id}>
                <span>{field.label}</span>
                {(field.options || field.optionsFor) ? (
                  <select
                    autoFocus={request.fields[0].id === field.id}
                    value={values[field.id] || (field.optionsFor?.(values) || field.options || [""])[0]}
                    onChange={(event) =>
                      setValues((current) => {
                        const next = { ...current, [field.id]: event.target.value };
                        if (field.id === "cli" && next.model) next.model = "default";
                        return next;
                      })
                    }
                  >
                    {(field.optionsFor?.(values) || field.options || []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.multiline ? (
                  <textarea
                    autoFocus={request.fields[0].id === field.id}
                    maxLength={field.maxLength}
                    value={values[field.id] || ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                  />
                ) : field.directory ? (
                  <div className="modal-path-picker">
                    <input
                      autoFocus={request.fields[0].id === field.id}
                      maxLength={field.maxLength}
                      type="text"
                      value={values[field.id] || ""}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      className="outline"
                      type="button"
                      onClick={async () => {
                        try {
                          const selected = await open({
                            directory: true,
                            multiple: false,
                            title: "Choose repository folder",
                          });
                          if (typeof selected === "string") {
                            setValues((current) => ({ ...current, [field.id]: selected }));
                          }
                        } catch {
                          // The browser preview intentionally has no native folder dialog.
                        }
                      }}
                    >
                      Browse…
                    </button>
                  </div>
                ) : (
                  <input
                    autoFocus={request.fields[0].id === field.id}
                    maxLength={field.maxLength}
                    type={field.secret ? "password" : "text"}
                    value={values[field.id] || ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ),
          )}
        </div>
        <div className="wand-modal-actions">
          <button
            className="textbtn"
            onClick={() => {
              request.resolve(null);
              setRequest(null);
            }}
          >
            Cancel
          </button>
          <button className="primary" onClick={finish}>
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
function BackgroundStatus() {
  const [status, setStatus] = useState("Starting background workers…");
  const [when, setWhen] = useState("");
  const [heartbeat, setHeartbeat] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!isTauriRuntime()) {
      setStatus("Background workers run in the installed desktop app");
      setWhen("Browser preview");
      return;
    }
    const refresh = () => {
      invoke<{ message: string; timestamp: string } | null>("background_status")
        .then((event) => {
          if (!event) return;
          setUnavailable(false);
          setStatus(event.message);
          setHeartbeat(new Date(event.timestamp).getTime());
          setWhen(
            new Date(event.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          );
        })
        .catch(() => {
          setUnavailable(true);
          setStatus("Background worker status is unavailable");
          setWhen("Retrying…");
        });
    };
    refresh();
    const timer = window.setInterval(() => {
      setClock(Date.now());
      refresh();
    }, 15_000);
    const stop = listen<{ message: string; timestamp: string }>(
      "wand://sync",
      (event) => {
        setStatus(event.payload.message);
        setHeartbeat(new Date(event.payload.timestamp).getTime());
        setWhen(
          new Date(event.payload.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      },
    );
    return () => {
      window.clearInterval(timer);
      stop.then((unsubscribe) => unsubscribe());
    };
  }, []);
  const stale = unavailable || (heartbeat > 0 && Date.now() - heartbeat > 90_000);
  const preview = !isTauriRuntime();
  return (
    <div className="background-status" title={stale ? "No background worker heartbeat in the last 90 seconds" : status}>
      <span className={"background-dot" + (stale ? " error" : preview ? " preview" : "")} />
      <span>{preview ? "Desktop workers" : stale ? "Background workers unavailable" : "Background workers"}</span>
      <small>{when ? (preview ? when : `Checked ${when}`) : "Starting…"}</small>
    </div>
  );
}
function ProviderHealth() {
  const [failures, setFailures] = useState<ProviderFailure[]>([]);
  useEffect(() => {
    const stop = listen<any>("wand://provider", (event) => {
      setFailures((current) => updateProviderHealth(current, event.payload));
    });
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, []);
  const failure = failures[0];
  if (!failure) return null;
  return (
    <button
      className="provider-health-error"
      onClick={() => setFailures((current) => current.filter((item) => item.provider !== failure.provider))}
      title="Dismiss provider health warning"
    >
      <span className="background-dot error" />
      <span>{failure.provider}: {failure.message}{failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}</span>
      <b>×</b>
    </button>
  );
}
function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const installing = useRef(false);
  const installedRef = useRef(false);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<DownloadState>({ bytes: 0, finished: false });
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let inFlight = false;
    const checkForUpdate = async () => {
      if (!active || inFlight || installing.current || installedRef.current) return;
      inFlight = true;
      setChecking(true);
      try {
        const value = await check({ timeout: 15000 });
        if (!active) return;
        setError("");
        setUpdate(value ?? null);
        setDismissed(false);
      } catch (reason) {
        if (active) setError(String(reason));
      } finally {
        inFlight = false;
        if (active) setChecking(false);
      }
    };
    void checkForUpdate();
    const timer = window.setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [retryToken]);
  if ((!update && !error) || dismissed) return null;
  const install = async () => {
    if (!update || installing.current) return;
    installing.current = true;
    try {
      setBusy(true);
      setError("");
      setProgress({ bytes: 0, finished: false });
      await installApprovedUpdate(installedRef.current,
        () => update.downloadAndInstall((event) => setProgress((current) => accumulateDownload(current, event)), { timeout: 120000 }),
        () => { installedRef.current = true; setInstalled(true); },
        relaunch);
    } catch (value) {
      setError(String(value));
    } finally {
      installing.current = false;
      setBusy(false);
    }
  };
  const retry = () => {
    setDismissed(false);
    setError("");
    setRetryToken((token) => token + 1);
  };
  return (
    <section className="update-banner" aria-label={update ? "Wand update available" : "Wand update status"}>
      <div className="update-banner-icon">
        <Sparkles size={15} />
      </div>
      <div className="update-banner-copy">
        <strong>{installed ? "Restart to finish updating" : busy ? (progress.finished ? "Installing update…" : "Downloading update…") : update ? "Update available" : "Update check unavailable"}</strong>
        <span>{update ? `Wand ${update.version}` : checking ? "Checking GitHub releases…" : "Try checking again"}</span>
        {busy && !installed && !progress.finished && <span role="status">{progress.total ? `${Math.min(100, Math.floor(progress.bytes / progress.total * 100))}% downloaded` : `${(progress.bytes / 1048576).toFixed(1)} MB downloaded`}</span>}
        {error && <small>{error}</small>}
      </div>
      <button onClick={update ? install : retry} disabled={busy || checking}>
        {busy ? (installed ? "Restarting…" : "Updating…") : installed ? "Restart" : update ? "Approve" : "Retry"}
      </button>
      {!busy && <button className="update-dismiss" aria-label="Dismiss update status" onClick={() => setDismissed(true)}>×</button>}
    </section>
  );
}
function RuntimeIdentity() {
  useEffect(() => {
    const apply = (name: string) => {
      const clean = name.trim() || "there";
      document
        .querySelectorAll<HTMLElement>(".account-heading strong")
        .forEach((node) => {
          node.textContent = clean;
        });
    };
    invoke<string | null>("user_name")
      .then((name) => apply(name || ""))
      .catch(() => {});
    const onName = (event: Event) =>
      apply((event as CustomEvent<string>).detail || "");
    window.addEventListener("wand:user-name", onName);
    return () => window.removeEventListener("wand:user-name", onName);
  }, []);
  return null;
}
function OnboardingGate() {
  const [show, setShow] = useState<boolean | null>(null);
  useEffect(() => {
    invoke<string | null>("user_name")
      .then((name) => setShow(!name?.trim()))
      .catch(() =>
        setShow(isTauriRuntime() || !previewOnboardingComplete(() => localStorage)),
      );
  }, []);
  const finish = async (name: string) => {
    const saved = await persistOnboardingName(name, isTauriRuntime(),
      (value) => invoke("save_user_name", { name: value }), () => localStorage);
    window.dispatchEvent(new CustomEvent("wand:user-name", { detail: saved }));
    setShow(false);
  };
  return (
    <>
      <App />
      <BackgroundStatus />
      <ProviderHealth />
      <UpdateBanner />
      <RuntimeIdentity />
      <PlatformBootstrap />
      <ThemeBootstrap />
      <FontBootstrap />
      <ModalHost />
      {show === true && <Onboarding done={finish} />}
    </>
  );
}
function PlatformBootstrap() {
  useEffect(() => {
    document.body.dataset.platform = runtimePlatform();
  }, []);
  return null;
}
createRoot(document.getElementById("root")!).render(<OnboardingGate />);
function ThemeBootstrap() {
  useEffect(() => {
    const apply = (value: string) => {
      document.body.dataset.theme = value;
    };
    if (!isTauriRuntime()) {
      apply(normalizeTheme(readPreviewAppearance("theme", () => localStorage)));
      return;
    }
    invoke<string | null>("workspace_setting", { key: "theme" })
      .then((value) => apply(normalizeTheme(value)))
      .catch(() => apply("obsidian"));
  }, []);
  return null;
}
function FontBootstrap() {
  useEffect(() => {
    const apply = (value: string | null | undefined) => {
      const nextFont = normalizeFont(value);
      document.body.dataset.font = nextFont;
    };
    if (!isTauriRuntime()) {
      apply(readPreviewAppearance("font", () => localStorage));
      return;
    }
    invoke<string | null>("workspace_setting", { key: "font" })
      .then(apply)
      .catch(() => apply("system"));
  }, []);
  return null;
}
