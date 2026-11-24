import { type FormEvent, useState } from 'react'
import {
  isWikiActor,
  type WikiAssertion, type WikiClaim, type WikiCommand, type WikiEntry, type WikiEvent,
  type WikiField, type WikiKind, type WikiLearnedAbility, type WikiObservation, type WikiProposition, type WikiValue,
} from './wiki-api'

export const kindLabel: Record<WikiKind, string> = {
  person: 'Character', place: 'Place', group: 'Group', class: 'Class', ability: 'Ability', item: 'Item',
  species: 'Species', organism: 'Organism', culture: 'Culture', role: 'Role or title',
  resource: 'Resource', body_part: 'Body part', trait: 'Trait', goal: 'Goal',
}

export type ArticleEdit =
  | { kind: 'fact'; field?: string }
  | { kind: 'claim' | 'event' }
  | { kind: 'rename' }
  | { kind: 'learn'; learned?: WikiLearnedAbility }
  | { kind: 'edit-event'; event: WikiEvent }
  | { kind: 'correct'; fact: WikiAssertion }
  | { kind: 'correct-date'; event: WikiEvent }
  | { kind: 'observe'; source: WikiAssertion | WikiClaim; sourceKind: 'assertion' | 'claim' }
  | { kind: 'proposition'; record?: WikiProposition }

export type FormActions = { onSave: (command: WikiCommand) => void; onCancel: () => void; busy: boolean }
type EntryFormProps = FormActions & {
  entry: WikiEntry; fields: WikiField[]; entries: WikiEntry[]; at: number
  observations?: WikiObservation[]
}

export function Actions({ busy, onCancel, submit }: Pick<FormActions, 'busy' | 'onCancel'> & { submit: string }) {
  return (
    <div className="form-actions">
      <button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : submit}</button>
      <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  )
}

const initialKeys: Partial<Record<WikiKind, string[]>> = {
  person: ['birth_tick', 'death_tick', 'species', 'character_class', 'located_in', 'appearance', 'background'],
  organism: ['birth_tick', 'death_tick', 'species', 'located_in', 'appearance'],
  place: ['place_type', 'located_in'],
  resource: ['unit'],
  goal: ['goal_owner', 'parent_goal', 'goal_subject', 'priority', 'status'],
}

export function WikiEntryForm({ fixedKind, entries, fields, at, ownerId, ...actions }: FormActions & {
  fixedKind?: WikiKind; entries: WikiEntry[]; fields: WikiField[]; at: number; ownerId?: string
}) {
  const [kind, setKind] = useState<WikiKind>(fixedKind ?? 'person')
  const title = fixedKind ? 'New ' + kindLabel[fixedKind].toLowerCase() : 'New entry'
  const keys = ['description', ...(initialKeys[kind] ?? [])]
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
          initial={field.key === 'goal_owner' ? ownerId : undefined}
          required={false}
        />
      ))}
      <label className="wiki-checkbox"><input type="checkbox" name="author_only" /> Author only</label>
      <Actions {...actions} submit="Save entry" />
    </form>
  )
}

export function TimeInput({ label, name, day, optional = false }: { label: string; name: string; day?: number; optional?: boolean }) {
  return (
    <label className="field">{label}
      <input name={name} type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={day} required={!optional} />
    </label>
  )
}

export function EntryPicker({
  name, label, entries, initial, required = true, onChange,
}: {
  name?: string; label: string; entries: Pick<WikiEntry, 'id' | 'name'>[]; initial?: string
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

export function ValueInput({
  field, entries, entryId, name, initial, label = 'Value', required = true,
}: {
  field: WikiField; entries: WikiEntry[]; entryId: string; name: string; initial?: WikiValue; label?: string; required?: boolean
}) {
  if (field.target_kinds.length) {
    const selectedKind = entries.find((entry) => entry.id === entryId)?.kind
    return (
      <EntryPicker name={name} label={label} initial={initial?.toString()} required={required}
        entries={entries.filter((entry) => field.target_kinds.includes(entry.kind) && entry.id !== entryId
          && (field.key !== 'inherits_from' || entry.kind === selectedKind))} />
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
      ) : field.value_kind === 'decimal' ? (
        <input name={name} inputMode="decimal" pattern={String.raw`-?\d{1,15}(\.\d{1,9})?`} defaultValue={initial} required={required} />
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
  return <EntryPicker name={name} label={label} entries={entries.filter(isWikiActor)} />
}

function QualifierInput({ field, entries, name, initial }: {
  field: WikiField; entries: WikiEntry[]; name: string; initial?: string | null
}) {
  if (!field.qualifier_kind) return null
  return <EntryPicker name={name} label={field.qualifier_kind === 'group' ? 'In group (optional)' : kindLabel[field.qualifier_kind]}
    required={field.qualifier_required} entries={entries.filter((entry) => entry.kind === field.qualifier_kind)}
    initial={initial ?? undefined} />
}

export function optionalTime(values: FormData, name: string) {
  const value = values.get(name)
  return value ? Number(value) : null
}

function CanonicalForm({ mode, fact, initialField, entry, fields, entries, at, ...actions }: EntryFormProps & {
  mode: 'fact' | 'claim' | 'correct'; fact?: WikiAssertion; initialField?: string
}) {
  const validFields = fields.filter((field) => field.kinds.includes(entry.kind))
  const [fieldKey, setFieldKey] = useState(fact?.field ?? initialField ?? validFields[0].key)
  const field = validFields.find((item) => item.key === fieldKey)!
  const title = mode === 'correct' ? 'Correct value' : mode === 'claim' ? 'Record claim' : 'Record fact'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value = readValue(values, 'value', field)
    const source = String(values.get('source') ?? '')
    const author_only = values.has('author_only')
    if (fact) {
      actions.onSave({ op: 'correct_fact', assertion_id: fact.id, value, source, author_only })
      return
    }
    const qualifier = String(values.get('qualifier_id') ?? '')
    const change = {
      entry_id: entry.id, field: field.key, value, author_only, source,
      ...(qualifier ? { qualifier_id: qualifier } : {}),
    }
    actions.onSave(mode === 'claim'
      ? { ...change, op: 'record_claim', speaker_id: String(values.get('speaker_id')), tick: Number(values.get('tick')) }
      : {
          ...change, op: 'record_fact', from_tick: Number(values.get('from_tick')),
          until_tick: optionalTime(values, 'until_tick'),
        })
  }
  return (
    <form className="wiki-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      {fact ? <p className="muted">{field.label} from time {fact.from_tick}. The effective dates stay the same.</p> : (
        <label className="field">Field
          <select value={fieldKey} onChange={(event) => setFieldKey(event.target.value)}>
            {validFields.map((item) => <option key={item.key} value={item.key}>
              {item.key === 'located_in' && entry.kind === 'place' ? 'Parent place' : item.label}
            </option>)}
          </select>
        </label>
      )}
      <ValueInput key={fieldKey} field={field} entries={entries} entryId={entry.id} name="value" initial={fact?.value} />
      {!fact && <QualifierInput key={'qualifier-' + fieldKey} field={field} entries={entries} name="qualifier_id" />}
      {fact?.qualifier_id && <p className="muted">{entries.find((item) => item.id === fact.qualifier_id)?.name}</p>}
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
        </>
      )}
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={fact?.source} /></label>
      <label className="wiki-checkbox"><input type="checkbox" name="author_only" defaultChecked={fact?.author_only} /> Author only</label>
      <Actions {...actions} submit={mode === 'correct' ? 'Save correction' : mode === 'claim' ? 'Save claim' : 'Save fact'} />
    </form>
  )
}

export function EventLinks({ label, name, entries, initial }: {
  label: string; name: string; entries: Pick<WikiEntry, 'id' | 'name'>[]; initial: string[]
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

export function WikiEventForm({ entry, fields, entries, at, event, parents = [], parentId, action, ...actions }: Omit<EntryFormProps, 'entry'> & {
  entry?: WikiEntry; event?: WikiEvent; parents?: WikiEvent[]; parentId?: string; action?: boolean
}) {
  const [rows, setRows] = useState(entry ? [{ id: 0, entryId: entry.id, field: 'status' }] : [])
  const [nextId, setNextId] = useState(1)
  const [ability, setAbility] = useState(event?.ability_use?.ability_id ?? '')
  const title = event ? 'Edit event details' : entry ? 'Record dated change' : action ? 'Record action' : 'New event'
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
      start_tick: optionalTime(values, 'start_tick'), end_tick: optionalTime(values, 'end_tick'),
    }
    if (event) {
      actions.onSave({ ...details, op: 'edit_event', event_id: event.id })
    } else {
      const changes = rows.map((row) => {
        const qualifier = String(values.get('qualifier-' + row.id) ?? '')
        const mode = String(values.get('mode-' + row.id)) as 'set' | 'add' | 'end'
        return {
          entry_id: row.entryId, field: row.field,
          value: readValue(values, 'value-' + row.id, fields.find((field) => field.key === row.field)!),
          author_only: values.has('author-only-' + row.id), mode,
          ...(qualifier ? { qualifier_id: qualifier } : {}),
        }
      })
      const parent = parents.length ? String(values.get('parent_id') ?? '') : parentId
      actions.onSave({
        ...details, op: 'record_event', tick: Number(values.get('tick')), changes,
        ...(parent ? { parent_id: parent } : {}), ...(action ? { node_kind: 'action' } : {}),
      })
    }
  }
  return (
    <form className="wiki-form wiki-event-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      <div className="wiki-form-row">
        <label className="field">Event name<input name="name" maxLength={120} defaultValue={event?.name} required /></label>
        {event ? <p className="muted">Time {event.tick}</p> : <TimeInput name="tick" label="Event time" day={at} />}
      </div>
      {!event && parents.length > 0 && <EntryPicker name="parent_id" label="Parent event (optional)"
        entries={parents} initial={parentId} required={false} />}
      <details className="wiki-event-options" open={event?.start_tick != null || event?.end_tick != null}>
        <summary>Event duration</summary>
        <div className="wiki-form-row">
          <TimeInput name="start_tick" label="Start time (optional)" day={event?.start_tick ?? undefined} optional />
          <TimeInput name="end_tick" label="End time (optional)" day={event?.end_tick ?? undefined} optional />
        </div>
      </details>
      <label className="field">What happened<textarea name="description" rows={3} maxLength={1500} defaultValue={event?.description} /></label>
      <details className="wiki-event-options" open={!entry || Boolean(event)}>
        <summary>Participants, places, and items</summary>
        <div className="wiki-event-links">
          <EventLinks label="Participants" name="participants" entries={entries.filter((e) => isWikiActor(e) || e.kind === 'group')}
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
          <QualifierInput key={'qualifier-' + row.entryId + ':' + row.field} field={fields.find((item) => item.key === row.field)!}
            entries={entries} name={'qualifier-' + row.id} />
          <label className="field">Change type
            <select key={row.field} name={'mode-' + row.id} defaultValue={fields.find((item) => item.key === row.field)?.many ? 'add' : 'set'}>
              <option value="set">Set value</option>
              <option value="add">Add value or relationship</option>
              <option value="end">End value or relationship</option>
            </select>
          </label>
          <label className="wiki-checkbox"><input type="checkbox" name={'author-only-' + row.id} /> Author only</label>
          </>}
          <button className="button secondary" type="button" onClick={() => setRows((all) => all.filter((item) => item.id !== row.id))}>
            Remove change
          </button>
        </fieldset>
      ))}
      {!event && entries.length > 0 && rows.length < 40 && (
        <button className="button secondary wiki-add-change" type="button" onClick={() => {
          const available = entry && fieldsFor(entry.id).find((field) => !rows.some((row) => row.field === field.key))
          setRows([...rows, { id: nextId, entryId: entry?.id ?? '', field: available?.key ?? (entry ? 'status' : '') }])
          setNextId(nextId + 1)
        }}>{rows.length ? 'Add another change' : 'Add a state change'}</button>
      )}
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={event?.source} /></label>
      <Actions {...actions} submit={event ? 'Save event details' : entry ? 'Save dated change' : action ? 'Save action' : 'Save event'} />
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
          ...(optionalTime(values, 'about_tick') === null ? {} : { about_tick: Number(values.get('about_tick')) }),
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
        day={edit.kind === 'correct-date' ? edit.event.tick ?? undefined : Math.max(at, 'from_tick' in edit.source ? edit.source.from_tick : edit.source.tick)}
      />
      {edit.kind === 'observe' && <TimeInput name="about_tick" label="About time (optional)" optional />}
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
  if (edit.kind === 'proposition') return <PropositionForm {...props} record={edit.record} />
  return <CanonicalForm {...props} mode={edit.kind} initialField={edit.kind === 'fact' ? edit.field : undefined} />
}

function PropositionForm({ entry, entries, fields, observations = [], record, at, ...actions }: EntryFormProps & {
  record?: WikiProposition
}) {
  const [subjectId, setSubject] = useState(record?.subject_id ?? '')
  const [fieldKey, setField] = useState(record?.field ?? 'status')
  const subject = entries.find((item) => item.id === subjectId)
  const eligible = subject ? fields.filter((field) => field.kinds.includes(subject.kind)) : []
  const field = eligible.find((item) => item.key === fieldKey)
  const holder = entries.find((item) => item.id === record?.holder_id) ?? entry
  const goal = holder.kind === 'goal'
  const evidence = observations.filter((observation) => observation.observer_id === holder.id)
  const noun = goal ? 'desired state' : 'belief'
  const title = (record ? 'Correct ' : 'Record ') + noun

  return (
    <form className="wiki-form" aria-label={title} onSubmit={(event) => {
      event.preventDefault()
      if (!field) return
      const data = new FormData(event.currentTarget)
      const qualifier = String(data.get('qualifier') ?? '')
      const details = {
        holder_id: holder.id, entry_id: subjectId, field: field.key, value: readValue(data, 'value', field),
        from_tick: Number(data.get('from_tick')), until_tick: optionalTime(data, 'until_tick'),
        about_tick: optionalTime(data, 'about_tick'), source: String(data.get('source') ?? ''),
        evidence_id: String(data.get('evidence') ?? '') || null, author_only: data.has('author_only'),
        ...(qualifier ? { qualifier_id: qualifier } : {}),
      }
      actions.onSave(record
        ? { ...details, op: 'correct_proposition', proposition_id: record.id }
        : { ...details, op: 'record_proposition' })
    }}>
      <h2>{title}</h2>
      <p className="muted">{holder.name}</p>
      <EntryPicker label="Subject" entries={entries} initial={subjectId}
        onChange={(id) => { setSubject(id); setField('status') }} />
      {field && <>
        <label className="field">Field<select value={fieldKey} onChange={(event) => setField(event.target.value)}>
          {eligible.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select></label>
        <ValueInput key={subjectId + ':' + fieldKey} name="value" field={field} entries={entries} entryId={subjectId}
          initial={record?.subject_id === subjectId && record.field === fieldKey ? record.value : undefined} />
        <QualifierInput key={'qualifier-' + fieldKey} name="qualifier" field={field} entries={entries} initial={record?.qualifier_id} />
      </>}
      <div className="wiki-form-row">
        <TimeInput name="from_tick" label="Effective from" day={record?.from_tick ?? at} />
        <TimeInput name="until_tick" label="Effective until (optional)" day={record?.until_tick ?? undefined} optional />
        <TimeInput name="about_tick" label="About time (optional)" day={record?.about_tick ?? undefined} optional />
      </div>
      {!goal && <label className="field">Evidence (optional)
        <select name="evidence" defaultValue={record?.evidence_id ?? ''}>
          <option value="">No recorded evidence</option>
          {evidence.map((observation) => <option key={observation.id} value={observation.id}>
            {entries.find((candidate) => candidate.id === observation.entry_id)?.name ?? 'Record'} · {fields.find((candidate) => candidate.key === observation.field)?.label}
            {' · Learned at ' + observation.learned_at}
          </option>)}
        </select>
      </label>}
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={record?.source} /></label>
      <label className="wiki-checkbox"><input type="checkbox" name="author_only" defaultChecked={record?.author_only} /> Author only</label>
      <Actions {...actions} submit={'Save ' + noun} />
    </form>
  )
}

export function WikiCalendarForm({ daysPerYear, ...actions }: FormActions & { daysPerYear: number | null }) {
  return (
    <form className="wiki-form" aria-label="World calendar" onSubmit={(event) => {
      event.preventDefault()
      actions.onSave({ op: 'set_calendar', days_per_year: optionalTime(new FormData(event.currentTarget), 'days') })
    }}>
      <h2>World calendar</h2>
      <p className="muted">Set the year length in world days to calculate ages from recorded birth times.</p>
      <label className="field">Days per year<input name="days" type="number" min={1} max={1000000} step={1}
        defaultValue={daysPerYear ?? undefined} /></label>
      <Actions {...actions} submit="Save calendar" />
    </form>
  )
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
