import { useEffect } from 'react'
import { type WikiEntry, type WikiEvent, type WikiField, type WikiValue } from './wiki-api'
import { type ArticleEdit } from './wiki-forms'

const linkLabels = { participant: 'Participants', place: 'Places', item: 'Items' } as const

export function WikiTimeline({ events, entries, fields, currentEvent, onOpen, onEdit }: {
  events: WikiEvent[]; entries: WikiEntry[]; fields: WikiField[]; currentEvent?: string
  onOpen?: (id: string, at: number) => void; onEdit?: (edit: ArticleEdit) => void
}) {
  useEffect(() => {
    if (currentEvent) document.getElementById('wiki-event-' + currentEvent)?.scrollIntoView({ block: 'nearest' })
  }, [currentEvent])

  const index = new Map(entries.map((entry) => [entry.id, entry]))
  const byTime = new Map<number, WikiEvent[]>()
  for (const event of events) {
    const group = byTime.get(event.tick) ?? []
    group.push(event)
    byTime.set(event.tick, group)
  }

  function linked(id: string, at: number) {
    const label = index.get(id)?.name ?? 'Unavailable entry'
    return onOpen && index.has(id) ? (
      <button type="button" className="wiki-reference" onClick={() => onOpen(id, at)}>{label}</button>
    ) : <span>{label}</span>
  }

  function displayValue(fieldKey: string, value: WikiValue, at: number) {
    const field = fields.find((definition) => definition.key === fieldKey)
    return field?.target_kind && typeof value === 'string' ? linked(value, at) : value
  }

  return (
    <section className="wiki-timeline" aria-label="World timeline">
      <h2>World timeline</h2>
      {events.length === 0 && <p className="muted">No events recorded in this view.</p>}
      {[...byTime].map(([time, group]) => (
        <section key={time} className="wiki-time-group" aria-label={'Time ' + time}>
          <h3>Time {time}</h3>
          {group.map((event) => (
            <article
              key={event.id} className="wiki-timeline-card" id={'wiki-event-' + event.id}
              aria-label={event.name} data-selected={currentEvent === event.id || undefined}
            >
              <header className="wiki-card-heading">
                <h4>{event.name}</h4>
                {onEdit && (
                  <div className="form-actions">
                    <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'edit-event', event })}>Edit details</button>
                    <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'correct-date', event })}>Correct event date</button>
                  </div>
                )}
              </header>
              {event.description && <p className="wiki-prose">{event.description}</p>}
              {event.links.length > 0 && (
                <dl className="wiki-event-roles">
                  {Object.entries(linkLabels).map(([role, label]) => {
                    const matches = event.links.filter((link) => link.role === role)
                    if (!matches.length) return null
                    return (
                      <div key={role}>
                        <dt>{label}</dt>
                        <dd>{matches.map((link) => <span key={link.entry_id}>{linked(link.entry_id, time)}</span>)}</dd>
                      </div>
                    )
                  })}
                </dl>
              )}
              {event.ability_use && (
                <p className="wiki-event-action">
                  {linked(event.ability_use.actor_id, time)} used {linked(event.ability_use.ability_id, time)}.
                </p>
              )}
              {event.changes.length > 0 && (
                <section className="wiki-event-effects" aria-label="State changes">
                  <h5>State changes</h5>
                  <ul>
                    {event.changes.map((change) => (
                      <li key={change.entry_id + ':' + change.field}>
                        {linked(change.entry_id, time)} · {fields.find((field) => field.key === change.field)?.label ?? change.field} → {displayValue(change.field, change.value, time)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {event.source && <p className="muted wiki-event-source">Source: {event.source}</p>}
            </article>
          ))}
        </section>
      ))}
    </section>
  )
}
