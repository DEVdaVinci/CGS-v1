import { useState } from 'react'
import { isWikiActor, type WikiEvent } from './wiki-api'
import {
  Actions, CitationInput, EntryChoices, EntryPicker, EventContextFields, EventSignificanceField, optionalTime, readEventContext, TimeInput,
  type EventContextProps, type FormActions,
} from './wiki-forms'

export function WikiGroupForm({ events, entries, event, parentId, worldId, fields, at, ...actions }: FormActions & EventContextProps & {
  events: WikiEvent[]; parentId?: string
}) {
  const title = event ? 'Edit event group' : parentId ? 'Add segment' : 'New event group'
  const groups = events.filter((item) => item.node_kind === 'group')
  const leaves = events.filter((item) => item.node_kind !== 'group')

  return (
    <form className="wiki-form wiki-event-form" aria-label={title} onSubmit={(submission) => {
      submission.preventDefault()
      const values = new FormData(submission.currentTarget)
      const parent = groups.length ? String(values.get('parent_id') ?? '') : parentId
      const details = {
        ...readEventContext(values), name: String(values.get('name')), source: String(values.get('source') ?? ''),
        citation_id: String(values.get('citation_id') ?? '') || null,
        description: String(values.get('description') ?? ''), ability_use: null,
        participant_ids: values.getAll('participants').map(String), place_ids: values.getAll('places').map(String),
        item_ids: values.getAll('items').map(String), cross_reference_ids: values.getAll('references').map(String),
        start_tick: optionalTime(values, 'start'), end_tick: optionalTime(values, 'end'),
      }
      actions.onSave(event ? { ...details, op: 'edit_event', event_id: event.id }
        : { ...details, op: 'record_event_group', ...(parent ? { parent_id: parent } : {}) })
    }}>
      <h2>{title}</h2>
      <div className="wiki-form-row">
        <label className="field">Group name<input name="name" maxLength={120} defaultValue={event?.name} required /></label>
        <EventSignificanceField initial={event?.significance} />
      </div>
      {!event && groups.length > 0 && <EntryPicker name="parent_id" label="Parent event (optional)"
        initial={parentId} entries={groups} required={false} />}
      <label className="field">What happened<textarea name="description" maxLength={1500} rows={3} defaultValue={event?.description} /></label>
      <EventContextFields worldId={worldId} entries={entries} fields={fields} at={at} event={event} events={events} />
      <div className="wiki-form-row">
        <TimeInput label="Earliest time (optional)" name="start" day={event?.start_tick ?? undefined} optional />
        <TimeInput label="Latest time (optional)" name="end" day={event?.end_tick ?? undefined} optional />
      </div>
      <p className="muted">Leave both times blank to show the span of the group's dated children.</p>
      <details className="wiki-event-options">
        <summary>Participants, places, and items</summary>
        <div className="wiki-event-links">
          <EntryChoices label="Participants" name="participants" entries={entries.filter((entry) => isWikiActor(entry) || entry.kind === 'group')}
            initial={event?.links.filter((link) => link.role === 'participant').map((link) => link.entry_id) ?? []} />
          <EntryChoices label="Places" name="places" entries={entries.filter((entry) => entry.kind === 'place')}
            initial={event?.links.filter((link) => link.role === 'place').map((link) => link.entry_id) ?? []} />
          <EntryChoices label="Items" name="items" entries={entries.filter((entry) => entry.kind === 'item')}
            initial={event?.links.filter((link) => link.role === 'item').map((link) => link.entry_id) ?? []} />
        </div>
      </details>
      {leaves.length > 0 && (
        <EntryChoices label="Related actions and occurrences" name="references" entries={leaves} initial={event?.cross_reference_ids ?? []} />
      )}
      <CitationInput entries={entries} initial={event?.citation_id} />
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={event?.source} /></label>
      <Actions {...actions} submit="Save event group" />
    </form>
  )
}

export function WikiOrganizeForm({ event, events, ...actions }: FormActions & { event: WikiEvent; events: WikiEvent[] }) {
  const [parent, setParent] = useState(event.parent_id ?? '')
  const byId = new Map(events.map((item) => [item.id, item]))
  const parents = events.filter((item) => {
    if (item.id === event.id || item.node_kind !== 'group') return false
    let id = item.parent_id
    while (id) {
      if (id === event.id) return false
      id = byId.get(id)?.parent_id ?? null
    }
    return true
  })
  const siblings = events.filter((item) => item.parent_id === event.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  const currentPosition = siblings.findIndex((item) => item.id === event.id) + 1

  return (
    <form className="wiki-form" aria-label="Move or reorder event" onSubmit={(submission) => {
      submission.preventDefault()
      const position = optionalTime(new FormData(submission.currentTarget), 'position')
      actions.onSave({
        op: 'organize_event', event_id: event.id, parent_id: parent || null,
        ...(position === null ? {} : { position: position - 1 }),
      })
    }}>
      <h2>Move or reorder event</h2>
      <p>{event.name}</p>
      <EntryPicker label="Parent event (optional)" entries={parents} initial={parent} required={false} onChange={setParent} />
      <label className="field">Position (optional)<input key={parent} name="position" type="number" min={1}
        defaultValue={(parent || null) === event.parent_id ? currentPosition : undefined} /></label>
      <p className="muted">Leave position blank to place the event last. Event dates and state changes stay tied to the original records.</p>
      <Actions {...actions} submit="Save position" />
    </form>
  )
}
