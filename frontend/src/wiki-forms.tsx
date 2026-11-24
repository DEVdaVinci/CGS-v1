import { type FormEvent, useState } from 'react'
import {
  type WikiAssertion, type WikiClaim, type WikiCommand, type WikiEntry, type WikiEvent,
  type WikiField, type WikiKind, type WikiLearnedAbility, type WikiValue,
} from './wiki-api'

export const kindLabel: Record<WikiKind, string> = {
  person: 'Character', place: 'Place', group: 'Group', class: 'Class', ability: 'Ability', item: 'Item',
}

export type ArticleEdit =
  | { kind: 'fact' | 'claim' | 'event' }
  | { kind: 'rename' }
  | { kind: 'learn'; learned?: WikiLearnedAbility }
  | { kind: 'edit-event'; event: WikiEvent }
  | { kind: 'correct'; fact: WikiAssertion }
  | { kind: 'correct-date'; event: WikiEvent }
  | { kind: 'observe'; source: WikiAssertion | WikiClaim; sourceKind: 'assertion' | 'claim' }

type FormActions = { onSave: (command: WikiCommand) => void; onCancel: () => void; busy: boolean }
type EntryFormProps = FormActions & {
  entry: WikiEntry; fields: WikiField[]; entries: WikiEntry[]; at: number
}

function Actions({ busy, onCancel, submit }: Pick<FormActions, 'busy' | 'onCancel'> & { submit: string }) {
  return (
    <div className="form-actions">
      <button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : submit}</button>
      <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  )
}

export function WikiEntryForm({ fixedKind, entries, fields, at, ...actions }: FormActions & {
  fixedKind?: WikiKind; entries: WikiEntry[]; fields: WikiField[]; at: number
}) {
  const [kind, setKind] = useState<WikiKind>(fixedKind ?? 'person')
  const title = fixedKind ? 'New ' + kindLabel[fixedKind].toLowerCase() : 'New entry'
  const keys = kind === 'person'
    ? ['description', 'appearance', 'background', 'character_class', 'located_in']
    : kind === 'place' ? ['description', 'place_type', 'located_in'] : ['description']
  const initialFields = keys.map((key) => fields.find((field) => field.key === key)!)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    actions.onSave({
      op: 'create_entry', name: String(values.get('name')), kind,
      author_only: values.has('author_only'), initial_at: at,
      initial_values: initialFields.filter((field) => String(values.get(field.key) ?? '').trim()).map((field) => ({
        field: field.key, value: readValue(values, field.key, field), author_only: values.has('author_only'),
      })),
    })
  }
  return (
    <form className="wiki-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      <label className="field">Entry name<input name="name" maxLength={100} required /></label>
      {!fixedKind && <label className="field">Entry type
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as WikiKind)}>
          {Object.entries(kindLabel).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
      </label>}
      {initialFields.map((field) => (
        <ValueInput
          key={field.key} field={field} entries={entries} entryId="" name={field.key}
          label={field.key === 'description' ? 'Overview' : field.key === 'located_in' && kind === 'place' ? 'Parent place' : field.label}
          required={false}
        />
      ))}
      <label className="wiki-checkbox"><input type="checkbox" name="author_only" /> Author only</label>
      <Actions {...actions} submit="Save entry" />
    </form>
  )
}

function TimeInput({ label, name, day, optional = false }: { label: string; name: string; day?: number; optional?: boolean }) {
  return (
    <label className="field">{label}
      <input name={name} type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={day} required={!optional} />
    </label>
  )
}

function EntryPicker({
  name, label, entries, initial, required = true, onChange,
}: {
  name?: string; label: string; entries: WikiEntry[]; initial?: string
  required?: boolean; onChange?: (id: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(initial ?? '')
  const query = filter.trim().toLowerCase()
  return (
    <div className="wiki-picker">
      {entries.length > 0 && (
        <input
          className="wiki-picker-filter" type="search" value={filter}
          aria-label={'Filter choices for ' + (label === 'Value' ? 'linked entry' : label)}
          placeholder="Filter by name" onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <label className="field">{label}
        <select
          name={name} value={selected} required={required} onChange={(event) => {
            setSelected(event.target.value)
            onChange?.(event.target.value)
          }}
        >
          <option value="">{required ? 'Select an entry' : 'Choose later'}</option>
          {entries.filter((entry) => entry.id === selected || entry.name.toLowerCase().includes(query)).map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function ValueInput({
  field, entries, entryId, name, initial, label = 'Value', required = true,
}: {
  field: WikiField; entries: WikiEntry[]; entryId: string; name: string; initial?: WikiValue; label?: string; required?: boolean
}) {
  if (field.target_kind) {
    return (
      <EntryPicker name={name} label={label} initial={initial?.toString()} required={required}
        entries={entries.filter((entry) => entry.kind === field.target_kind && entry.id !== entryId)} />
    )
  }
  return (
    <label className="field">{label}
      {field.choices.length ? (
        <select name={name} defaultValue={initial ?? ''} required={required}>
          <option value="">{required ? 'Choose a value' : 'Choose later'}</option>
          {field.choices.map((choice) => <option key={choice}>{choice}</option>)}
        </select>
      ) : field.value_kind === 'integer' ? (
        <input name={name} type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={initial} required={required} />
      ) : ['description', 'appearance', 'background'].includes(field.key) ? (
        <textarea name={name} rows={3} maxLength={500} defaultValue={initial} required={required} />
      ) : (
        <input name={name} maxLength={500} defaultValue={initial} required={required} />
      )}
    </label>
  )
}

function readValue(values: FormData, name: string, field: WikiField): WikiValue {
  const text = String(values.get(name) ?? '')
  return field.value_kind === 'integer' ? Number(text) : text
}

function PersonSelect({ name, label, entries }: { name: string; label: string; entries: WikiEntry[] }) {
  return <EntryPicker name={name} label={label} entries={entries.filter((entry) => entry.kind === 'person')} />
}

function CanonicalForm({ mode, fact, entry, fields, entries, at, ...actions }: EntryFormProps & {
  mode: 'fact' | 'claim' | 'correct'; fact?: WikiAssertion
}) {
  const validFields = fields.filter((field) => field.kinds.includes(entry.kind))
  const [fieldKey, setFieldKey] = useState(fact?.field ?? validFields[0].key)
  const field = validFields.find((item) => item.key === fieldKey)!
  const title = mode === 'correct' ? 'Correct value' : mode === 'claim' ? 'Record claim' : 'Record fact'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value = readValue(values, 'value', field)
    if (fact) {
      actions.onSave({ op: 'correct_fact', assertion_id: fact.id, value })
      return
    }
    const change = {
      entry_id: entry.id, field: field.key, value, author_only: values.has('author_only'),
      source: String(values.get('source') ?? ''),
    }
    actions.onSave(mode === 'claim'
      ? { ...change, op: 'record_claim', speaker_id: String(values.get('speaker_id')), tick: Number(values.get('tick')) }
      : {
          ...change, op: 'record_fact', from_tick: Number(values.get('from_tick')),
          until_tick: values.get('until_tick') === '' ? null : Number(values.get('until_tick')),
        })
  }
  return (
    <form className="wiki-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      {fact ? <p className="muted">{field.label} from time {fact.from_tick}. The effective dates stay the same.</p> : (
        <label className="field">Field
          <select value={fieldKey} onChange={(event) => setFieldKey(event.target.value)}>
            {validFields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
      )}
      <ValueInput key={fieldKey} field={field} entries={entries} entryId={entry.id} name="value" initial={fact?.value} />
      {!fact && (
        <>
          {mode === 'claim' ? (
            <div className="wiki-form-row">
              <PersonSelect name="speaker_id" label="Speaker" entries={entries} />
              <TimeInput name="tick" label="Statement time" day={at} />
            </div>
          ) : (
            <div className="wiki-form-row">
              <TimeInput name="from_tick" label="Effective from" day={at} />
              <TimeInput name="until_tick" label="Effective until (optional)" optional />
            </div>
          )}
          <label className="field">Source (optional)<input name="source" maxLength={500} /></label>
          <label className="wiki-checkbox"><input type="checkbox" name="author_only" /> Author only</label>
        </>
      )}
      <Actions {...actions} submit={mode === 'correct' ? 'Save correction' : mode === 'claim' ? 'Save claim' : 'Save fact'} />
    </form>
  )
}

function EventLinks({ label, name, entries, initial }: {
  label: string; name: string; entries: WikiEntry[]; initial: string[]
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(initial)
  const query = filter.trim().toLowerCase()
  const options = entries.filter((entry) => selected.includes(entry.id) || entry.name.toLowerCase().includes(query))
  return (
    <fieldset className="wiki-change-fields wiki-link-choices">
      <legend>{label}</legend>
      {entries.length > 0 && <input type="search" aria-label={'Find ' + label.toLowerCase()}
        value={filter} placeholder="Filter by name" onChange={(event) => setFilter(event.target.value)} />}
      <div className="wiki-option-list">
        {options.map((entry) => (
          <label key={entry.id} className="wiki-checkbox">
            <input
              type="checkbox" name={name} value={entry.id} checked={selected.includes(entry.id)}
              onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, entry.id] : ids.filter((id) => id !== entry.id))}
            /> {entry.name}
          </label>
        ))}
        {options.length === 0 && <p className="muted">{entries.length ? 'No matches.' : 'No entries of this type yet.'}</p>}
      </div>
    </fieldset>
  )
}

export function WikiEventForm({ entry, fields, entries, at, event, ...actions }: Omit<EntryFormProps, 'entry'> & {
  entry?: WikiEntry; event?: WikiEvent
}) {
  const [rows, setRows] = useState(entry ? [{ id: 0, entryId: entry.id, field: 'status' }] : [])
  const [nextId, setNextId] = useState(1)
  const [ability, setAbility] = useState(event?.ability_use?.ability_id ?? '')
  const title = event ? 'Edit event details' : entry ? 'Record dated change' : 'New event'
  const fieldsFor = (id: string) => fields.filter((field) => {
    const kind = entries.find((item) => item.id === id)?.kind
    return kind !== undefined && field.kinds.includes(kind)
  })

  function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    const values = new FormData(submission.currentTarget)
    const details = {
      name: String(values.get('name')), source: String(values.get('source') ?? ''),
      description: String(values.get('description') ?? ''),
      participant_ids: values.getAll('participants').map(String),
      place_ids: values.getAll('places').map(String), item_ids: values.getAll('items').map(String),
      ability_use: ability ? { ability_id: ability, actor_id: String(values.get('actor_id')) } : null,
    }
    if (event) {
      actions.onSave({ ...details, op: 'edit_event', event_id: event.id })
    } else {
      const changes = rows.map((row) => ({
        entry_id: row.entryId, field: row.field,
        value: readValue(values, 'value-' + row.id, fields.find((field) => field.key === row.field)!),
        author_only: values.has('author-only-' + row.id),
      }))
      actions.onSave({ ...details, op: 'record_event', tick: Number(values.get('tick')), changes })
    }
  }
  return (
    <form className="wiki-form wiki-event-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      <div className="wiki-form-row">
        <label className="field">Event name<input name="name" maxLength={120} defaultValue={event?.name} required /></label>
        {event ? <p className="muted">Time {event.tick}</p> : <TimeInput name="tick" label="Event time" day={at} />}
      </div>
      <label className="field">What happened<textarea name="description" rows={3} maxLength={1500} defaultValue={event?.description} /></label>
      <details className="wiki-event-options" open={!entry || Boolean(event)}>
        <summary>Participants, places, and items</summary>
        <div className="wiki-event-links">
          <EventLinks label="Participants" name="participants" entries={entries.filter((e) => e.kind === 'person' || e.kind === 'group')}
            initial={event?.links.filter((link) => link.role === 'participant').map((link) => link.entry_id) ?? []} />
          <EventLinks label="Places" name="places" entries={entries.filter((e) => e.kind === 'place')}
            initial={event?.links.filter((link) => link.role === 'place').map((link) => link.entry_id) ?? []} />
          <EventLinks label="Items" name="items" entries={entries.filter((e) => e.kind === 'item')}
            initial={event?.links.filter((link) => link.role === 'item').map((link) => link.entry_id) ?? []} />
        </div>
      </details>
      {entries.some((item) => item.kind === 'ability') && (
        <details className="wiki-event-options" open={Boolean(event?.ability_use)}>
          <summary>Ability used</summary>
          <div className="wiki-form-row">
            <EntryPicker label="Ability definition" entries={entries.filter((e) => e.kind === 'ability')}
              initial={ability} required={false} onChange={setAbility} />
            {ability && <EntryPicker name="actor_id" label="Used by" entries={entries.filter((e) => e.kind === 'person')}
              initial={event?.ability_use?.actor_id} />}
          </div>
        </details>
      )}
      {!event && rows.map((row, index) => (
        <fieldset key={row.id} className="wiki-change-fields">
          <legend>Change {index + 1}</legend>
          {!entry && (
            <EntryPicker label="Affected entry" entries={entries} initial={row.entryId} onChange={(id) => {
              setRows((current) => current.map((candidate) => candidate.id === row.id
                ? { ...candidate, entryId: id, field: fieldsFor(id)[0]?.key ?? '' } : candidate))
            }} />
          )}
          {row.entryId && <>
          <label className="field">Field
            <select value={row.field} onChange={(event) => setRows((current) => current.map(
              (candidate) => candidate.id === row.id ? { ...candidate, field: event.target.value } : candidate,
            ))}>
              {fieldsFor(row.entryId).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <ValueInput
            key={row.entryId + ':' + row.field} entryId={row.entryId} entries={entries} name={'value-' + row.id}
            field={fields.find((item) => item.key === row.field)!}
          />
          <label className="wiki-checkbox"><input type="checkbox" name={'author-only-' + row.id} /> Author only</label>
          </>}
          <button className="button secondary" type="button" onClick={() => setRows((all) => all.filter((item) => item.id !== row.id))}>
            Remove change
          </button>
        </fieldset>
      ))}
      {!event && entries.length > 0 && rows.length < (entry ? fieldsFor(entry.id).length : 40) && (
        <button className="button secondary wiki-add-change" type="button" onClick={() => {
          const available = entry && fieldsFor(entry.id).find((field) => !rows.some((row) => row.field === field.key))
          setRows([...rows, { id: nextId, entryId: entry?.id ?? '', field: available?.key ?? '' }])
          setNextId(nextId + 1)
        }}>{rows.length ? 'Add another change' : 'Add a state change'}</button>
      )}
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={event?.source} /></label>
      <Actions {...actions} submit={event ? 'Save event details' : entry ? 'Save dated change' : 'Save event'} />
    </form>
  )
}

export function WikiEvidenceForm({ edit, entries, at, ...actions }: FormActions & {
  edit: Extract<ArticleEdit, { kind: 'correct-date' | 'observe' }>; entries: WikiEntry[]; at: number
}) {
  const date = edit.kind === 'correct-date'
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const tick = Number(values.get('tick'))
    actions.onSave(edit.kind === 'correct-date'
      ? { op: 'correct_event_date', event_id: edit.event.id, tick }
      : {
          op: 'record_observation', observer_id: String(values.get('observer_id')), source_id: edit.source.id,
          source_kind: edit.sourceKind, learned_at: tick,
        })
  }
  const title = date ? 'Correct event date' : 'Record observation'
  return (
    <form className="wiki-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      {edit.kind === 'correct-date' ? <p className="muted">{edit.event.name}</p> : (
        <PersonSelect name="observer_id" label="Observer" entries={entries} />
      )}
      <TimeInput
        name="tick" label={date ? 'Corrected event time' : 'Learned at'}
        day={edit.kind === 'correct-date' ? edit.event.tick : Math.max(at, 'from_tick' in edit.source ? edit.source.from_tick : edit.source.tick)}
      />
      <Actions {...actions} submit={date ? 'Save corrected date' : 'Save observation'} />
    </form>
  )
}

export function WikiEditForm({ edit, ...props }: EntryFormProps & { edit: ArticleEdit }) {
  if (edit.kind === 'event') return <WikiEventForm {...props} />
  if (edit.kind === 'edit-event') return <WikiEventForm {...props} entry={undefined} event={edit.event} />
  if (edit.kind === 'correct-date' || edit.kind === 'observe') return <WikiEvidenceForm {...props} edit={edit} />
  if (edit.kind === 'rename') return <RenameForm {...props} />
  if (edit.kind === 'learn') return <LearnAbilityForm {...props} learned={edit.learned} />
  if (edit.kind === 'correct') return <CanonicalForm {...props} mode="correct" fact={edit.fact} />
  return <CanonicalForm {...props} mode={edit.kind} />
}

function RenameForm({ entry, ...actions }: FormActions & { entry: WikiEntry }) {
  return (
    <form className="wiki-form" aria-label="Rename entry" onSubmit={(event) => {
      event.preventDefault()
      const name = String(new FormData(event.currentTarget).get('name'))
      actions.onSave({ op: 'rename_entry', entry_id: entry.id, name })
    }}>
      <h2>Rename entry</h2>
      <label className="field">Entry name<input name="name" defaultValue={entry.name} maxLength={100} required /></label>
      <Actions {...actions} submit="Save name" />
    </form>
  )
}

function LearnAbilityForm({ entry, entries, at, learned, ...actions }: EntryFormProps & { learned?: WikiLearnedAbility }) {
  const title = learned ? 'Correct ability record' : 'Record learned ability'
  return (
    <form className="wiki-form" aria-label={title} onSubmit={(event) => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      const learned_at = Number(values.get('learned_at'))
      const source = String(values.get('source') ?? '')
      actions.onSave(learned
        ? { op: 'correct_learned_ability', learned_ability_id: learned.id, learned_at, source }
        : { op: 'record_learned_ability', character_id: entry.id, ability_id: String(values.get('ability_id')), learned_at, source })
    }}>
      <h2>{title}</h2>
      {learned ? <p>{entries.find((candidate) => candidate.id === learned.ability_id)?.name}</p> : (
        <EntryPicker name="ability_id" label="Ability definition" entries={entries.filter((candidate) => candidate.kind === 'ability')} />
      )}
      <TimeInput name="learned_at" label="Learned at" day={learned?.learned_at ?? at} />
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={learned?.source} /></label>
      <Actions {...actions} submit={learned ? 'Save ability correction' : 'Save learned ability'} />
    </form>
  )
}
