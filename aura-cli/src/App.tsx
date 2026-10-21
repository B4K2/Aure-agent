// Claude Code–style terminal: scrolling transcript (incidents pushed live + chat), a live approval
// card for the incident awaiting a decision, a status line, and a prompt with slash commands.
import { Box, Static, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { Backend, type AuraEvent } from './backend.js';
import { Markdown } from './Markdown.js';
import { StatePanel } from './StatePanel.js';
import { suggestions } from './suggest.js';

type Item = { id: number; node: ReactElement };
type Incident = Record<string, any>;

const HELP = `/approve [id]   run the proposed action (dry-run shown first)
/investigate    let Aura dig in and propose a concrete fix
/reject [id] <why>  reject with your reason (Aura learns from it)
/focus <id>     chat about a specific incident (default: latest)
/state          live graphs of site health (toggle)
/incidents      list incidents        /show [id]   full RCA
/trail [id]     audit trail           /clear       clear screen
/web            dashboard link (signs the browser in)
/help           this help             /quit        exit (Ctrl-C)
Anything else is sent to Aura as chat.`;

const INVESTIGATE = 'Investigate this incident with your tools (current signals, read-only DB queries such as ' +
  'pg_stat_activity grouped by application_name, logs, recent diffs). Find the concrete cause, then call ' +
  'propose_execution with an executable fix and tell me why.';

const time = (at?: string) => (at ? new Date(at) : new Date()).toLocaleTimeString([], { hour12: false });
const pct = (n?: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);
const fmt = (n: number | null | undefined, d = 1) => (n == null ? '–' : n.toFixed(d));

function Rca({ inc }: { inc: Incident }) {
  const rca = inc.rca || {};
  const action = rca.proposed_action || {};
  return (
    <Box flexDirection="column">
      <Text><Text bold>Hypothesis: </Text>{rca.hypothesis}</Text>
      <Text>
        <Text bold>Confidence: </Text>
        <Text color={rca.low_confidence ? 'yellow' : 'green'}>{pct(rca.calibrated_confidence)}</Text>
        <Text dimColor> ({(rca.confidence_adjustments || []).join(', ')})</Text>
      </Text>
      {(rca.evidence || []).map((e: any, i: number) => <Text key={i} dimColor>  • [{e.source}] {e.detail}</Text>)}
      <Text><Text bold>Proposed: </Text><Text color="cyan">{action.type}</Text> → {action.target}</Text>
      {inc.dry_run ? <Box borderStyle="single" borderColor="gray" paddingX={1}><Text dimColor>{inc.dry_run}</Text></Box> : null}
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('connecting…');
  const [beat, setBeat] = useState<AuraEvent | null>(null);
  const [beats, setBeats] = useState<AuraEvent[]>([]); // heartbeat history for /state
  const [showState, setShowState] = useState(false);
  const [watching, setWatching] = useState<string>();
  const [incidents, setIncidents] = useState<Record<string, Incident>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // spinner label
  const [running, setRunning] = useState<Record<string, string>>({}); // incident → current stage
  const [sel, setSel] = useState(0); // highlighted suggestion
  const [inputKey, setInputKey] = useState(0); // remount TextInput to move the cursor to the end after Tab
  const seq = useRef(0);

  const push = (node: ReactElement) => setItems((xs) => [...xs, { id: seq.current++, node }]);
  const upsert = (inc: Incident) => setIncidents((m) => ({ ...m, [inc.incident_id]: { ...m[inc.incident_id], ...inc } }));

  const backend = useMemo(() => new Backend((e) => onEvent(e), setStatus), []);
  useEffect(() => { backend.start(); return () => backend.stop(); }, []);

  function onEvent(e: AuraEvent) {
    const t = <Text dimColor>{time(e.at)} </Text>;
    switch (e.type) {
      case 'hello':
        push(<Text color="gray">connected · watching {e.watching} · {e.incidents.length} incident(s) in memory · /help</Text>);
        e.incidents.forEach(upsert);
        setBeats(e.history || []);
        setWatching(e.watching);
        break;
      case 'heartbeat':
        setBeat(e);
        setBeats((bs) => [...bs.slice(-179), e]);
        break;
      case 'incident_opened':
        upsert({ incident_id: e.incident_id, status: 'collecting' });
        setFocus(e.incident_id);
        setRunning((r) => ({ ...r, [e.incident_id]: 'grouping signals' }));
        push(<Text>{t}<Text color="red" bold>● INCIDENT {e.incident_id}</Text> opened</Text>);
        process.stdout.write('\x07'); // terminal bell
        break;
      case 'anomaly': {
        const a = e.anomaly;
        push(<Text>{t}<Text color="red">  ▲ </Text><Text color="yellow">[{a.signal_type}]</Text> {a.raw_excerpt.split('\n')[0]}{e.late ? <Text dimColor> (late)</Text> : null}</Text>);
        break;
      }
      case 'stage':
        setRunning((r) => ({ ...r, [e.incident_id]: e.stage }));
        push(<Text>{t}<Text color="magenta">  ⎿ {e.stage}</Text> <Text dimColor>{e.detail}</Text></Text>);
        break;
      case 'awaiting_approval':
        upsert({ ...e.incident, status: 'awaiting_approval' });
        setRunning((r) => { const { [e.incident.incident_id]: _, ...rest } = r; return rest; });
        push(<Box flexDirection="column" borderStyle="round" borderColor={e.incident.rca?.low_confidence ? 'yellow' : 'cyan'} paddingX={1}>
          <Text bold>{e.incident.incident_id} · needs your decision{e.incident.rca?.low_confidence ? ' · LOW CONFIDENCE' : ''}</Text>
          <Rca inc={e.incident} />
          <Text dimColor>{['investigate_further', 'scale'].includes(e.incident.rca?.proposed_action?.type) ? '/investigate' : '/approve'} · /reject · or ask a question</Text>
        </Box>);
        process.stdout.write('\x07');
        break;
      case 'action_changed':
        upsert(e.incident);
        push(<Box flexDirection="column" paddingLeft={2}><Text color="cyan">proposed action updated for {e.incident.incident_id}:</Text><Rca inc={e.incident} /></Box>);
        break;
      case 'closed': {
        const inc = e.incident;
        upsert(inc);
        setRunning((r) => { const { [inc.incident_id]: _, ...rest } = r; return rest; });
        const res = inc.execution_result;
        const color = inc.status === 'resolved' ? 'green' : inc.status === 'rejected' ? 'gray' : 'yellow';
        push(<Box flexDirection="column">
          <Text>{t}<Text color={color} bold>■ {inc.incident_id} {inc.status.toUpperCase()}</Text>{res ? ` — ${res.message}` : ` — hypothesis rejected${inc.human_note ? ` ("${inc.human_note}")` : ''}, stored as negative memory`}</Text>
          {(res?.logs || []).slice(-4).map((l: string, i: number) => <Text key={i} dimColor>    {l.split('\n')[0]}</Text>)}
        </Box>);
        break;
      }
      case 'thinking':
        setBusy('Aura is thinking');
        break;
      case 'tool':
        setBusy(`${e.name}(${Object.values(e.args || {}).join(', ').slice(0, 60)})`);
        push(<Text color="gray">  ⏺ {e.name}<Text dimColor>({JSON.stringify(e.args).slice(1, -1).slice(0, 100)})</Text></Text>);
        break;
      case 'answer':
        setBusy(null);
        push(<Box marginBottom={1}><Text color="cyan">⏺ </Text><Markdown text={e.text} /></Box>);
        break;
      case 'incident':
        if (e.incident) { upsert(e.incident); push(<Box flexDirection="column" paddingLeft={2}><Text bold>{e.incident.incident_id} · {e.incident.status}</Text>{e.incident.rca ? <Rca inc={e.incident} /> : <Text dimColor>no RCA yet</Text>}{(e.incident.audit_trail || []).map((a: any, i: number) => <Text key={i} dimColor>  {time(a.timestamp)} {a.node}: {a.output_summary}</Text>)}</Box>); }
        else push(<Text color="red">no such incident</Text>);
        break;
      case 'system':
        push(<Text color="gray">{e.text}</Text>);
        break;
      case 'error':
        setBusy(null);
        push(<Text color="red">✗ {e.message}</Text>);
        break;
    }
  }

  const pending = Object.values(incidents).filter((i) => i.status === 'awaiting_approval');
  const target = (arg?: string) => arg || focus || pending[pending.length - 1]?.incident_id;

  const sugg = suggestions(input, incidents, focus);
  const selIdx = Math.min(sel, Math.max(0, sugg.length - 1));

  function change(v: string) { setInput(v); setSel(0); }

  function complete() {
    const s = sugg[selIdx];
    if (!s) return;
    setInput(s.value); setSel(0); setInputKey((k) => k + 1);
  }

  function submit(line: string) {
    // Enter on a partial command runs the highlighted suggestion (e.g. "/ap" → "/approve INC-…").
    const pick = sugg[selIdx];
    if (pick && line.trim() !== pick.value.trim() && !pick.value.endsWith(' ')) line = pick.value;
    else if (pick && pick.value.endsWith(' ') && line.trim() === pick.value.trim()) { complete(); return; }
    setSel(0);
    const text = line.trim();
    setInput('');
    if (!text) return;
    push(<Text><Text color="gray">{'> '}</Text>{text}</Text>);
    if (!text.startsWith('/')) { backend.send({ type: 'chat', text, incident_id: target() }); setBusy('Aura is thinking'); return; }
    const [cmd, ...words] = text.slice(1).split(/\s+/);
    let arg: string | undefined = words[0];
    if (cmd === 'reject' && arg && !incidents[arg]) arg = undefined;  // first word is the reason, not an id
    const note = words.slice(arg ? 1 : 0).join(' ').trim();
    const id = target(arg);
    switch (cmd) {
      case 'approve': case 'reject':
        if (!id) return push(<Text color="yellow">no incident awaiting a decision</Text>);
        if (cmd === 'reject' && !note) return push(<Text color="yellow">usage: /reject [id] &lt;why it's wrong&gt; — Aura stores your reason</Text>);
        backend.send({ type: 'decide', incident_id: id, decision: cmd === 'approve' ? 'approved' : 'rejected', note });
        break;
      case 'focus':
        if (!arg) return push(<Text color="yellow">usage: /focus &lt;incident id&gt;</Text>);
        setFocus(arg); push(<Text color="gray">focus: {arg}</Text>);
        break;
      case 'incidents': case 'status': {
        const list = Object.values(incidents);
        push(<Box flexDirection="column">{list.length ? list.map((i) => <Text key={i.incident_id}>{i.incident_id}  <Text color={i.status === 'resolved' ? 'green' : 'yellow'}>{i.status}</Text>  {i.rca?.hypothesis || i.hypothesis || ''}</Text>) : <Text dimColor>no incidents</Text>}</Box>);
        break;
      }
      case 'show': case 'trail':
        if (!id) return push(<Text color="yellow">no incident</Text>);
        backend.send({ type: 'get', incident_id: id });
        break;
      case 'clear': setItems([]); process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); break;
      case 'state': setShowState((v) => !v); break;
      case 'investigate':
        if (!id) return push(<Text color="yellow">no incident to investigate</Text>);
        setFocus(id);
        backend.send({ type: 'chat', incident_id: id, text: INVESTIGATE });
        setBusy('Aura is investigating');
        break;
      case 'web':
        if (!backend.token()) return push(<Text color="yellow">no token yet: start the agent once (it generates one), or set AURA_API_TOKEN</Text>);
        push(<Box flexDirection="column"><Text>open the dashboard (signs this browser in):</Text><Text color="cyan">{backend.webLink()}</Text><Text dimColor>this link is a credential: don't share it</Text></Box>);
        break;
      case 'help': push(<Text dimColor>{HELP}</Text>); break;
      case 'quit': case 'exit': exit(); break;
      default: push(<Text color="yellow">unknown command /{cmd} — /help</Text>);
    }
  }

  useInput((_, key) => {
    if (key.escape) { if (!input && showState) setShowState(false); change(''); }
    else if (sugg.length && key.upArrow) setSel((i) => (Math.min(i, sugg.length - 1) - 1 + sugg.length) % sugg.length);
    else if (sugg.length && key.downArrow) setSel((i) => (Math.min(i, sugg.length - 1) + 1) % sugg.length);
    else if (sugg.length && key.tab) complete();
  });

  const h = beat?.health;
  const up = h?.up;
  return (
    <Box flexDirection="column">
      <Static items={[{ id: -1, node: <Banner /> }, ...items]}>{(it) => <Box key={it.id}>{it.node}</Box>}</Static>

      {showState ? <StatePanel beats={beats} url={watching} /> : null}

      {Object.entries(running).map(([iid, stage]) => (
        <Text key={iid} color="magenta"><Spinner type="dots" /> {iid}: {stage}…</Text>
      ))}
      {busy ? <Text color="cyan"><Spinner type="dots" /> {busy}…</Text> : null}

      <Box borderStyle="round" borderColor={pending.length ? 'yellow' : 'gray'} paddingX={1}>
        <Text color="gray">{'> '}</Text>
        <TextInput key={inputKey} value={input} onChange={change} onSubmit={submit}
          placeholder={pending.length ? `${pending.length} incident(s) need a decision — type / for actions` : 'ask Aura anything · / for commands'} />
      </Box>
      {sugg.length ? (
        <Box flexDirection="column" paddingX={2}>
          {sugg.map((s, i) => (
            <Text key={s.value}>
              <Text color={i === selIdx ? 'cyan' : s.tone === 'action' ? 'green' : s.tone === 'danger' ? 'red' : undefined} bold={i === selIdx}>
                {i === selIdx ? '❯ ' : '  '}{s.label.padEnd(30)}
              </Text>
              <Text dimColor>{s.hint}</Text>
            </Text>
          ))}
          <Text dimColor>  ↑↓ select · Tab complete · Enter run · Esc clear</Text>
        </Box>
      ) : null}
      <Box justifyContent="space-between" paddingX={1}>
        <Text>
          <Text color={up ? 'green' : beat ? 'red' : 'gray'}>● site {beat ? (up ? 'up' : `DOWN (${h?.status})`) : '…'}</Text>
          <Text dimColor>  rps {fmt(beat?.rps)}  p95 {beat?.p95 != null ? `${fmt(beat.p95 * 1000, 0)}ms` : '–'}  5xx {pct(beat?.err)}  rss {fmt(beat?.rss_mb, 0)}MB  db {beat?.db?.up ? `${beat.db.sessions} conns` : 'down'}</Text>
        </Text>
        <Text dimColor>{focus ? `focus ${focus} · ` : ''}{status}</Text>
      </Box>
    </Box>
  );
}

function Banner() {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text><Text color="cyan" bold>✻ Aura</Text> <Text dimColor>agentic SRE · watching VOID · nothing destructive runs without your /approve</Text></Text>
    </Box>
  );
}
