import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  Github,
  Hash,
  LayoutDashboard,
  MessageSquare,
  Minus,
  Moon,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Square,
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

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
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

type View =
  "home" | "code" | "threads" | "tasks" | "notifications" | "settings";
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
    void ensureDesktopNotificationPermission();
  }, []);
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
  useEffect(() => {
    let stop: undefined | (() => void);
    listen<{ message: string }>("wand://sync", (e) => {
      publishNotice("task", e.payload.message, e.payload.message);
    }).then((unlisten) => (stop = unlisten));
    return () => stop?.();
  }, []);
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
        refreshRepos();
        const provider = event.payload?.provider || "Provider";
        const count = event.payload?.count ?? 0;
        publishNotice(
          "provider",
          `${provider} sync completed`,
          `${count} repositories are available in Wand.`,
        );
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
    let stop: undefined | (() => void);
    listen<any>("wand://agent", (event) => {
      const payload = event.payload || {};
      if (payload.status !== "completed" && payload.status !== "verified")
        return;
      const task = tasks.find((item) => item.id === payload.task_id);
      if (!task || !payload.handoff) return;
      const author = payload.agent || "Wand agent";
      const body = `${payload.status === "verified" ? "Verification result" : "Stage handoff"}:\n${String(payload.handoff).slice(0, 4000)}`;
      invoke("create_thread_message", { repo: task.repo, author, body }).catch(
        () => {},
      );
    }).then((unsubscribe) => (stop = unsubscribe));
    return () => stop?.();
  }, [tasks]);
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
        { id: "path", label: "Local folder path", placeholder: "~/Code/wand" },
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
      setView("settings");
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
      setView("settings");
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
          <span className="wand-wordmark">wan<span className="wand-d">d<svg className="d-sparkle" viewBox="0 0 22 15" aria-hidden="true"><path d="M7 0 8.5 5.5 14 7 8.5 8.5 7 14 5.5 8.5 0 7 5.5 5.5Z" /><path d="M18 0 18.7 2.3 21 3 18.7 3.7 18 6 17.3 3.7 15 3 17.3 2.3Z" /><path d="M17 9 17.6 10.9 19.5 11.5 17.6 12.1 17 14 16.4 12.1 14.5 11.5 16.4 10.9Z" /></svg></span><span className="wand-dot">.</span></span>
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
              title="Notifications"
            >
              <Bell size={17} />
              <i />
            </button>
            <AccountMenu onSettings={() => setView("settings")} />
          </div>
        </header>
        {query.trim() && (
          <div className="search-palette">
            {[
              ["home", "Overview"],
              ["code", "Code"],
              ["threads", repo.name + " threads"],
              ["tasks", "Scheduled tasks"],
              ["notifications", "Notifications"],
              ...repos.map((r) => ["threads", r.name]),
              ...tasks.map((t) => ["tasks", t.name]),
              ...agentCatalog.map((a) => ["settings", a.name]),
            ]
              .filter((item) =>
                item[1].toLowerCase().includes(query.toLowerCase()),
              )
              .slice(0, 8)
              .map(([target, label], index) => (
                <button
                  key={target + label + index}
                  onMouseDown={() => {
                    setView(target as View);
                    setQuery("");
                  }}
                >
                  <span>{label}</span>
                  <small>{target}</small>
                </button>
              ))}
          </div>
        )}
        {notice && (
          <button className="toast" onClick={() => setNotice("")}>
            {notice} ×
          </button>
        )}
        {view === "home" ? (
          <Home setView={setView} userName={userName} />
        ) : view === "code" ? (
          <CodeWorkspace repo={repo} />
        ) : view === "threads" ? (
          <Threads repo={repo} agents={agentCatalog} />
        ) : view === "tasks" ? (
          <Tasks tasks={tasks} addTask={addTask} runTask={runTask} cancelTask={cancelTask} />
        ) : view === "notifications" ? (
          <Notifications />
        ) : (
          <SettingsView repos={repos} setRepos={setRepos} />
        )}
      </main>
    </div>
  );
}
function Home({
  setView,
  userName,
}: {
  setView: (v: View) => void;
  userName: string;
}) {
  type Event = {
    id: number;
    kind: string;
    message: string;
    created_at: string;
  };
  const [events, setEvents] = useState<Event[]>([]);
  const [localHour, setLocalHour] = useState<number | null>(null);
  const refresh = () =>
    invoke<Event[]>("list_events", { limit: 12 })
      .then(setEvents)
      .catch(() => setEvents([]));
  useEffect(() => {
    refresh();
    const names = ["wand://agent", "wand://scheduler", "wand://notifications"];
    const stops = names.map((name) => listen(name, refresh));
    return () => {
      stops.forEach((stop) => stop.then((fn) => fn()));
    };
  }, []);
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
          <p className="eyebrow">
            <span className="pulse" /> LOCAL WORKSPACE
          </p>
          <h1>{greeting}, {userName}.</h1>
          <p className="sub">
            Your agents are ready to work across your repositories.
          </p>
        </div>
        <button className="primary" onClick={() => setView("tasks")}>
          <Plus size={16} /> New task
        </button>
      </div>
      <div className="stats">
        <Stat
          icon={Zap}
          value={String(runs)}
          label="Agent events"
          hint="Persisted local activity"
        />
        <Stat
          icon={GitPullRequest}
          value={String(reviews)}
          label="Review notifications"
          hint="From provider sync"
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
      <div className="timeline">
        {events.length === 0 && (
          <div className="emptyhint">
            <Sparkles size={20} />
            <h3>No activity yet</h3>
            <p>
              Run a task or sync a provider to start your local activity
              history.
            </p>
          </div>
        )}
        {events.map((event, i) => (
          <article className="event" key={event.id}>
            <div
              className={
                "eventicon " + ["purple", "green", "yellow", "blue"][i % 4]
              }
            >
              <Activity size={17} />
            </div>
            <div className="eventbody">
              <div className="eventtop">
                <span className="kind">{event.kind}</span>
                <span className="tag blue">local</span>
                <span className="time">{event.created_at}</span>
              </div>
              <h3>{event.message}</h3>
              <p>
                <span className="repo-dot" /> Wand runtime
              </p>
            </div>
          </article>
        ))}
      </div>
      <div className="sectionhead agents">
        <div>
          <h2>Active agents</h2>
          <p>Configured coding specialists.</p>
        </div>
        <button className="textbtn" onClick={() => setView("settings")}>
          Manage agents →
        </button>
      </div>
      <div className="agentgrid">
        <Agent
          icon={Bot}
          name="Code reviewer"
          desc="Reviews new pull requests"
          status="Watching your repos"
        />
        <Agent
          icon={TerminalSquare}
          name="Sentinel"
          desc="Dependency & security audits"
          status="Schedule available"
        />
        <Agent
          icon={Code2}
          name="Pair programmer"
          desc="Your on-demand coding partner"
          status="Ready when you are"
        />
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
          <span className="green-dot" /> {status}
        </small>
      </div>
    </div>
  );
}
function CodeWorkspace({ repo }: { repo: Repo }) {
  const [editorTheme, setEditorTheme] = useState<"vs" | "vs-dark">(() =>
    ["daylight", "paper", "mint", "lavender"].includes(
      document.body.dataset.theme || "mint",
    )
      ? "vs"
      : "vs-dark",
  );
  const [path, setPath] = useState("README.md");
  const [draftPath, setDraftPath] = useState("README.md");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [mode, setMode] = useState<"file" | "diff">("file");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const lightThemes = new Set(["daylight", "paper", "mint", "lavender"]);
    const sync = () =>
      setEditorTheme(
        lightThemes.has(document.body.dataset.theme || "mint")
          ? "vs"
          : "vs-dark",
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const load = async () => {
    try {
      setError("");
      const versions = await invoke<{ original: string; modified: string }>(
        "git_file_versions",
        { repoPath: repo.path, relativePath: draftPath },
      );
      setPath(draftPath);
      setOriginal(versions.original);
      setContent(versions.modified);
    } catch (e) {
      setError(String(e));
    }
  };
  const save = async () => {
    try {
      setSaving(true);
      setError("");
      await invoke("write_repo_file", {
        repoPath: repo.path,
        relativePath: path,
        content,
      });
      setOriginal(content);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
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
          <button
            className={mode === "file" ? "outline active" : ""}
            onClick={() => setMode("file")}
          >
            File
          </button>
          <button
            className={mode === "diff" ? "outline active" : ""}
            onClick={() => setMode("diff")}
          >
            Git diff
          </button>
          <button
            className="outline"
            disabled={mode !== "file" || saving || !path}
            onClick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="primary" onClick={load}>
            Open
          </button>
        </div>
      </div>
      {error ? (
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
  };
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [tagged, setTagged] = useState<string[]>([]);
  const [postError, setPostError] = useState("");
  const hasRepo = repo.name !== emptyRepo.name;
  const load = () =>
    hasRepo
      ? invoke<Message[]>("list_thread_messages", { repo: repo.name })
          .then(setMessages)
          .catch(() => setMessages([]))
      : Promise.resolve(setMessages([]));
  useEffect(() => {
    load();
  }, [repo.name, hasRepo]);
  useEffect(() => {
    if (!hasRepo) return;
    const stop = listen<Message>("wand://thread", (event) => {
      if (event.payload.repo !== repo.name) return;
      setMessages((current) =>
        current.some((message) => message.id === event.payload.id)
          ? current
          : [...current, event.payload],
      );
    });
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, [repo.name, hasRepo]);
  const create = async () => {
    if (!hasRepo || !draft.trim()) return;
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
    }
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
              ? `Threads and agent context for ${repo.path}`
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
          <div className="thread-composer">
            <AgentMentionInput
              repo={repo.name}
              value={draft}
              onChange={setDraft}
              agents={agents}
              tagged={tagged}
              onTagged={setTagged}
              placeholder="Write a repository thread… Type @ to tag an agent"
            />
            <button className="primary" disabled={!draft.trim()} onClick={create}>
              Post
            </button>
          </div>
          {postError && (
            <div className="thread-error" role="alert">
              Could not post this thread: {postError}
            </div>
          )}
          <div className="threadlist">
            {messages.length === 0 ? (
              <div className="emptyhint">
                <MessageSquare size={20} />
                <h3>No repository messages yet</h3>
                <p>
                  Start the conversation for this repository and keep the context
                  local.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div className="thread" key={message.id}>
                  <div className="threadicon">
                    <Hash size={16} />
                  </div>
                  <div>
                    <h3>{message.body}</h3>
                    <p>
                      {message.author} · {message.created_at}
                    </p>
                  </div>
                  {message.agent_ids?.map((id) => <span className="tag purple" key={id}>@{agents.find((agent) => agent.id === id)?.name || id}</span>)}
                  <span className="tag blue">message</span>
                  <ChevronDown size={14} />
                </div>
              ))
            )}
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
  const [runs, setRuns] = useState<Run[]>([]);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript[]>>({});
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const load = () =>
    invoke<Run[]>("list_task_runs", { limit: 30 })
      .then(setRuns)
      .catch(() => setRuns([]));
  useEffect(() => {
    load();
    const names = ["wand://agent", "wand://scheduler"];
    const stops = names.map((name) => listen(name, load));
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
          <p>Durable scheduler records from the local SQLite database.</p>
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
          runs.map((run) => (
            <React.Fragment key={run.id}>
            <div className="run-row">
              <div>
                <b>
                  {tasks.find((t) => t.id === run.task_id)?.name || run.task_id}
                </b>
                <small>
                  {run.scheduled_at}
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
              <button className="retry-run" onClick={() => toggleTranscript(run)}>
                <ChevronDown size={13} /> {expandedRun === run.id ? "Hide transcript" : "View transcript"}
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
                {(transcripts[run.id] || []).length === 0 ? <p className="sub">No persisted stage output for this run yet.</p> : transcripts[run.id].map((stage) => (
                  <article className="transcript-stage" key={stage.id}>
                    <div><b>Stage {stage.stage} · {stage.agent}</b><span className={"tag " + (stage.status === "failed" ? "red" : stage.status === "verified" ? "green" : "blue")}>{stage.status}</span></div>
                    <pre>{stage.content}</pre>
                  </article>
                ))}
              </div>
            )}
            </React.Fragment>
          ))
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
    try {
      await invoke("sync_github_activity");
      await load();
    } catch {
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
            {loading ? "Syncing…" : "Sync GitHub"}
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
      <ThemeSection />
      <ProviderAccess />
      <CliManager />
      <AgentManager repos={repos} />
      <NotificationPreferencesSection />
      <WhatsNewSection />
    </section>
  );
}
function Onboarding({ done }: { done: (name: string) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const slides = [
    [
      "Welcome to Wand",
      "Your local-first AI engineering workspace. Plan, build, review, and verify without losing the thread.",
    ],
    [
      "Connect your workspace",
      "Choose a repository folder, then connect GitHub or Azure DevOps with a PAT when you are ready.",
    ],
    [
      "Meet your agent team",
      "Tag Planner, Builder, Reviewer, Docs, and Sentinel on any task. Each agent hands work to the next.",
    ],
    [
      "You stay in control",
      "Wand keeps work local, shows every handoff, and runs a final background verification before calling work done.",
    ],
  ];
  const current = slides[step];
  return (
    <div className="onboarding">
      <div className="onboard-card">
        <div className="onboard-mark" aria-hidden="true"><span className="wand-wordmark wand-wordmark-lg">wan<span className="wand-d">d<svg className="d-sparkle" viewBox="0 0 22 15"><path d="M7 0 8.5 5.5 14 7 8.5 8.5 7 14 5.5 8.5 0 7 5.5 5.5Z" /><path d="M18 0 18.7 2.3 21 3 18.7 3.7 18 6 17.3 3.7 15 3 17.3 2.3Z" /><path d="M17 9 17.6 10.9 19.5 11.5 17.6 12.1 17 14 16.4 12.1 14.5 11.5 16.4 10.9Z" /></svg></span><span className="wand-dot">.</span></span></div>
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
        <div className="onboard-dots">
          {slides.map((_, i) => (
            <i className={i === step ? "on" : ""} key={i} />
          ))}
        </div>
        <div className="onboard-actions">
          {step > 0 ? (
            <button className="textbtn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            className="primary"
            disabled={step === 0 && !name.trim()}
            onClick={() =>
              step < slides.length - 1 ? setStep(step + 1) : done(name.trim())
            }
          >
            {step < slides.length - 1 ? "Continue" : "Enter Wand"}
          </button>
        </div>
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
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState("");
  const [testing, setTesting] = useState("");
  const [message, setMessage] = useState("");
  const refresh = () =>
    Promise.all(
      ["github", "azure-devops"].map(
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
      `Connect ${provider === "github" ? "GitHub" : "Azure DevOps"}`,
      [
        {
          id: "token",
          label: "Personal access token",
          placeholder: "Paste your PAT",
          secret: true,
        },
      ],
      "The token is stored only in the native OS credential manager.",
    );
    if (!values?.token) return;
    try {
      await invoke("save_provider_token", { provider, token: values.token });
      await refresh();
      setMessage(`${provider === "github" ? "GitHub" : "Azure DevOps"} connected securely.`);
    } catch (cause) {
      setMessage(
        `Could not save ${provider === "github" ? "GitHub" : "Azure DevOps"} credentials: ${cause instanceof Error ? cause.message : String(cause)}`,
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
      setMessage(`${provider === "github" ? "GitHub" : "Azure DevOps"} disconnected.`);
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
        provider === "github" ? "sync_github" : "sync_azure_devops",
        args,
      );
      setMessage(
        `${rows.length} ${provider === "github" ? "GitHub" : "Azure DevOps"} repositories synced. Background activity polling enabled.`,
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
      setMessage(`${provider === "github" ? "GitHub" : "Azure DevOps"}: ${result}.`);
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
      ].map(([id, name]) => (
        <div className="provider-row" key={id}>
          <div>
            <b>{name}</b>
            <small>
              {status[id]
                ? "Connected in OS credential store"
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
    const cliOptions = (enabledClis.length ? enabledClis : ["codex"]).filter(
      (cli) => cli !== "kimi" || enabledClis.includes("kimi"),
    );
    const modelOptions: Record<string, string[]> = {
      claude: ["default", "sonnet", "opus"],
      codex: ["default", "gpt-5-codex"],
      gemini: ["default", "gemini-2.5-pro"],
      kimi: ["default", "kimi-k2"],
    };
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
          optionsFor: (current) =>
            modelOptions[current.cli || selectedCli || "codex"] || ["default"],
        },
        {
          id: "scope",
          label: "Scope",
          value: agent?.scope || "workspace",
          options: ["workspace", ...repos.map((repo) => `repo:${repo.name}`)],
        },
      ],
      "Give each agent one clear responsibility. This text is used as its execution instruction.",
    );
    if (!values?.name) return;
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
    }).catch(() => {});
    load();
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
}: {
  repo: string;
  value: string;
  onChange: (value: string) => void;
  agents: Agent[];
  tagged: string[];
  onTagged: (ids: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const available = agents.filter(
    (agent) =>
      !agent.scope ||
      agent.scope === "workspace" ||
      agent.scope === `repo:${repo}`,
  );
  const choose = (agent: Agent) => {
    const at = value.lastIndexOf("@");
    const next =
      at >= 0
        ? value.slice(0, at) + "@" + agent.name + " "
        : value + "@" + agent.name + " ";
    onChange(next);
    onTagged(tagged.includes(agent.id) ? tagged : [...tagged, agent.id]);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  };
  const update = (next: string) => {
    onChange(next);
    const at = next.lastIndexOf("@");
    const fragment = at >= 0 ? next.slice(at + 1) : "";
    setQuery(fragment);
    setOpen(at >= 0 && !fragment.includes(" "));
    setHighlighted(0);
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
        value={value}
        onChange={(event) => update(event.target.value)}
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
            choose(matches[highlighted]);
          }
        }}
      />
      {open && (
        <div className="mention-menu" role="listbox" aria-label="Agents to tag">
          {matches.map((agent, index) => (
              <button
                type="button"
                key={agent.id}
                role="option"
                aria-selected={index === highlighted}
                className={index === highlighted ? "highlighted" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(agent);
                }}
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
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (!isTauriRuntime()) {
      try {
        const value = localStorage.getItem("wand.notification-prefs");
        if (value) setPrefs({ ...defaults, ...JSON.parse(value) });
      } catch {
        // Keep safe defaults when browser preview state is malformed.
      }
      return;
    }
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
  }, []);
  const toggle = async (key: keyof Prefs) => {
    const previous = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaved(false);
    setSaveError("");
    try {
      if (!isTauriRuntime()) {
        localStorage.setItem("wand.notification-prefs", JSON.stringify(next));
      } else {
        await invoke("save_workspace_setting", {
          key: "notification-prefs",
          value: JSON.stringify(next),
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setPrefs(previous);
      setSaveError(`Unable to save notification preferences: ${String(error)}`);
    }
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
        {saved && <span className="tag green">Saved</span>}
      </div>
      {saveError && <p className="provider-message" role="alert">{saveError}</p>}
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
              onChange={() => toggle(key as keyof Prefs)}
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
          title: "Local-First Privacy & OS Keychains",
          desc: "All repository activity stays on your machine with PAT tokens secured directly in native OS keychains.",
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
  const [theme, setTheme] = useState(() =>
    isTauriRuntime() ? "mint" : localStorage.getItem("wand.theme") || "mint",
  );
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    invoke<string | null>("workspace_setting", { key: "theme" })
      .then((value) => {
        if (!value) return;
        setTheme(value);
        document.body.dataset.theme = value;
        if (!isTauriRuntime()) localStorage.setItem("wand.theme", value);
      })
      .catch(() => {});
  }, []);
  const isLight = ["daylight", "paper", "mint", "lavender"].includes(theme);
  const choose = async (name: string) => {
    const previous = theme;
    setTheme(name);
    setSaveError("");
    document.body.dataset.theme = name;
    try {
      if (!isTauriRuntime()) {
        localStorage.setItem("wand.theme", name);
      } else {
        await invoke("save_workspace_setting", { key: "theme", value: name });
      }
    } catch (error) {
      setTheme(previous);
      document.body.dataset.theme = previous;
      setSaveError(`Unable to save theme: ${String(error)}`);
    }
  };
  const setMode = (mode: "dark" | "light") => {
    const defaultTheme = mode === "light" ? "daylight" : "obsidian";
    choose(defaultTheme);
  };
  return (
    <div className="settings-section appearance-section">
      <div className="settings-section-head">
        <div>
          <p className="eyebrow">APPEARANCE</p>
          <h2>Theme & Color Mode</h2>
          <p>
            Switch between Dark Mode and Light Mode or choose a custom accent
            palette.
          </p>
        </div>
        <span className="theme-current">{theme}</span>
      </div>
      {saveError && <p className="provider-message" role="alert">{saveError}</p>}
      <div className="mode-toggle-group">
        <button
          className={"mode-btn " + (!isLight ? "active" : "")}
          onClick={() => setMode("dark")}
        >
          <Moon size={16} />
          <span>Dark Mode</span>
        </button>
        <button
          className={"mode-btn " + (isLight ? "active" : "")}
          onClick={() => setMode("light")}
        >
          <Sun size={16} />
          <span>Light Mode</span>
        </button>
      </div>
      <div className="theme-grid-container">
        <label className="theme-group-label">
          {isLight ? "Light Accent Palettes" : "Dark Accent Palettes"}
        </label>
        <div className="theme-grid">
          {(isLight
            ? ["daylight", "paper", "mint", "lavender"]
            : ["obsidian", "aurora", "amethyst", "ember"]
          ).map((name) => (
            <button
              aria-label={name + " theme"}
              className={
                "theme-choice " + name + (theme === name ? " active" : "")
              }
              onClick={() => choose(name)}
              key={name}
            >
              <span />
              {name}
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".account-menu"))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const goToSettings = () => {
    setOpen(false);
    onSettings();
  };
  return (
    <div className="account-menu">
      <button
        className={"account-trigger " + (open ? "open" : "")}
        aria-label="Settings menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Settings size={16} />
      </button>
      {open && (
        <div className="account-dropdown" role="menu">
          <div className="account-heading">
            <strong>Settings</strong>
            <small>Wand workspace</small>
          </div>
          <button role="menuitem" onClick={goToSettings}>
            <Settings size={14} /> Open settings
          </button>
          <button role="menuitem" onClick={goToSettings}>
            <Sparkles size={14} /> Updates & release notes
          </button>
        </div>
      )}
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
function WindowChrome() {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__)
    return null;
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const appWindow = getCurrentWindow();
  const runWindowCommand = (name: string, command: () => Promise<void>) => {
    command().catch((error) =>
      console.error(`Unable to ${name} the Wand window`, error),
    );
  };
  return (
    <div className={"window-chrome" + (isMac ? " mac" : "")}>
      <div className="window-drag" data-tauri-drag-region />
      <div className="window-controls">
        <button
          className="window-minimize"
          aria-label="Minimize Wand"
          onClick={() =>
            runWindowCommand("minimize", () => appWindow.minimize())
          }
        >
          <Minus size={13} />
        </button>
        <button
          className="window-maximize"
          aria-label="Maximize Wand"
          onClick={() =>
            runWindowCommand("maximize", () => appWindow.toggleMaximize())
          }
        >
          <Square size={12} />
        </button>
        <button
          className="window-close"
          aria-label="Close Wand"
          onClick={() => runWindowCommand("close", () => appWindow.close())}
        >
          <X size={13} />
        </button>
      </div>
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
  const [error, setError] = useState("");
  useEffect(() => {
    const stop = listen<any>("wand://provider", (event) => {
      if (event.payload?.status === "error")
        setError(`${event.payload.provider}: ${event.payload.error}`);
      else if (event.payload?.status === "ok") setError("");
    });
    return () => {
      stop.then((unsubscribe) => unsubscribe());
    };
  }, []);
  if (!error) return null;
  return (
    <button
      className="provider-health-error"
      onClick={() => setError("")}
      title="Dismiss provider health warning"
    >
      <span className="background-dot error" />
      <span>{error}</span>
      <b>×</b>
    </button>
  );
}
function UpdateBanner() {
  const [update, setUpdate] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    const checkForUpdate = async () => {
      if (!active) return;
      setChecking(true);
      try {
        const value = await check();
        if (!active) return;
        setError("");
        setUpdate(value ?? null);
        setDismissed(false);
      } catch (reason) {
        if (active) setError(String(reason));
      } finally {
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
    try {
      setBusy(true);
      setError("");
      await update.downloadAndInstall();
      await relaunch();
    } catch (value) {
      setBusy(false);
      setError(String(value));
    }
  };
  const retry = () => {
    setDismissed(false);
    setError("");
    setRetryToken((token) => token + 1);
  };
  return (
    <aside className="update-banner" aria-label={update ? "Wand update available" : "Wand update status"}>
      <div className="update-banner-icon">
        <Sparkles size={15} />
      </div>
      <div className="update-banner-copy">
        <strong>{busy ? "Installing update…" : update ? "Update available" : "Update check unavailable"}</strong>
        <span>{update ? `Wand ${update.version}` : checking ? "Checking GitHub releases…" : "Retry when you are online"}</span>
        {error && <small>{error}</small>}
      </div>
      <button onClick={update ? install : retry} disabled={busy || checking}>
        {busy ? "Installing…" : update ? "Approve" : "Retry"}
      </button>
      {!busy && <button className="update-dismiss" aria-label="Dismiss update status" onClick={() => setDismissed(true)}>×</button>}
    </aside>
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
        setShow(localStorage.getItem("wand.onboarding.complete") !== "true"),
      );
  }, []);
  const finish = async (name: string) => {
    await invoke("save_user_name", { name }).catch(() => {});
    window.dispatchEvent(new CustomEvent("wand:user-name", { detail: name }));
    localStorage.setItem("wand.onboarding.complete", "true");
    setShow(false);
  };
  return (
    <>
      <App />
      <WindowChrome />
      <BackgroundStatus />
      <ProviderHealth />
      <UpdateBanner />
      <RuntimeIdentity />
      <ThemeBootstrap />
      <ModalHost />
      {show === true && <Onboarding done={finish} />}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<OnboardingGate />);
function ThemeBootstrap() {
  useEffect(() => {
    const apply = (value: string) => {
      document.body.dataset.theme = value;
      if (!isTauriRuntime()) localStorage.setItem("wand.theme", value);
    };
    if (!isTauriRuntime()) {
      apply(localStorage.getItem("wand.theme") || "mint");
      return;
    }
    invoke<string | null>("workspace_setting", { key: "theme" })
      .then((value) => apply(value || "mint"))
      .catch(() => apply("mint"));
  }, []);
  return null;
}
