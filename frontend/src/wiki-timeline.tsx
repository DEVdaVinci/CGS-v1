import { useEffect, useState } from 'react'
import { isWikiActor, type WikiEntry, type WikiEvent, type WikiField, type WikiValue } from './wiki-api'
import { formatDistribution } from './wiki-distribution'
import { type ArticleEdit } from './wiki-forms'

export type TimelineEdit =
  | { kind: 'new-group'; parentId?: string }
  | { kind: 'new-event'; parentId?: string; action?: boolean }
  | { kind: 'organize'; event: WikiEvent }

type TimelineProps = {
  events: WikiEvent[]; entries: WikiEntry[]; fields: WikiField[]; currentEvent?: string
  onOpen?: (id: string, at: number) => void
  onFocus: (id: string) => void
  onEdit?: (edit: ArticleEdit | TimelineEdit) => void
}

const linkLabels = {
  participant: 'Participants', place: 'Places', item: 'Items', purpose: 'Purpose goals',
  backstory: 'Backstory of', era: 'Eras',
} as const

function ancestors(event: WikiEvent, index: Map<string, WikiEvent>) {
  const path: WikiEvent[] = []
  const seen = new Set([event.id])
  let parent = event.parent_id
  while (parent && !seen.has(parent)) {
    const node = index.get(parent)
    if (!node) break
    path.unshift(node)
    seen.add(parent)
    parent = node.parent_id
  }
  return path
}

function dateLabel(event: WikiEvent) {
  if (event.display_start === null) return 'Unscheduled'
  const { display_start: start, display_end: end } = event
  return start === end ? 'Time ' + start : 'Time ' + start + ' to ' + end
}

export function WikiTimeline({ events, entries, fields, currentEvent, onOpen, onFocus, onEdit }: TimelineProps) {
  const [mode, setMode] = useState<'outline' | 'chronology' | null>(null)
  const [expanded, setExpanded] = useState(new Set<string>())
  const [person, setPerson] = useState('')
  const [place, setPlace] = useState('')
  const [era, setEra] = useState('')
  const [date, setDate] = useState('')
  const displayMode = mode ?? (events.some((event) => event.node_kind === 'group') ? 'outline' : 'chronology')
  const index = new Map(events.map((event) => [event.id, event]))
  const directory = new Map(entries.map((entry) => [entry.id, entry]))
  const definitions = new Map(fields.map((field) => [field.key, field]))
  const selected = currentEvent ? index.get(currentEvent) : undefined
  const activePath = selected ? new Set(ancestors(selected, index).map((group) => group.id)) : new Set<string>()
  const filtered = Boolean(person || place || era || date !== '')
  const matches = events.filter((event) => {
    if (person && event.ability_use?.actor_id !== person && !event.links.some((link) => link.role === 'participant' && link.entry_id === person)) return false
    if (place && !event.links.some((link) => link.role === 'place' && link.entry_id === place)) return false
    if (era && !event.links.some((link) => link.role === 'era' && link.entry_id === era)) return false
    return date === '' || (event.display_start !== null && event.display_end !== null
      && event.display_start <= Number(date) && event.display_end >= Number(date))
  })
  const show = new Set(matches.map((event) => event.id))
  if (filtered) {
    for (const event of matches) for (const parent of ancestors(event, index)) show.add(parent.id)
  }

  const children = new Map<string | null, WikiEvent[]>()
  for (const event of events) {
    if (!show.has(event.id)) continue
    const siblings = children.get(event.parent_id) ?? []
    siblings.push(event)
    children.set(event.parent_id, siblings)
  }
  for (const group of children.values()) group.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  const visibleRows: { event: WikiEvent; depth: number }[] = []
  if (displayMode === 'outline') {
    const pending = (children.get(null) ?? []).map((event) => ({ event, depth: 0 })).reverse()
    while (pending.length) {
      const row = pending.pop()!
      visibleRows.push(row)
      if (filtered || expanded.has(row.event.id) || activePath.has(row.event.id)) {
        const descendants = children.get(row.event.id) ?? []
        for (let index = descendants.length - 1; index >= 0; index--) {
          pending.push({ event: descendants[index], depth: row.depth + 1 })
        }
      }
    }
  }
  const byTime = new Map<number, WikiEvent[]>()
  for (const event of matches) {
    if (event.tick === null) continue
    const group = byTime.get(event.tick) ?? []
    group.push(event)
    byTime.set(event.tick, group)
  }

  useEffect(() => {
    if (currentEvent) document.getElementById('wiki-event-' + currentEvent)?.scrollIntoView({ block: 'nearest' })
  }, [currentEvent, displayMode])

  function linked(id: string, at: number) {
    const entry = directory.get(id)
    return onOpen && entry ? (
      <button type="button" className="wiki-reference" onClick={() => onOpen(id, at)}>{entry.name}</button>
    ) : <span>{entry?.name ?? 'Unavailable entry'}</span>
  }

  function displayValue(field: string, value: WikiValue | null, at: number) {
    if (value === null) return 'No recorded value'
    const definition = definitions.get(field)
    if (definition?.value_kind === 'distribution') return formatDistribution(value)
    return definition?.target_kinds.length && typeof value === 'string' ? linked(value, at) : value
  }

  function focus(id: string) {
    setPerson('')
    setPlace('')
    setEra('')
    setDate('')
    if (index.get(id)?.node_kind === 'group') setMode('outline')
    onFocus(id)
  }

  function toggle(group: WikiEvent) {
    if (activePath.has(group.id)) onFocus(group.id)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(group.id) || activePath.has(group.id)) next.delete(group.id)
      else next.add(group.id)
      return next
    })
  }

  function card(event: WikiEvent, depth = 0) {
    const time = event.tick ?? event.display_start ?? 0
    const group = event.node_kind === 'group'
    const open = filtered || expanded.has(event.id) || activePath.has(event.id)
    const path = ancestors(event, index)
    return (
      <article key={event.id} className="wiki-timeline-card" id={'wiki-event-' + event.id}
        aria-label={event.name} data-selected={currentEvent === event.id || undefined}
        style={depth ? { marginInlineStart: 'min(' + depth * 0.9 + 'rem, 18%)' } : undefined}>
        <header className="wiki-card-heading">
          <div>
            <h4><button className="wiki-reference" type="button" onClick={() => focus(event.id)}>{event.name}</button></h4>
            {displayMode === 'outline' && <small className="muted">{dateLabel(event)} · {group ? 'Event group' : event.node_kind === 'action' ? 'Recorded action' : 'Occurrence'}</small>}
          </div>
          <div className="form-actions">
            {group && !filtered && (children.get(event.id)?.length ?? 0) > 0 && <button type="button" className="button secondary"
              aria-expanded={open} onClick={() => toggle(event)}>{open ? 'Collapse' : 'Expand'}</button>}
            {onEdit && <>
              {group && <>
                <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'new-group', parentId: event.id })}>Add segment</button>
                <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'new-event', parentId: event.id, action: true })}>Record action</button>
              </>}
              <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'edit-event', event })}>Edit details</button>
              <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'organize', event })}>Move or reorder</button>
              {!group && <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'correct-date', event })}>Correct event date</button>}
            </>}
          </div>
        </header>
        {path.length > 0 && (filtered || displayMode === 'chronology') && (
          <p className="muted">{path.map((ancestor) => ancestor.name).join(' → ')}</p>
        )}
        {event.summary && <p className="wiki-prose"><strong>Summary</strong> {event.summary}</p>}
        {event.description && <p className="wiki-prose">{event.description}</p>}
        {event.method && <p className="wiki-prose"><strong>How</strong> {event.method}</p>}
        {(event.cause_event_ids.length > 0 || event.cause_state.length > 0) && (
          <section className="wiki-event-effects" aria-label="Causes">
            <h5>Causes</h5>
            <ul>
              {event.cause_event_ids.map((id) => <li key={id}>
                <button type="button" className="wiki-reference" onClick={() => focus(id)}>{index.get(id)?.name ?? 'Cause event'}</button>
              </li>)}
              {event.cause_state.map((fact) => <li key={fact.id}>
                {linked(fact.entry_id, fact.from_tick)} · {definitions.get(fact.field)?.label ?? fact.field}
                {fact.qualifier_id && <> · {linked(fact.qualifier_id, fact.from_tick)}</>}
                {' · '}{displayValue(fact.field, fact.value, fact.from_tick)} · From time {fact.from_tick}
                {fact.until_tick !== null && ' until time ' + fact.until_tick}
              </li>)}
            </ul>
          </section>
        )}
        {event.links.length > 0 && <dl className="wiki-event-roles">
          {Object.entries(linkLabels).map(([role, label]) => {
            const related = event.links.filter((link) => link.role === role)
            return related.length ? <div key={role}><dt>{label}</dt>
              <dd>{related.map((link) => <span key={link.entry_id}>{linked(link.entry_id, time)}</span>)}</dd></div> : null
          })}
        </dl>}
        {event.cross_reference_ids.length > 0 && <p className="wiki-event-action">
          Related actions{' '}{event.cross_reference_ids.filter((id) => index.has(id)).map((id) => (
            <button key={id} type="button" className="wiki-reference" onClick={() => focus(id)}>{index.get(id)?.name}</button>
          ))}
        </p>}
        {event.ability_use && <p className="wiki-event-action">
          {linked(event.ability_use.actor_id, time)} used {linked(event.ability_use.ability_id, time)}.
        </p>}
        {event.changes.length > 0 && <section className="wiki-event-effects" aria-label="State changes">
          <h5>State changes</h5>
          <ul>{event.changes.map((change) => (
            <li key={change.id}>
              {linked(change.entry_id, time)} · {definitions.get(change.field)?.label ?? change.field}
              {change.qualifier_id && <> · {linked(change.qualifier_id, time)}</>}
              {' · '}{displayValue(change.field, change.previous_value, time)}
              {' → '}{displayValue(change.field, change.value, time)}
            </li>
          ))}</ul>
        </section>}
        {event.source && <p className="muted wiki-event-source">Source: {event.source}</p>}
      </article>
    )
  }

  return (
    <section className="wiki-timeline" aria-label="World timeline">
      <div className="wiki-card-heading">
        <h2>World timeline</h2>
        {events.length > 0 && <div className="form-actions" aria-label="Timeline view">
          <button type="button" className="button secondary" aria-pressed={displayMode === 'outline'} onClick={() => setMode('outline')}>Outline</button>
          <button type="button" className="button secondary" aria-pressed={displayMode === 'chronology'} onClick={() => setMode('chronology')}>Chronology</button>
        </div>}
      </div>
      {events.length > 0 && <div className="wiki-timeline-filters">
        <label className="field">Filter by participant<select value={person} onChange={(event) => setPerson(event.target.value)}>
          <option value="">All participants</option>{entries.filter((entry) => isWikiActor(entry) || entry.kind === 'group').map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select></label>
        <label className="field">Filter by place<select value={place} onChange={(event) => setPlace(event.target.value)}>
          <option value="">All places</option>{entries.filter((entry) => entry.kind === 'place').map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select></label>
        {entries.some((entry) => entry.kind === 'era') && (
          <label className="field">Filter by era<select value={era} onChange={(event) => setEra(event.target.value)}>
            <option value="">All eras</option>{entries.filter((entry) => entry.kind === 'era').map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select></label>
        )}
        <label className="field">Filter by time<input type="number" min={0} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>}
      {events.length === 0 && <p className="muted">No events recorded in this view.</p>}
      {displayMode === 'outline' ? visibleRows.map(({ event, depth }) => card(event, depth)) : [...byTime].map(([time, group]) => (
        <section key={time} className="wiki-time-group" aria-label={'Time ' + time}>
          <h3>Time {time}</h3>
          {group.map((event) => card(event))}
        </section>
      ))}
      {events.length > 0 && (displayMode === 'chronology' ? !byTime.size : !visibleRows.length)
        && <p className="muted">No events match this view.</p>}
    </section>
  )
}
