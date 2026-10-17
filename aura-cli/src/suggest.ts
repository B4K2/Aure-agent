// Slash-command suggestions, ranked by what Aura is waiting on right now.
type Incident = Record<string, any>;
export type Suggestion = { value: string; label: string; hint: string; tone?: 'action' | 'danger' };

const BASE: Omit<Suggestion, 'label'>[] = [
  { value: '/state', hint: 'live graphs: traffic, latency, errors, memory, db' },
  { value: '/incidents', hint: 'list incidents' },
  { value: '/show', hint: 'full RCA of the focused incident' },
  { value: '/trail', hint: 'audit trail: what Aura did and why' },
  { value: '/focus ', hint: 'chat about a specific incident' },
  { value: '/clear', hint: 'clear the screen' },
  { value: '/help', hint: 'all commands' },
  { value: '/quit', hint: 'exit' },
];

export const ADVISORY = new Set(['investigate_further', 'scale']);
const describe = (a?: Record<string, any>) => (a ? `${a.type} → ${a.target}` : 'proposed action');

export function suggestions(input: string, incidents: Record<string, Incident>, focus: string | null): Suggestion[] {
  if (!input.startsWith('/')) return [];
  const all = Object.values(incidents).sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)));
  const [cmd, ...rest] = input.slice(1).split(' ');

  // Argument completion: incident ids.
  if (rest.length && ['focus', 'show', 'trail', 'approve', 'reject', 'investigate'].includes(cmd)) {
    const pool = ['approve', 'reject', 'investigate'].includes(cmd) ? all.filter((i) => i.status === 'awaiting_approval') : all;
    return pool.filter((i) => i.incident_id.toLowerCase().startsWith(rest.join(' ').toLowerCase())).slice(0, 6)
      .map((i) => ({ value: `/${cmd} ${i.incident_id}`, label: i.incident_id, hint: `${i.status} · ${i.rca?.hypothesis || i.hypothesis || ''}` }));
  }

  const out: Suggestion[] = [];
  // What Aura is asking for comes first: one approve/reject pair per pending incident.
  for (const inc of all.filter((i) => i.status === 'awaiting_approval')) {
    const action = inc.rca?.proposed_action || inc.action;
    const conf = inc.rca?.calibrated_confidence ?? inc.confidence;
    const low = inc.rca?.low_confidence;
    const id = inc.incident_id;
    if (ADVISORY.has(action?.type)) {
      // Nothing to run yet: the useful next step is letting Aura dig in and propose a concrete fix.
      out.push({ value: `/investigate ${id}`, label: `/investigate ${id}`, tone: 'action',
        hint: 'Aura checks DB, logs and diffs, then proposes a real fix' });
    } else {
      out.push({ value: `/approve ${id}`, label: `/approve ${id}`, tone: 'action',
        hint: `run ${describe(action)}${conf != null ? ` (${Math.round(conf * 100)}%${low ? ', low confidence' : ''})` : ''}` });
    }
    out.push({ value: `/reject ${id}`, label: `/reject ${id}`, tone: 'danger', hint: 'wrong diagnosis; Aura remembers it' });
  }
  for (const b of BASE) {
    let hint = b.hint;
    if ((b.value === '/show' || b.value === '/trail') && focus) hint += ` (${focus})`;
    out.push({ ...b, label: b.value.trim(), hint });
  }
  const q = cmd.toLowerCase();
  return out.filter((s) => s.value.slice(1).toLowerCase().startsWith(q)).slice(0, 7);
}
