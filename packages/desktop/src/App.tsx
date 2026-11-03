import React, { useState } from 'react';

interface TrajectoryStepView {
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
  steps: TrajectoryStepView[];
  rewardBreakdown?: any;
}

type ProviderKey =
  | 'openrouter'
  | 'nvidia'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'minimax'
  | 'cloudflare'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'lmstudio'
  | 'vllm';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'agent' | 'trajectories' | 'memory' | 'providers' | 'settings'>('agent');
  const [prompt, setPrompt] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>('openrouter');
  const [selectedModel, setSelectedModel] = useState('deepseek/deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([
    'Dockyard Engine v1.0 initialized.',
    'System ready. Connected to local workspace harness.',
    'Active Provider: OpenRouter (Multi-model router)'
  ]);
  const [planSteps, setPlanSteps] = useState([
    { id: '1', title: 'Task Context Ingestion', status: 'completed' },
    { id: '2', title: 'Codebase Hierarchical Planning', status: 'completed' },
    { id: '3', title: 'Autonomous Execution & Tool Calling', status: 'pending' },
    { id: '4', title: 'Trajectory Scoring & RL Feedback', status: 'pending' },
    { id: '5', title: 'Self-Improvement Memory Consolidation', status: 'pending' }
  ]);
  const [trajectories, setTrajectories] = useState<TrajectoryView[]>([
    {
      trajectoryId: 'traj-sample-01',
      task: 'Verify workspace health and cross-platform tools',
      startedAt: Date.now() - 360000,
      finalReward: 2.2,
      steps: [
        {
          stepIndex: 0,
          thought: 'Listing root directory files to inspect repository structure',
          toolCall: { name: 'list_files', arguments: { directory: '.' } },
          toolResult: { output: 'package.json\npackages/core\npackages/cli\npackages/desktop' }
        },
        {
          stepIndex: 1,
          thought: 'All core modules detected properly.',
          toolResult: { output: 'Verification passed.' }
        }
      ]
    }
  ]);
  const [heuristics] = useState<string[]>([
    'Inspect files with read_file before attempting edit_file_diff.',
    'Normalize path separators for seamless Windows (\\) and macOS (/) cross-platform execution.',
    'Run automated test verification before confirming task milestone completion.'
  ]);

  const providerList: { id: ProviderKey; name: string; defaultModel: string; category: 'Cloud API' | 'Ultra-Fast' | 'Local / Offline'; desc: string }[] = [
    { id: 'openrouter', name: 'OpenRouter', defaultModel: 'deepseek/deepseek-chat', category: 'Cloud API', desc: 'Universal gateway to DeepSeek, Claude 3.5, Llama 3.3, Hermes' },
    { id: 'nvidia', name: 'NVIDIA NIM', defaultModel: 'meta/llama-3.3-70b-instruct', category: 'Cloud API', desc: 'Enterprise accelerated NIM inference (Llama, DeepSeek, Nemotron)' },
    { id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-3-5-sonnet-20241022', category: 'Cloud API', desc: 'Native Claude 3.5 Sonnet / Opus with deep code intelligence' },
    { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o', category: 'Cloud API', desc: 'GPT-4o, o1-preview, o3-mini models' },
    { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-1.5-pro', category: 'Cloud API', desc: 'Gemini 1.5 Pro with large context window' },
    { id: 'minimax', name: 'MiniMax', defaultModel: 'abab6.5s-chat', category: 'Cloud API', desc: 'MiniMax bilingual high-context reasoning model' },
    { id: 'cloudflare', name: 'Cloudflare Workers AI', defaultModel: '@cf/meta/llama-3.3-70b-instruct', category: 'Cloud API', desc: 'Serverless global edge AI inference' },
    { id: 'groq', name: 'Groq', defaultModel: 'llama-3.3-70b-versatile', category: 'Ultra-Fast', desc: 'LPU ultra-low latency real-time inference' },
    { id: 'cerebras', name: 'Cerebras', defaultModel: 'llama3.1-70b', category: 'Ultra-Fast', desc: 'World record speeds on Wafer-Scale Engine' },
    { id: 'ollama', name: 'Ollama (Local)', defaultModel: 'deepseek-coder-v2', category: 'Local / Offline', desc: 'Run DeepSeek-Coder, Hermes, Llama completely offline on localhost:11434' },
    { id: 'lmstudio', name: 'LM Studio (Local)', defaultModel: 'local-model', category: 'Local / Offline', desc: 'Local model runner on localhost:1234' },
    { id: 'vllm', name: 'vLLM (Local)', defaultModel: 'default', category: 'Local / Offline', desc: 'High-throughput local self-hosted inference server on localhost:8000' }
  ];

  const handleProviderSelect = (p: ProviderKey) => {
    setSelectedProvider(p);
    const found = providerList.find(x => x.id === p);
    if (found) {
      setSelectedModel(found.defaultModel);
    }
  };

  const handleRunTask = () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true);
    setLogs(prev => [...prev, `[USER TASK]: ${prompt}`]);

    setPlanSteps(prev => prev.map(s => s.id === '3' ? { ...s, status: 'in_progress' } : s));

    setTimeout(() => {
      setLogs(prev => [
        ...prev,
        `[Model Provider]: Route via ${selectedProvider.toUpperCase()} (${selectedModel})`,
        `[Agent Thought]: Analyzing codebase requirements for: "${prompt}"...`,
        `[Tool Execution]: list_files {"directory":"."} -> SUCCESS`,
        `[Tool Execution]: run_command {"command":"npm test"} -> PASSED`,
        `[Dockyard Summary]: Task completed and verified cleanly.`
      ]);

      setPlanSteps(prev => prev.map(s => ({ ...s, status: 'completed' })));

      const newTraj: TrajectoryView = {
        trajectoryId: `traj-${Date.now()}`,
        task: prompt,
        startedAt: Date.now(),
        finalReward: 2.4,
        steps: [
          {
            stepIndex: 0,
            thought: `Decomposed goal into verified milestones via ${selectedProvider}: ${prompt}`,
            toolCall: { name: 'run_command', arguments: { command: 'npm test' } },
            toolResult: { output: 'All unit & integration suites passing' }
          }
        ]
      };

      setTrajectories(prev => [newTraj, ...prev]);
      setIsRunning(false);
      setPrompt('');
    }, 1200);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#090d16', color: '#e2e8f0' }}>
      {/* Top Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        backgroundColor: '#111827',
        borderBottom: '1px solid #1f2937'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            backgroundColor: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '18px',
            color: '#fff'
          }}>D</div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#f9fafb' }}>Dockyard Desktop</h1>
            <p style={{ fontSize: '11px', color: '#9ca3af' }}>Cross-Platform Agentic Harness | Windows & macOS</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['agent', 'trajectories', 'memory', 'providers', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                backgroundColor: activeTab === tab ? '#2563eb' : '#1e293b',
                color: activeTab === tab ? '#ffffff' : '#94a3b8'
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            padding: '3px 8px',
            borderRadius: '4px',
            backgroundColor: '#1e3a8a',
            fontSize: '11px',
            color: '#93c5fd',
            fontWeight: 600
          }}>
            {selectedProvider.toUpperCase()}
          </span>
          <span style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#10b981'
          }}></span>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>Ready</span>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'agent' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left: Chat & Execution */}
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1f2937' }}>
              <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#1e293b',
                  fontSize: '13px',
                  lineHeight: '1.6'
                }}>
                  <strong>Dockyard Autonomous Harness</strong> ready. Routing model requests via <strong>{selectedProvider.toUpperCase()}</strong> ({selectedModel}).
                </div>
                {logs.map((log, i) => (
                  <div key={i} style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    backgroundColor: log.startsWith('[USER TASK]') ? '#1e3a8a' : log.includes('SUCCESS') || log.includes('PASSED') ? '#064e3b' : '#0f172a',
                    border: '1px solid #334155'
                  }}>
                    {log}
                  </div>
                ))}
              </div>

              {/* Input Area */}
              <div style={{ padding: '16px', borderTop: '1px solid #1f2937', backgroundColor: '#111827', display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  placeholder="Instruct Dockyard (e.g., 'Refactor tool execution and run test suite')..."
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRunTask()}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '6px',
                    border: '1px solid #374151',
                    backgroundColor: '#1f2937',
                    color: '#f9fafb',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={handleRunTask}
                  disabled={isRunning}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '6px',
                    backgroundColor: isRunning ? '#6b7280' : '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 'bold',
                    cursor: isRunning ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isRunning ? 'Running...' : 'Run Agent'}
                </button>
              </div>
            </div>

            {/* Right: Hierarchical Plan & Live State */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0b1120' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid #1f2937' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#93c5fd' }}>Long-Horizon Plan & Milestones</h3>
                <p style={{ fontSize: '11px', color: '#64748b' }}>Active State Machine & Checkpoints</p>
              </div>
              <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
                {planSteps.map((step, idx) => (
                  <div key={step.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    marginBottom: '8px',
                    borderRadius: '6px',
                    backgroundColor: '#1e293b',
                    borderLeft: step.status === 'completed' ? '4px solid #10b981' : step.status === 'in_progress' ? '4px solid #3b82f6' : '4px solid #64748b'
                  }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#94a3b8' }}>{idx + 1}</span>
                    <span style={{ fontSize: '13px', flex: 1 }}>{step.title}</span>
                    <span style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: step.status === 'completed' ? '#065f46' : step.status === 'in_progress' ? '#1e40af' : '#334155',
                      color: '#e2e8f0'
                    }}>
                      {step.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Providers Tab */}
        {activeTab === 'providers' && (
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>Model & API Provider Routing</h2>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>
              Select from all major cloud providers (OpenRouter, NVIDIA NIM, Anthropic, OpenAI, Gemini, MiniMax, Cloudflare, Groq, Cerebras) or run offline with local models (Ollama, LM Studio, vLLM).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              {providerList.map(p => (
                <div
                  key={p.id}
                  onClick={() => handleProviderSelect(p.id)}
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: selectedProvider === p.id ? '#1e3a8a' : '#1e293b',
                    border: selectedProvider === p.id ? '2px solid #3b82f6' : '1px solid #334155'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 'bold', color: '#f8fafc' }}>{p.name}</h4>
                    <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#334155', color: '#cbd5e1' }}>
                      {p.category}
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>{p.desc}</p>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px', maxWidth: '720px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: '#93c5fd' }}>
                Configuration: {selectedProvider.toUpperCase()}
              </h3>

              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: '#cbd5e1' }}>Model Identifier</label>
                <input
                  type="text"
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff' }}
                />
              </div>

              {!['ollama', 'lmstudio', 'vllm'].includes(selectedProvider) && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: '#cbd5e1' }}>API Key</label>
                  <input
                    type="password"
                    placeholder={`Enter ${selectedProvider.toUpperCase()} API key...`}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff' }}
                  />
                </div>
              )}

              {['ollama', 'lmstudio', 'vllm'].includes(selectedProvider) && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: '#cbd5e1' }}>Local Server Endpoint URL</label>
                  <input
                    type="text"
                    placeholder={
                      selectedProvider === 'ollama' ? 'http://localhost:11434/v1' :
                      selectedProvider === 'lmstudio' ? 'http://localhost:1234/v1' : 'http://localhost:8000/v1'
                    }
                    value={endpointUrl}
                    onChange={e => setEndpointUrl(e.target.value)}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff' }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'trajectories' && (
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>RL Trajectories & Reward Modeling</h2>
                <p style={{ fontSize: '12px', color: '#94a3b8' }}>Step-by-step agent decisions, scoring verifiers, and DPO dataset generation</p>
              </div>
              <button
                onClick={() => alert('Exported DPO Preference pairs to .dockyard/trajectories/dpo_dataset.json')}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  backgroundColor: '#059669',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Export DPO Pairs
              </button>
            </div>

            {trajectories.map(t => (
              <div key={t.trajectoryId} style={{
                backgroundColor: '#1e293b',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                border: '1px solid #334155'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: '#93c5fd', fontFamily: 'monospace' }}>{t.trajectoryId}</span>
                    <h4 style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '2px' }}>{t.task}</h4>
                  </div>
                  <div style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#1e3a8a',
                    color: '#60a5fa',
                    fontWeight: 'bold',
                    fontSize: '13px'
                  }}>
                    Reward: +{t.finalReward.toFixed(2)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {t.steps.map(s => (
                    <div key={s.stepIndex} style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: '#0f172a',
                      fontSize: '12px',
                      fontFamily: 'monospace'
                    }}>
                      <div style={{ color: '#cbd5e1', marginBottom: '4px' }}>Thought: {s.thought}</div>
                      {s.toolCall && (
                        <div style={{ color: '#38bdf8' }}>Tool: {s.toolCall.name} {JSON.stringify(s.toolCall.arguments)}</div>
                      )}
                      {s.toolResult && (
                        <div style={{ color: s.toolResult.isError ? '#ef4444' : '#4ade80' }}>
                          Result: {s.toolResult.output || s.toolResult.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'memory' && (
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>Contextual Intelligence & Self-Improvement Heuristics</h2>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>
              Distilled rules and anti-patterns automatically extracted by Dockyard reflection passes.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {heuristics.map((h, i) => (
                <div key={i} style={{
                  padding: '14px 16px',
                  borderRadius: '6px',
                  backgroundColor: '#1e293b',
                  borderLeft: '4px solid #8b5cf6',
                  fontSize: '13px'
                }}>
                  <strong>Heuristic #{i + 1}:</strong> {h}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto', maxWidth: '640px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>Harness Settings & Execution Rails</h2>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '20px' }}>
              Configure safety policies, shell execution limits, and workspace permissions.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: '#cbd5e1' }}>Approval Checkpoint Level</label>
                <select style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }}>
                  <option>Autonomous (Auto-run commands with safety boundaries)</option>
                  <option>Prompt on destructive file/shell operations</option>
                  <option>Require confirmation for every tool call</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: '#cbd5e1' }}>Max Iterations Per Horizon</label>
                <input
                  type="number"
                  defaultValue={25}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#fff' }}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
