import React, { useState } from 'react';

type Tab = 'agent' | 'providers' | 'trajectories' | 'memory' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('agent');
  const [selectedProvider, setSelectedProvider] = useState('openrouter');
  const [taskPrompt, setTaskPrompt] = useState('Audit authentication middleware and generate comprehensive unit tests');

  const milestones = [
    {
      id: 'm1',
      title: 'Phase 1: Environment & Dependency Discovery',
      objective: 'Inspect project structure, configurations, and test runners.',
      status: 'completed',
      subtasks: [
        { title: 'Read package.json & workspaces layout', status: 'completed' },
        { title: 'Audit authentication middleware in packages/core/src/auth.ts', status: 'completed' },
      ],
    },
    {
      id: 'm2',
      title: 'Phase 2: Test Suite Hardening',
      objective: 'Write regression and fuzz tests covering edge cases and auth tokens.',
      status: 'in_progress',
      subtasks: [
        { title: 'Create mock JWT payload & expiry verification test', status: 'completed' },
        { title: 'Harden rate-limiter and header validation', status: 'in_progress' },
      ],
    },
    {
      id: 'm3',
      title: 'Phase 3: Verification & RL Trajectory Distillation',
      objective: 'Run test suite across Node matrix and record DPO preference pairs.',
      status: 'pending',
      subtasks: [
        { title: 'Execute vitest run on auth test cases', status: 'pending' },
        { title: 'Distill successful patterns into long-term heuristics', status: 'pending' },
      ],
    },
  ];

  const providers = [
    { id: 'openrouter', name: 'OpenRouter', model: 'anthropic/claude-3.5-sonnet', status: 'active', latency: '240ms', quota: 'Unlimited' },
    { id: 'nvidia', name: 'NVIDIA NIM', model: 'meta/llama-3.3-70b-instruct', status: 'ready', latency: '180ms', quota: 'Enterprise' },
    { id: 'anthropic', name: 'Anthropic Claude', model: 'claude-3-5-sonnet-latest', status: 'ready', latency: '310ms', quota: 'Active tier' },
    { id: 'gemini', name: 'Google Gemini', model: 'gemini-2.0-flash', status: 'ready', latency: '195ms', quota: 'Pay-as-you-go' },
    { id: 'groq', name: 'Groq LPU', model: 'llama-3.3-70b-versatile', status: 'ready', latency: '92ms', quota: 'Fast LPU' },
    { id: 'cerebras', name: 'Cerebras Wafer', model: 'llama-3.3-70b', status: 'ready', latency: '110ms', quota: 'WSE-3 Cluster' },
    { id: 'ollama', name: 'Ollama (Local)', model: 'llama3:latest', status: 'connected', latency: '35ms', quota: 'Local (127.0.0.1)' },
    { id: 'lmstudio', name: 'LM Studio (Local)', model: 'local-model', status: 'connected', latency: '40ms', quota: 'Local (127.0.0.1)' },
  ];

  const trajectories = [
    {
      id: 'traj_89127',
      task: 'Fix race condition in session state manager',
      provider: 'OpenRouter (Claude 3.5 Sonnet)',
      steps: 4,
      reward: '+2.50',
      outcome: 'Success',
      critique: 'High verifier score. Identified mutex lock boundary immediately.',
    },
    {
      id: 'traj_89128',
      task: 'Harden tool argument schema validation',
      provider: 'Groq (Llama 3.3 70B)',
      steps: 6,
      reward: '+1.80',
      outcome: 'Success',
      critique: '1 tool error recovered automatically on retry. Good DPO pair candidate.',
    },
    {
      id: 'traj_89129',
      task: 'Synthesize DPO dataset for tool-calling agent',
      provider: 'NVIDIA NIM (Llama 3.3 70B)',
      steps: 5,
      reward: '+3.00',
      outcome: 'Success',
      critique: 'Zero tool retries. Flawless planning tree traversal.',
    },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 260, backgroundColor: '#0f172a', borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
            ⚓
          </div>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: 16, color: '#f8fafc', letterSpacing: 0.5 }}>Dockyard</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Agentic AI Harness v1.0</div>
          </div>
        </div>

        <nav style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <button
            onClick={() => setActiveTab('agent')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'agent' ? '#1e293b' : 'transparent',
              color: activeTab === 'agent' ? '#38bdf8' : '#94a3b8',
              fontWeight: activeTab === 'agent' ? 'bold' : 'normal',
              textAlign: 'left',
              fontSize: 14,
            }}
          >
            🤖 Autonomous Agent
          </button>
          <button
            onClick={() => setActiveTab('providers')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'providers' ? '#1e293b' : 'transparent',
              color: activeTab === 'providers' ? '#38bdf8' : '#94a3b8',
              fontWeight: activeTab === 'providers' ? 'bold' : 'normal',
              textAlign: 'left',
              fontSize: 14,
            }}
          >
            ⚡ Multi-Provider Hub
          </button>
          <button
            onClick={() => setActiveTab('trajectories')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'trajectories' ? '#1e293b' : 'transparent',
              color: activeTab === 'trajectories' ? '#38bdf8' : '#94a3b8',
              fontWeight: activeTab === 'trajectories' ? 'bold' : 'normal',
              textAlign: 'left',
              fontSize: 14,
            }}
          >
            🎯 RL & DPO Exporter
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'memory' ? '#1e293b' : 'transparent',
              color: activeTab === 'memory' ? '#38bdf8' : '#94a3b8',
              fontWeight: activeTab === 'memory' ? 'bold' : 'normal',
              textAlign: 'left',
              fontSize: 14,
            }}
          >
            🧠 Memory & Heuristics
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'settings' ? '#1e293b' : 'transparent',
              color: activeTab === 'settings' ? '#38bdf8' : '#94a3b8',
              fontWeight: activeTab === 'settings' ? 'bold' : 'normal',
              textAlign: 'left',
              fontSize: 14,
            }}
          >
            ⚙️ Harness Settings
          </button>
        </nav>

        <div style={{ padding: '16px 20px', borderTop: '1px solid #1e293b', fontSize: 12, color: '#64748b' }}>
          <div>Local Daemon: <span style={{ color: '#22c55e' }}>● Running</span> (Port 4000)</div>
          <div style={{ marginTop: 4 }}>Workspaces: 3 packages loaded</div>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Header */}
        <header style={{ height: 60, borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', backgroundColor: '#090d16' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h2 style={{ fontSize: 18, color: '#f8fafc', fontWeight: 600 }}>
              {activeTab === 'agent' && 'Autonomous Agent Console'}
              {activeTab === 'providers' && 'Multi-Provider Routing & Latency Hub'}
              {activeTab === 'trajectories' && 'Reinforcement Learning Trajectories & DPO Exporter'}
              {activeTab === 'memory' && 'Multi-Tier Memory & Self-Improvement Heuristics'}
              {activeTab === 'settings' && 'Harness Sandbox & Environment Configuration'}
            </h2>
            <span style={{ backgroundColor: '#1e293b', padding: '3px 10px', borderRadius: 12, fontSize: 11, color: '#38bdf8' }}>
              Active Provider: {providers.find(p => p.id === selectedProvider)?.name}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              + New Task Run
            </button>
          </div>
        </header>

        {/* Tab Viewport */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 28, backgroundColor: '#0b0f17' }}>
          {/* TAB 1: AGENT */}
          {activeTab === 'agent' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, height: '100%' }}>
              {/* Left Column: Execution Conversation */}
              <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', fontWeight: 600, fontSize: 14, color: '#94a3b8' }}>
                  Execution Feed & Tool Interception
                </div>
                <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* User message */}
                  <div style={{ backgroundColor: '#1e293b', padding: 14, borderRadius: 8, alignSelf: 'flex-start', maxWidth: '85%' }}>
                    <div style={{ fontSize: 11, color: '#38bdf8', marginBottom: 4, fontWeight: 'bold' }}>USER PROMPT</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{taskPrompt}</div>
                  </div>

                  {/* Agent Response */}
                  <div style={{ backgroundColor: '#111c33', padding: 14, borderRadius: 8, border: '1px solid #1d4ed8', maxWidth: '90%' }}>
                    <div style={{ fontSize: 11, color: '#60a5fa', marginBottom: 4, fontWeight: 'bold' }}>DOCKYARD AGENT</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: '#e2e8f0' }}>
                      I am decomposing this objective into 3 hierarchical milestones. Initializing environment exploration tool calls.
                    </div>
                  </div>

                  {/* Tool Call Action */}
                  <div style={{ backgroundColor: '#0d1322', padding: 12, borderRadius: 6, borderLeft: '4px solid #10b981', fontFamily: 'monospace', fontSize: 12 }}>
                    <div style={{ color: '#10b981', fontWeight: 'bold', marginBottom: 4 }}>🔧 TOOL: read_file</div>
                    <div style={{ color: '#94a3b8' }}>args: &#123; filepath: "packages/core/package.json" &#125;</div>
                    <div style={{ color: '#64748b', marginTop: 4 }}>✓ Result: 200 OK (528 bytes read)</div>
                  </div>

                  {/* Tool Call 2 */}
                  <div style={{ backgroundColor: '#0d1322', padding: 12, borderRadius: 6, borderLeft: '4px solid #10b981', fontFamily: 'monospace', fontSize: 12 }}>
                    <div style={{ color: '#10b981', fontWeight: 'bold', marginBottom: 4 }}>🔧 TOOL: execute_command</div>
                    <div style={{ color: '#94a3b8' }}>args: &#123; command: "npm test -- packages/core/src/index.test.ts" &#125;</div>
                    <div style={{ color: '#34d399', marginTop: 4 }}>✓ 8/8 test suites passed in 82ms</div>
                  </div>
                </div>

                {/* Input box */}
                <div style={{ padding: 16, borderTop: '1px solid #1e293b', display: 'flex', gap: 10 }}>
                  <input
                    value={taskPrompt}
                    onChange={(e) => setTaskPrompt(e.target.value)}
                    style={{ flex: 1, backgroundColor: '#0b0f17', border: '1px solid #334155', borderRadius: 6, padding: '10px 14px', color: '#f8fafc', fontSize: 13 }}
                  />
                  <button style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0 20px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>
                    Send
                  </button>
                </div>
              </div>

              {/* Right Column: Hierarchical Milestones & Checkpoints */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ backgroundColor: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#f8fafc' }}>Hierarchical Milestone Plan</div>
                    <span style={{ fontSize: 11, backgroundColor: '#1e293b', color: '#10b981', padding: '3px 8px', borderRadius: 4 }}>
                      Phase 2 in progress
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {milestones.map((m, idx) => (
                      <div key={m.id} style={{ border: '1px solid #1e293b', borderRadius: 8, padding: 14, backgroundColor: '#131d35' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{ color: m.status === 'completed' ? '#10b981' : m.status === 'in_progress' ? '#38bdf8' : '#64748b', fontWeight: 'bold' }}>
                            {m.status === 'completed' ? '✓' : m.status === 'in_progress' ? '▶' : '○'}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{m.title}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginLeft: 24, marginBottom: 10 }}>{m.objective}</div>

                        <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {m.subtasks.map((sub, sIdx) => (
                            <div key={sIdx} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, color: sub.status === 'completed' ? '#cbd5e1' : '#94a3b8' }}>
                              <span style={{ color: sub.status === 'completed' ? '#10b981' : sub.status === 'in_progress' ? '#38bdf8' : '#475569' }}>
                                {sub.status === 'completed' ? '■' : '□'}
                              </span>
                              <span>{sub.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Snapshot Checkpoints */}
                <div style={{ backgroundColor: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', padding: 20 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#f8fafc', marginBottom: 12 }}>Deterministic Snapshots</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, backgroundColor: '#1e293b', padding: '8px 12px', borderRadius: 6 }}>
                      <span>snap_174128912_init</span>
                      <span style={{ color: '#94a3b8' }}>3 milestones saved</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, backgroundColor: '#1e293b', padding: '8px 12px', borderRadius: 6 }}>
                      <span>snap_174128945_phase1</span>
                      <span style={{ color: '#10b981' }}>Verified checkpoint</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PROVIDERS */}
          {activeTab === 'providers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ color: '#94a3b8', fontSize: 14 }}>
                  Connect, benchmark, and route completion requests across cloud inference providers and local offline models.
                </p>
                <button style={{ backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500 }}>
                  Test All Latencies
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
                {providers.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    style={{
                      backgroundColor: '#0f172a',
                      borderRadius: 10,
                      border: selectedProvider === p.id ? '2px solid #3b82f6' : '1px solid #1e293b',
                      padding: 20,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 'bold', fontSize: 16, color: '#f8fafc' }}>{p.name}</div>
                      <span style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        backgroundColor: p.status === 'active' ? '#1e3a8a' : '#1e293b',
                        color: p.status === 'active' ? '#60a5fa' : '#10b981',
                      }}>
                        {p.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{p.model}</div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #1e293b', fontSize: 12 }}>
                      <span style={{ color: '#64748b' }}>Avg Latency: <strong style={{ color: '#38bdf8' }}>{p.latency}</strong></span>
                      <span style={{ color: '#64748b' }}>Quota: <strong style={{ color: '#cbd5e1' }}>{p.quota}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: TRAJECTORIES */}
          {activeTab === 'trajectories' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ color: '#94a3b8', fontSize: 14 }}>
                  Trajectories logged with thought-action-observation tuples, verifier reward ratings, and DPO training export.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                    Export DPO Pairs (.jsonl)
                  </button>
                  <button style={{ backgroundColor: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                    Export Trajectories (.json)
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {trajectories.map((t) => (
                  <div key={t.id} style={{ backgroundColor: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontSize: 13, fontWeight: 'bold' }}>{t.id}</span>
                        <span style={{ fontWeight: 600, fontSize: 15, color: '#f8fafc' }}>{t.task}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <span style={{ backgroundColor: '#064e3b', color: '#34d399', fontSize: 12, padding: '3px 10px', borderRadius: 6, fontWeight: 'bold' }}>
                          Reward: {t.reward}
                        </span>
                        <span style={{ backgroundColor: '#1e293b', color: '#e2e8f0', fontSize: 12, padding: '3px 10px', borderRadius: 6 }}>
                          {t.steps} Steps
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Provider: {t.provider}</div>
                    <div style={{ backgroundColor: '#131e38', padding: '10px 14px', borderRadius: 6, fontSize: 12, color: '#cbd5e1' }}>
                      <strong>Verifier Critique:</strong> {t.critique}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: MEMORY */}
          {activeTab === 'memory' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div style={{ backgroundColor: '#0f172a', padding: 20, borderRadius: 10, border: '1px solid #1e293b' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: '#f8fafc' }}>Distilled Heuristics & Rules</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ backgroundColor: '#131e38', padding: 12, borderRadius: 6, fontSize: 13, borderLeft: '3px solid #38bdf8' }}>
                    <div style={{ fontWeight: 'bold', color: '#38bdf8', marginBottom: 2 }}>rule_verify_after_write</div>
                    <div style={{ color: '#cbd5e1' }}>Always verify written artifacts using read_file or test runs before marking step complete.</div>
                  </div>
                  <div style={{ backgroundColor: '#131e38', padding: 12, borderRadius: 6, fontSize: 13, borderLeft: '3px solid #38bdf8' }}>
                    <div style={{ fontWeight: 'bold', color: '#38bdf8', marginBottom: 2 }}>rule_monorepo_build</div>
                    <div style={{ color: '#cbd5e1' }}>Run workspace build targets via npm run build --workspace=&lt;pkg&gt; to generate declaration maps.</div>
                  </div>
                </div>
              </div>

              <div style={{ backgroundColor: '#0f172a', padding: 20, borderRadius: 10, border: '1px solid #1e293b' }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: '#f8fafc' }}>Active Working Scratchpad</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ backgroundColor: '#1e293b', padding: 12, borderRadius: 6, fontSize: 13 }}>
                    <span style={{ color: '#94a3b8' }}>current_task:</span> Audit auth middleware and generate tests
                  </div>
                  <div style={{ backgroundColor: '#1e293b', padding: 12, borderRadius: 6, fontSize: 13 }}>
                    <span style={{ color: '#94a3b8' }}>active_branch:</span> feat/dockyard-harness-v1-16762366950047183992
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: SETTINGS */}
          {activeTab === 'settings' && (
            <div style={{ backgroundColor: '#0f172a', padding: 24, borderRadius: 10, border: '1px solid #1e293b', maxWidth: 700 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#f8fafc' }}>Harness Runtime Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>Sandbox Root Directory</label>
                  <input readOnly value="/app" style={{ width: '100%', backgroundColor: '#0b0f17', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#f8fafc', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>Max Agent Reasoning Loops</label>
                  <input defaultValue="15" style={{ width: 120, backgroundColor: '#0b0f17', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#f8fafc', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>RL Trajectory Auto-Recording</label>
                  <input type="checkbox" defaultChecked /> <span style={{ fontSize: 13, color: '#cbd5e1' }}>Enabled (Logs rewards & DPO pairs automatically)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
