import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Mode = 'read-only' | 'ask' | 'auto';
type View = 'session' | 'models' | 'agents' | 'sessions' | 'memory' | 'settings' | 'help';
type Conn = 'connecting' | 'online' | 'offline' | 'unauthorized';
type Theme = 'system' | 'dark' | 'light';

interface ProviderView {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  models: string[];
  local: boolean;
  apiKeyEnv: string[];
  baseURL: string;
  configured: boolean;
}

interface StatusView {
  workspaceRoot: string;
  os: string;
  provider: string;
  model: string;
  mode: Mode;
  recordedTrajectories: number;
}

interface StepView {
  stepIndex: number;
  thought?: string;
  toolCall?: { name: string; arguments: any };
  toolResult?: { output: string; isError?: boolean; error?: string };
}

interface TrajectoryView {
  trajectoryId: string;
  task: string;
  startedAt: number;
  finalReward: number;
  steps: StepView[];
  rewardBreakdown?: Record<string, any>;
  metadata?: Record<string, any>;
}

interface RunEvent {
  at: number;
  kind: 'info' | 'thought' | 'tool' | 'plan' | 'approval' | 'result' | 'error';
  agent?: string;
  text: string;
  ok?: boolean;
  tool?: string;
  args?: Record<string, any>;
  error?: string;
}

interface RunView {
  running: boolean;
  runId?: string;
  task?: string;
  provider?: string;
  model?: string;
  mode?: Mode;
  agent?: string;
  events?: RunEvent[];
  plan?: { id: string; title: string; status: string }[];
  pendingApproval?: { id: string; tool: string; args: any } | null;
  result?: {
    succeeded: boolean;
    summary: string;
    stopReason: string;
    verified?: boolean | null;
    iterations: number;
    usage: { totalTokens: number };
    trajectoryId: string;
    finalReward: number;
  } | null;
  error?: string | null;
}

interface AgentDef {
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  provider?: string;
  model?: string;
  mode?: Mode;
}

interface Command {
  name: string;
  about: string;
  run: () => void;
}

const MODES: Mode[] = ['read-only', 'ask', 'auto'];
const MODE_RANK: Record<Mode, number> = { 'read-only': 0, ask: 1, auto: 2 };
const VIEWS: View[] = ['session', 'models', 'agents', 'sessions', 'memory', 'settings'];

function store(key: string, value?: string): string {
  try {
    if (value !== undefined) window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) || '';
  } catch {
    return value || '';
  }
}

function initialToken(): string {
  const match = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
  if (match) {
    store('dockyard.token', match[1]);
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* ignore */
    }
    return match[1];
  }
  return store('dockyard.token');
}

function initialServer(): string {
  const saved = store('dockyard.server');
  if (saved) return saved;
  // Served by `dockyard app`: same origin. Under the Vite dev server: the default local port.
  const viaVite = window.location.port === '5173' || window.location.protocol === 'file:';
  return viaVite ? 'http://127.0.0.1:4040' : window.location.origin;
}

/** One line that says what a tool call did, the way a person would write it in a terminal log. */
function describeTool(tool: string, args: Record<string, any> = {}): string {
  switch (tool) {
    case 'read_file':
      return `read ${args.filepath ?? ''}`;
    case 'write_file':
      return `write ${args.filepath ?? ''}`;
    case 'edit_file_diff':
      return `edit ${args.filepath ?? ''}`;
    case 'run_command':
      return `$ ${args.command ?? ''}`;
    case 'list_files':
      return `list ${args.directory || '.'}${args.pattern ? ` (${args.pattern})` : ''}`;
    case 'search_text':
      return `search "${args.pattern ?? ''}"${args.directory ? ` in ${args.directory}` : ''}`;
    case 'delegate_task':
      return `delegate to ${args.agent ?? '?'}: ${args.task ?? ''}`;
    case 'update_plan': {
      if (Array.isArray(args.steps)) {
        const done = args.steps.filter((s: any) => s?.status === 'completed').length;
        return `plan ${done}/${args.steps.length} done`;
      }
      return `update plan${args.steps ? ` (${args.steps})` : ''}`;
    }
    default:
      return `${tool} ${JSON.stringify(args)}`;
  }
}

const PLAN_MARK: Record<string, string> = { completed: '[x]', in_progress: '[~]', failed: '[!]', skipped: '[-]', pending: '[ ]' };

function when(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortPath(p: string): string {
  return p.replace(/^\/(Users|home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}

export const App: React.FC = () => {
  const [view, setView] = useState<View>('session');
  const [serverUrl, setServerUrl] = useState(initialServer);
  const [token, setToken] = useState(initialToken);
  const [conn, setConn] = useState<Conn>('connecting');
  const [status, setStatus] = useState<StatusView | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [mode, setMode] = useState<Mode>('ask');
  const [maxSteps, setMaxSteps] = useState(20);
  const [verify, setVerify] = useState('');
  const [runAs, setRunAs] = useState('');
  const [prompt, setPrompt] = useState('');
  const [run, setRun] = useState<RunView>({ running: false });
  const [cleared, setCleared] = useState('');
  const [notice, setNotice] = useState('');
  const [trajectories, setTrajectories] = useState<TrajectoryView[]>([]);
  const [openTrajectory, setOpenTrajectory] = useState('');
  const [pairCount, setPairCount] = useState(0);
  const [heuristics, setHeuristics] = useState<string[]>([]);
  const [episodes, setEpisodes] = useState(0);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', tools: '', mode: '' });
  const [sidebar, setSidebar] = useState(true);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [stopArmed, setStopArmed] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (store('dockyard.theme') as Theme) || 'system');
  const logEnd = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    store('dockyard.theme', theme);
  }, [theme]);

  const api = useCallback(
    async (path: string, init: { method?: string; body?: unknown } = {}) => {
      const res = await fetch(`${serverUrl.replace(/\/+$/, '')}${path}`, {
        method: init.method || 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined
      });
      if (res.status === 401) {
        setConn('unauthorized');
        throw new Error('access token rejected. open the link printed by "dockyard app", or paste the token in /settings.');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
      return data;
    },
    [serverUrl, token]
  );

  const guard = useCallback(async (work: () => Promise<void>) => {
    try {
      setNotice('');
      await work();
    } catch (err: any) {
      setNotice(err?.message || String(err));
    }
  }, []);

  const connect = useCallback(async () => {
    setConn('connecting');
    try {
      const [s, p, r, a] = await Promise.all([api('/api/status'), api('/api/providers'), api('/api/run/current'), api('/api/agents')]);
      setStatus(s);
      setProviders(p.providers);
      setRun(r);
      setAgents(a.agents);
      setConn('online');
      setMode(prev => (MODE_RANK[prev] > MODE_RANK[s.mode as Mode] ? s.mode : prev));
      setSelectedProvider(prev => prev || (p.active === 'mock' ? '' : p.active));
      setSelectedModel(prev => prev || p.activeModel || '');
    } catch {
      setConn(c => (c === 'unauthorized' ? c : 'offline'));
    }
  }, [api]);

  const loadTrajectories = useCallback(
    () =>
      guard(async () => {
        const data = await api('/api/trajectories');
        setTrajectories([...data.trajectories].sort((a: TrajectoryView, b: TrajectoryView) => b.startedAt - a.startedAt));
        setPairCount(data.dpoPairs.length);
      }),
    [api, guard]
  );
  const loadMemory = useCallback(
    () =>
      guard(async () => {
        const data = await api('/api/memory');
        setHeuristics(data.heuristics);
        setEpisodes(data.episodes);
      }),
    [api, guard]
  );
  const loadAgents = useCallback(() => guard(async () => setAgents((await api('/api/agents')).agents)), [api, guard]);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (conn !== 'online') return;
    if (view === 'sessions') loadTrajectories();
    if (view === 'memory') loadMemory();
    if (view === 'agents') loadAgents();
    if (view === 'session') promptRef.current?.focus();
  }, [view, conn, loadTrajectories, loadMemory, loadAgents]);

  // While a task runs, poll for its log, plan and any permission request.
  useEffect(() => {
    if (conn !== 'online' || !run.running) return;
    const timer = window.setInterval(async () => {
      try {
        setRun(await api('/api/run/current'));
      } catch {
        /* next tick retries */
      }
    }, 800);
    return () => window.clearInterval(timer);
  }, [api, conn, run.running]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [run.events?.length, run.pendingApproval?.id]);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt, view]);

  const provider = useMemo(() => providers.find(p => p.id === selectedProvider), [providers, selectedProvider]);
  const maxMode: Mode = status?.mode || 'read-only';
  const needsKey = !!provider && !provider.local && !provider.configured && !apiKey.trim();
  const simulation = !selectedProvider;
  const shown = run.runId && run.runId === cleared ? ({ running: false } as RunView) : run;
  const modelLabel = simulation ? 'simulation' : `${selectedProvider}/${selectedModel || provider?.defaultModel || 'default'}`;

  const selectProvider = (id: string) => {
    setSelectedProvider(id);
    setSelectedModel(providers.find(p => p.id === id)?.defaultModel || '');
    setApiKey('');
    setEndpointUrl('');
  };

  const startRun = (task: string) =>
    guard(async () => {
      if (!task.trim() || run.running) return;
      if (needsKey) {
        setView('models');
        throw new Error(`${provider!.id} has no api key. enter one here, or set ${provider!.apiKeyEnv[0]} before starting dockyard.`);
      }
      await api('/api/run', {
        method: 'POST',
        body: {
          task: task.trim(),
          wait: false,
          mode,
          maxSteps,
          ...(selectedProvider ? { provider: selectedProvider, model: selectedModel || undefined } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(endpointUrl.trim() ? { baseURL: endpointUrl.trim() } : {}),
          ...(runAs ? { agent: runAs } : {}),
          ...(verify.trim() && maxMode === 'auto' ? { verify: verify.trim() } : {})
        }
      });
      setPrompt('');
      setCleared('');
      setRun(await api('/api/run/current'));
    });

  const decide = (allow: boolean) =>
    guard(async () => {
      if (!run.pendingApproval) return;
      await api('/api/approve', { method: 'POST', body: { id: run.pendingApproval.id, allow } });
      setRun(await api('/api/run/current'));
    });

  const stopRun = () =>
    guard(async () => {
      setStopArmed(false);
      if (run.running) await api('/api/run/cancel', { method: 'POST', body: {} });
    });

  const rate = (trajectoryId: string, score: number) =>
    guard(async () => {
      await api('/api/feedback', { method: 'POST', body: { trajectoryId, score } });
      await loadTrajectories();
    });

  const exportDpo = () =>
    guard(async () => {
      const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/dpo`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const text = await res.text();
      if (!text.trim()) {
        throw new Error('no preference pairs yet. a pair needs two recorded runs of the same task whose rewards differ by at least 0.5.');
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/jsonl' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dpo_pairs.jsonl';
      a.click();
      URL.revokeObjectURL(url);
    });

  const forget = (heuristic: string) =>
    guard(async () => {
      await api('/api/memory/forget', { method: 'POST', body: { heuristic } });
      await loadMemory();
    });

  const saveAgent = () =>
    guard(async () => {
      await api('/api/agents', {
        method: 'POST',
        body: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          instructions: draft.instructions.trim(),
          ...(draft.tools.trim() ? { tools: draft.tools.split(',').map(t => t.trim()).filter(Boolean) } : {}),
          ...(draft.mode ? { mode: draft.mode } : {})
        }
      });
      setDraft({ name: '', description: '', instructions: '', tools: '', mode: '' });
      await loadAgents();
    });

  const deleteAgent = (name: string) =>
    guard(async () => {
      await api(`/api/agents/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (runAs === name) setRunAs('');
      await loadAgents();
    });

  const saveConnection = () => {
    store('dockyard.server', serverUrl);
    store('dockyard.token', token);
    connect();
  };

  const agentNames = useMemo(() => ['', ...agents.map(a => a.name)], [agents]);
  const cycleAgent = (step: number) => {
    const i = agentNames.indexOf(runAs);
    setRunAs(agentNames[(i + step + agentNames.length) % agentNames.length]);
  };
  const cycleMode = () => {
    const allowed = MODES.filter(m => MODE_RANK[m] <= MODE_RANK[maxMode]);
    setMode(allowed[(allowed.indexOf(mode) + 1) % allowed.length]);
  };

  const commands: Command[] = useMemo(
    () => [
      { name: '/new', about: 'clear the screen for a new task', run: () => { setCleared(run.runId || ''); setView('session'); } },
      { name: '/models', about: 'choose provider and model', run: () => setView('models') },
      { name: '/agents', about: 'create and remove teammates', run: () => setView('agents') },
      { name: '/sessions', about: 'past runs, ratings, dpo export', run: () => setView('sessions') },
      { name: '/memory', about: 'rules learned for this workspace', run: () => setView('memory') },
      { name: '/settings', about: 'limits, verify command, connection', run: () => setView('settings') },
      { name: '/mode', about: `permission mode (now ${mode})`, run: cycleMode },
      { name: '/agent', about: `switch agent (now ${runAs || 'lead'})`, run: () => cycleAgent(1) },
      { name: '/stop', about: 'stop the running task', run: () => void stopRun() },
      { name: '/export', about: 'download dpo preference pairs', run: () => void exportDpo() },
      { name: '/sidebar', about: 'show or hide the sidebar', run: () => setSidebar(s => !s) },
      { name: '/theme', about: `colour theme (now ${theme})`, run: () => setTheme(t => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system')) },
      { name: '/help', about: 'keys and commands', run: () => setView('help') }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, runAs, theme, run.runId, run.running, maxMode, agentNames]
  );

  const slashOpen = view === 'session' && prompt.startsWith('/') && !prompt.includes(' ') && !prompt.includes('\n');
  const slashMatches = slashOpen ? commands.filter(c => c.name.startsWith(prompt.toLowerCase())) : [];
  const paletteMatches = commands.filter(c => `${c.name} ${c.about}`.toLowerCase().includes(paletteQuery.toLowerCase()));

  useEffect(() => setCursor(0), [prompt, paletteQuery, palette]);

  const runCommand = (c?: Command) => {
    if (!c) return;
    setPrompt('');
    setPalette(false);
    setPaletteQuery('');
    c.run();
  };

  // App-wide keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'p' || e.key === 'k')) {
        e.preventDefault();
        setPalette(p => !p);
      } else if (mod && e.key === 'b') {
        e.preventDefault();
        setSidebar(s => !s);
      } else if (e.key === 'Escape') {
        if (palette) {
          setPalette(false);
        } else if (view !== 'session') {
          setView('session');
        } else if (run.running) {
          // Two presses, so a stray escape does not kill a long task.
          if (stopArmed) void stopRun();
          else {
            setStopArmed(true);
            window.setTimeout(() => setStopArmed(false), 2000);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, view, run.running, stopArmed]);

  const onPromptKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashMatches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor(c => (c + (e.key === 'ArrowDown' ? 1 : -1) + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        runCommand(slashMatches[cursor]);
        return;
      }
    }
    if (run.pendingApproval && !prompt && (e.key === 'y' || e.key === 'n')) {
      e.preventDefault();
      void decide(e.key === 'y');
      return;
    }
    if (e.key === 'Tab' && !prompt) {
      e.preventDefault();
      cycleAgent(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (prompt.startsWith('/')) setNotice(`unknown command ${prompt.trim()}. type / to list commands.`);
      else void startRun(prompt);
    }
  };

  const onPaletteKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (paletteMatches.length) setCursor(c => (c + (e.key === 'ArrowDown' ? 1 : -1) + paletteMatches.length) % paletteMatches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(paletteMatches[cursor]);
    }
  };

  const connLabel = conn === 'online' ? (run.running ? 'working' : 'ready') : conn === 'connecting' ? 'connecting' : conn === 'unauthorized' ? 'no token' : 'offline';
  const connClass = conn === 'online' ? (run.running ? 'warn' : 'ok') : conn === 'connecting' ? 'muted' : 'err';

  const transcript = () => {
    const events = shown.events || [];
    let lastThought = '';
    const rows: React.ReactNode[] = [];
    events.forEach((e, i) => {
      if (e.kind === 'info' || e.kind === 'plan') return;
      if (e.kind === 'thought') {
        lastThought = e.text;
        rows.push(<div key={i} className="msg">{e.text}</div>);
      } else if (e.kind === 'tool') {
        if (e.tool === 'update_plan' && e.ok) return;
        const who = e.agent && e.agent !== shown.agent ? `${e.agent} ` : '';
        rows.push(
          <div key={i} className="msg tool">
            <span className={e.ok ? 'ok' : 'err'}>{e.ok ? '✓' : '✗'}</span>
            <span className="what">{who && <span className="info">{who}</span>}{e.tool ? describeTool(e.tool, e.args) : e.text}</span>
          </div>
        );
        if (!e.ok && e.error) {
          rows.push(<div key={`${i}e`} className="msg detail">{/rejected by user policy/.test(e.error) ? 'denied' : e.error}</div>);
        }
      } else if (e.kind === 'approval') {
        // The tool line that follows already shows whether the call ran or was denied.
        return;
      } else if (e.text && e.text !== lastThought) {
        rows.push(<div key={i} className={`msg ${e.kind === 'error' ? 'err' : ''}`}>{e.text}</div>);
      }
    });
    return rows;
  };

  const field = (value: string, onChange: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="field" value={value} onChange={e => onChange(e.target.value)} {...extra} />
  );

  return (
    <div className="app">
      <header className="bar">
        <span className="name">dockyard</span>
        <span className="path">{status ? shortPath(status.workspaceRoot) : 'no workspace'}</span>
        <nav aria-label="views">
          {VIEWS.map(v => (
            <button key={v} onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}>{v}</button>
          ))}
        </nav>
        <span className={`state ${connClass}`}>● {connLabel}</span>
      </header>

      {conn !== 'online' && conn !== 'connecting' && (
        <div className="banner err" role="alert">
          <span>
            {conn === 'unauthorized'
              ? 'no valid access token. open the full link printed by "dockyard app" (it ends in #token=...), or paste the token in settings.'
              : `cannot reach the dockyard server at ${serverUrl}. run "dockyard app" in your project folder and open the link it prints.`}
          </span>
          <button className="btn" onClick={connect}>retry</button>
        </div>
      )}
      {notice && (
        <div className="banner warn" role="status">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice('')}>dismiss</button>
        </div>
      )}

      <div className="body">
        <main className="view">
          {view === 'session' && (
            <>
              <div className="scroll">
                <div className="column">
                  {!shown.task ? (
                    <div className="start">
                      <p style={{ fontSize: 22, marginBottom: 16 }}><span className="muted">dock</span>yard</p>
                      <dl className="keys">
                        <dt>/models</dt><dd>choose provider and model</dd>
                        <dt>/agents</dt><dd>create and remove teammates</dd>
                        <dt>/sessions</dt><dd>past runs, ratings, dpo export</dd>
                        <dt>/memory</dt><dd>rules learned for this workspace</dd>
                        <dt>tab</dt><dd>switch agent</dd>
                        <dt>ctrl+p</dt><dd>all commands</dd>
                      </dl>
                      {simulation && conn === 'online' && (
                        <p className="warn" style={{ marginTop: 20, maxWidth: 520 }}>
                          no model provider is configured, so tasks get a canned reply and nothing runs. pick one with /models.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="msg user">{shown.task}</div>
                      {transcript()}
                      {shown.pendingApproval && (
                        <div className="permission" role="alertdialog" aria-label="permission required">
                          <div><span className="warn">permission required</span> {describeTool(shown.pendingApproval.tool, shown.pendingApproval.args)}</div>
                          <pre>{JSON.stringify(shown.pendingApproval.args, null, 2)}</pre>
                          <div className="actions">
                            <button className="btn solid" onClick={() => decide(true)}><kbd>y</kbd>allow</button>
                            <button className="btn" onClick={() => decide(false)}><kbd>n</kbd>deny</button>
                          </div>
                        </div>
                      )}
                      {shown.result && (
                        <div className="msg result">
                          <span className={shown.result.succeeded ? 'ok' : 'err'}>{shown.result.succeeded ? '✓' : '✗'} {shown.result.stopReason.replace('_', ' ')}</span>
                          {' · '}{shown.result.iterations} turn{shown.result.iterations === 1 ? '' : 's'}
                          {shown.result.usage?.totalTokens ? ` · ${shown.result.usage.totalTokens.toLocaleString()} tokens` : ''}
                          {' · reward '}{shown.result.finalReward.toFixed(2)}
                          {' · '}{shown.result.verified === true ? 'verified' : shown.result.verified === false ? <span className="err">verification failed</span> : 'not verified'}
                        </div>
                      )}
                      {shown.running && !shown.pendingApproval && <div className="msg muted">working…</div>}
                    </>
                  )}
                  <div ref={logEnd} />
                </div>
              </div>

              <div className={`prompt ${run.running ? 'busy' : ''}`}>
                <div className="column" style={{ position: 'relative' }}>
                  {slashMatches.length > 0 && (
                    <div className="menu" role="listbox" style={{ left: 0, right: 0 }}>
                      {slashMatches.map((c, i) => (
                        <button key={c.name} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => runCommand(c)}>
                          <span>{c.name}</span><span>{c.about}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="box">
                    <textarea
                      ref={promptRef}
                      rows={1}
                      autoFocus
                      aria-label="task"
                      placeholder={run.pendingApproval ? 'y to allow, n to deny' : run.running ? 'working. esc twice to stop' : 'describe a task, or type / for commands'}
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      onKeyDown={onPromptKey}
                      disabled={conn !== 'online'}
                    />
                    <div className="meta">
                      <button className="primary" onClick={() => cycleAgent(1)} title="switch agent (tab)">{runAs || 'lead'}</button>
                      <button className="muted" onClick={() => setView('models')} title="choose model (/models)">{modelLabel}</button>
                      <button className={mode === 'auto' ? 'warn' : 'muted'} onClick={cycleMode} title="permission mode (/mode)">{mode}</button>
                    </div>
                  </div>
                  <div className="hints">
                    {stopArmed ? <span className="warn">esc again to stop</span> : run.running ? <span><b>esc esc</b> stop</span> : <span><b>enter</b> run</span>}
                    <span><b>tab</b> agent</span>
                    <span><b>/</b> commands</span>
                    <span><b>ctrl+p</b> palette</span>
                    <span><b>ctrl+b</b> sidebar</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === 'models' && (
            <div className="scroll"><div className="column">
              <div className="head-line"><h2>models</h2><span className="muted">applies to the next task</span></div>
              <div className="rows models">
                {providers.filter(p => p.id !== 'custom').map(p => (
                  <div key={p.id} className={`row ${selectedProvider === p.id ? 'selected' : ''}`}>
                    <button className="head" onClick={() => selectProvider(p.id)} aria-pressed={selectedProvider === p.id}>
                      <span className={selectedProvider === p.id ? 'primary' : ''}>{p.id}</span>
                      <span className="title">{selectedProvider === p.id ? selectedModel || p.defaultModel : p.defaultModel}</span>
                      <span className={p.local ? 'muted' : p.configured ? 'ok' : 'muted'}>{p.local ? 'local' : p.configured ? 'key set' : 'no key'}</span>
                    </button>
                    {selectedProvider === p.id && (
                      <div className="detail">
                        <p className="muted" style={{ marginBottom: 8 }}>{p.description}</p>
                        <div className="form">
                          <label htmlFor="model">model</label>
                          <div>
                            {field(selectedModel, setSelectedModel, { id: 'model', list: 'model-ids', spellCheck: false })}
                            <datalist id="model-ids">{p.models.map(m => <option key={m} value={m} />)}</datalist>
                          </div>
                          <p className="note">vendors retire model ids often. if a run fails with "model not found", paste a current id here.</p>
                          {!p.local && (
                            <>
                              <label htmlFor="key">api key</label>
                              {field(apiKey, setApiKey, { id: 'key', type: 'password', autoComplete: 'off', placeholder: p.configured ? 'already set on the server' : `or set ${p.apiKeyEnv[0]}` })}
                              <p className="note">held in this page only and sent to your local dockyard server with each task. not written to disk.</p>
                            </>
                          )}
                          <label htmlFor="endpoint">endpoint</label>
                          {field(endpointUrl, setEndpointUrl, { id: 'endpoint', placeholder: p.baseURL, spellCheck: false })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="muted gap">{simulation ? 'nothing selected: tasks run in simulation.' : `selected: ${modelLabel}`}</p>
            </div></div>
          )}

          {view === 'agents' && (
            <div className="scroll"><div className="column">
              <div className="head-line"><h2>agents</h2><span className="muted">stored in .dockyard/agents/</span></div>
              <div className="rows">
                {agents.length === 0 && <div className="row muted">no teammates yet. the lead agent works alone.</div>}
                {agents.map(a => (
                  <div key={a.name} className="row">
                    <div className="head-line" style={{ marginBottom: 0 }}>
                      <span><span className="primary">{a.name}</span> {a.description}</span>
                      <button className="btn danger" onClick={() => deleteAgent(a.name)}>delete</button>
                    </div>
                    <div className="muted">tools {a.tools ? a.tools.join(', ') : 'all'} · mode {a.mode || 'same as task'}{a.provider ? ` · ${a.provider}${a.model ? `/${a.model}` : ''}` : ''}</div>
                  </div>
                ))}
              </div>
              <h2 className="gap">new agent</h2>
              <div className="form">
                <label htmlFor="a-name">name</label>
                {field(draft.name, v => setDraft({ ...draft, name: v }), { id: 'a-name', placeholder: 'reviewer', spellCheck: false })}
                <label htmlFor="a-desc">purpose</label>
                {field(draft.description, v => setDraft({ ...draft, description: v }), { id: 'a-desc', placeholder: 'reviews changes for bugs and missing tests' })}
                <p className="note">the lead agent reads this to decide when to delegate.</p>
                <label htmlFor="a-inst">instructions</label>
                <textarea id="a-inst" className="field" value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} placeholder="you are a careful reviewer. report concrete problems with file and line." />
                <label htmlFor="a-tools">tools</label>
                {field(draft.tools, v => setDraft({ ...draft, tools: v }), { id: 'a-tools', placeholder: 'read_file, list_files, search_text (blank for all)', spellCheck: false })}
                <label htmlFor="a-mode">permission cap</label>
                <select id="a-mode" className="field" value={draft.mode} onChange={e => setDraft({ ...draft, mode: e.target.value })}>
                  <option value="">same as task</option>
                  {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <span />
                <div><button className="btn solid" onClick={saveAgent} disabled={conn !== 'online'}>create</button></div>
              </div>
            </div></div>
          )}

          {view === 'sessions' && (
            <div className="scroll"><div className="column">
              <div className="head-line">
                <h2>sessions</h2>
                <span className="actions">
                  <span className="muted">{trajectories.length} run{trajectories.length === 1 ? '' : 's'} · {pairCount} dpo pair{pairCount === 1 ? '' : 's'}</span>
                  <button className="btn" onClick={loadTrajectories}>refresh</button>
                  <button className="btn" onClick={exportDpo}>export dpo</button>
                </span>
              </div>
              <div className="rows sessions">
                {trajectories.length === 0 && <div className="row muted">no runs recorded in this workspace.</div>}
                {trajectories.map(t => {
                  const open = openTrajectory === t.trajectoryId;
                  return (
                    <div key={t.trajectoryId} className={`row ${open ? 'selected' : ''}`}>
                      <button className="head" onClick={() => setOpenTrajectory(open ? '' : t.trajectoryId)} aria-expanded={open}>
                        <span className={t.finalReward > 0.5 ? 'ok' : 'err'}>{t.finalReward >= 0 ? '+' : ''}{t.finalReward.toFixed(2)}</span>
                        <span className="who info">{t.metadata?.agent || 'dockyard'}</span>
                        <span className="title">{t.task}</span>
                        <span className="muted when">{when(t.startedAt)}</span>
                      </button>
                      {open && (
                        <div className="detail">
                          <div className="head-line">
                            <span className="muted">{t.trajectoryId}{t.metadata?.provider ? ` · ${t.metadata.provider}` : ''} · {Object.entries(t.rewardBreakdown || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
                            <span className="actions">
                              <button className="btn" onClick={() => rate(t.trajectoryId, 1)}>good</button>
                              <button className="btn" onClick={() => rate(t.trajectoryId, -1)}>bad</button>
                            </span>
                          </div>
                          {t.steps.map(s => (
                            <div key={s.stepIndex} className="step">
                              {s.thought && <div style={{ color: 'var(--text)' }}>{s.thought.slice(0, 600)}</div>}
                              {s.toolCall && (
                                <div>
                                  <span className={s.toolResult?.isError ? 'err' : 'ok'}>{s.toolResult?.isError ? '✗' : '✓'}</span> {describeTool(s.toolCall.name, s.toolCall.arguments).slice(0, 300)}
                                </div>
                              )}
                              {s.toolResult?.isError && <div className="err">{(s.toolResult.error || '').slice(0, 400)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div></div>
          )}

          {view === 'memory' && (
            <div className="scroll"><div className="column">
              <div className="head-line"><h2>memory</h2><span className="muted">{episodes} past run{episodes === 1 ? '' : 's'} remembered</span></div>
              <p className="muted" style={{ marginBottom: 12 }}>every rule below is added to future prompts. forget any that are wrong.</p>
              <div className="rows">
                {heuristics.length === 0 && <div className="row muted">no rules yet. they appear after runs with a real model.</div>}
                {heuristics.map((h, i) => (
                  <div key={i} className="row head-line" style={{ marginBottom: 0 }}>
                    <span>{h}</span>
                    <button className="btn" onClick={() => forget(h)}>forget</button>
                  </div>
                ))}
              </div>
            </div></div>
          )}

          {view === 'settings' && (
            <div className="scroll"><div className="column">
              <h2 style={{ marginBottom: 12 }}>settings</h2>
              <div className="form">
                <label htmlFor="s-mode">permission mode</label>
                <select id="s-mode" className="field" value={mode} onChange={e => setMode(e.target.value as Mode)}>
                  {MODES.map(m => (
                    <option key={m} value={m} disabled={MODE_RANK[m] > MODE_RANK[maxMode]}>
                      {m}{MODE_RANK[m] > MODE_RANK[maxMode] ? ' (not allowed by this server)' : ''}
                    </option>
                  ))}
                </select>
                <p className="note">read-only: inspect only. ask: confirm each file write and command. auto: no confirmation. server limit: {maxMode}. commands are not sandboxed.</p>
                <label htmlFor="s-steps">max turns</label>
                {field(String(maxSteps), v => setMaxSteps(Math.max(1, Math.min(200, Number(v) || 1))), { id: 's-steps', type: 'number', min: 1, max: 200 })}
                <label htmlFor="s-verify">verify command</label>
                {field(verify, setVerify, { id: 's-verify', disabled: maxMode !== 'auto', placeholder: maxMode === 'auto' ? 'npm test' : 'needs a server started in auto mode', spellCheck: false })}
                <p className="note">runs after the agent finishes. the task only counts as succeeded if it passes.</p>
                <label htmlFor="s-theme">theme</label>
                <select id="s-theme" className="field" value={theme} onChange={e => setTheme(e.target.value as Theme)}>
                  <option value="system">system</option>
                  <option value="dark">dark</option>
                  <option value="light">light</option>
                </select>
                <label htmlFor="s-server">server</label>
                {field(serverUrl, setServerUrl, { id: 's-server', spellCheck: false })}
                <label htmlFor="s-token">access token</label>
                {field(token, setToken, { id: 's-token', type: 'password', autoComplete: 'off' })}
                <span />
                <div><button className="btn solid" onClick={saveConnection}>save and reconnect</button></div>
              </div>
              {status && (
                <p className="muted gap">{status.workspaceRoot} · {status.os} · server default {status.provider}{status.model ? `/${status.model}` : ''} · {status.recordedTrajectories} run{status.recordedTrajectories === 1 ? '' : 's'} recorded</p>
              )}
            </div></div>
          )}

          {view === 'help' && (
            <div className="scroll"><div className="column">
              <h2 style={{ marginBottom: 12 }}>keys</h2>
              <dl className="keys">
                <dt>enter</dt><dd>run the task</dd>
                <dt>shift+enter</dt><dd>new line</dd>
                <dt>tab</dt><dd>switch agent (when the prompt is empty)</dd>
                <dt>y / n</dt><dd>allow or deny a permission request (when the prompt is empty)</dd>
                <dt>esc esc</dt><dd>stop the running task</dd>
                <dt>esc</dt><dd>back to the session</dd>
                <dt>ctrl+p</dt><dd>command palette (also ctrl+k)</dd>
                <dt>ctrl+b</dt><dd>sidebar</dd>
              </dl>
              <h2 className="gap" style={{ marginBottom: 12 }}>commands</h2>
              <dl className="keys">
                {commands.map(c => <React.Fragment key={c.name}><dt>{c.name}</dt><dd>{c.about}</dd></React.Fragment>)}
              </dl>
            </div></div>
          )}
        </main>

        {view === 'session' && sidebar && (
          <aside className="side" aria-label="session details">
            <section>
              <h2>session</h2>
              <dl className="kv">
                <dt>agent</dt><dd>{shown.agent || runAs || 'lead'}</dd>
                <dt>model</dt><dd>{shown.task ? `${shown.provider}${shown.model ? `/${shown.model}` : ''}` : modelLabel}</dd>
                <dt>mode</dt><dd>{shown.mode || mode}</dd>
                {shown.result && (
                  <>
                    <dt>turns</dt><dd>{shown.result.iterations}</dd>
                    <dt>tokens</dt><dd>{(shown.result.usage?.totalTokens || 0).toLocaleString()}</dd>
                    <dt>reward</dt><dd>{shown.result.finalReward.toFixed(2)}</dd>
                  </>
                )}
              </dl>
            </section>
            <section>
              <h2>plan</h2>
              {(shown.plan || []).length === 0 ? (
                <p className="muted">none yet. the agent writes one for multi-step tasks.</p>
              ) : (
                (shown.plan || []).map(s => (
                  <div key={s.id} className={s.status === 'completed' ? 'muted' : s.status === 'failed' ? 'err' : ''}>
                    <span className={s.status === 'in_progress' ? 'primary' : ''}>{PLAN_MARK[s.status] || '[ ]'}</span> {s.title}
                  </div>
                ))
              )}
            </section>
            <section>
              <h2>teammates</h2>
              {agents.length === 0 ? (
                <p className="muted">none. add one with /agents.</p>
              ) : (
                agents.map(a => <div key={a.name}><span className="primary">{a.name}</span> <span className="muted">{a.description}</span></div>)
              )}
            </section>
          </aside>
        )}
      </div>

      {palette && (
        <div className="overlay" onClick={() => setPalette(false)}>
          <div className="palette" role="dialog" aria-label="commands" onClick={e => e.stopPropagation()}>
            <header><span>commands</span><span className="muted">esc</span></header>
            <input autoFocus aria-label="filter commands" placeholder="search" value={paletteQuery} onChange={e => setPaletteQuery(e.target.value)} onKeyDown={onPaletteKey} />
            <div className="list" role="listbox">
              {paletteMatches.length === 0 && <div className="muted" style={{ padding: '3px 12px' }}>no matching command</div>}
              {paletteMatches.map((c, i) => (
                <button key={c.name} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => runCommand(c)}>
                  <span>{c.name}</span><span>{c.about}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
