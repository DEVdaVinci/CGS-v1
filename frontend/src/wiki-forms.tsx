import { type FormEvent, useEffect, useState } from 'react'
import {
  canPerformEvent, getWiki, isWikiActor, type EventDatePrecision,
  type WikiArticleSection, type WikiAssertion, type WikiClaim, type WikiCommand, type WikiDiscovery, type WikiEntry, type WikiEvent,
  type WikiEntryTemplate, type WikiField, type WikiKind, type WikiLearnedAbility, type WikiObservation, type WikiProposition, type WikiValue,
} from './wiki-api'
import { DistributionInput, formatDistribution } from './wiki-distribution'

export const kindLabel: Record<WikiKind, string> = {
  person: 'Character', place: 'Place', group: 'Group', class: 'Class', ability: 'Ability', item: 'Item',
  species: 'Species', organism: 'Organism', culture: 'Culture', role: 'Role or title',
  resource: 'Resource', body_part: 'Body part', trait: 'Trait', goal: 'Goal',
  image: 'Image', model_3d: '3D model', texture: 'Texture', animation: 'Animation',
  map: 'Map', territory: 'Territory', era: 'Era',
  source: 'Source', process: 'Mental process', skill: 'Skill', milestone: 'Goal milestone',
  requirement: 'Requirement', method: 'Method', status_def: 'Status definition',
}

export type ArticleEdit =
  | { kind: 'fact'; field?: string }
  | { kind: 'claim' | 'event' }
  | { kind: 'rename' | 'overview' | 'sections' }
  | { kind: 'learn'; learned?: WikiLearnedAbility }
  | { kind: 'discovery'; discovery?: WikiDiscovery }
  | { kind: 'edit-event'; event: WikiEvent }
  | { kind: 'correct'; fact: WikiAssertion }
  | { kind: 'correct-claim'; claim: WikiClaim }
  | { kind: 'correct-date'; event: WikiEvent }
  | { kind: 'observe'; source: WikiAssertion | WikiClaim; sourceKind: 'assertion' | 'claim' }
  | { kind: 'proposition'; record?: WikiProposition }

export type FormActions = { onSave: (command: WikiCommand) => void; onCancel: () => void; busy: boolean }
type EntryFormProps = FormActions & {
  entry: WikiEntry; fields: WikiField[]; entries: WikiEntry[]; at: number | null
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

const dimensions = ['height_cm', 'width_cm', 'length_cm', 'mass_kg']
const biography = ['alias', 'birth_tick', 'death_tick', 'birthplace', 'origin', 'species', 'nationality', 'parent', 'sibling']
const entryTemplates: WikiEntryTemplate[] = [...Object.keys(kindLabel) as WikiKind[], 'vehicle']
const initialKeys: Partial<Record<WikiKind, string[]>> = {
  person: [...biography, 'character_class', 'appearance', 'background', ...dimensions],
  organism: [...biography, 'appearance', ...dimensions],
  place: ['place_type', 'located_in'],
  item: ['item_type', 'creation_tick', 'destruction_tick', ...dimensions],
  group: ['group_type'],
  ability: ['ability_type'],
  territory: ['landscape'],
  era: ['era_start', 'era_end'],
  image: ['asset_location'],
  model_3d: ['asset_location'],
  texture: ['asset_location'],
  animation: ['asset_location'],
  map: ['asset_location'],
  resource: ['unit'],
  trait: ['unit'],
  goal: ['goal_owner', 'parent_goal', 'goal_subject', 'goal_mode', 'goal_order', 'priority', 'status'],
  milestone: ['milestone_goal', 'goal_mode', 'milestone_order', 'status'],
  method: ['method_requirement', 'method_order', 'status'],
  role: ['role_duty', 'declared_authority', 'declared_limitation'],
  status_def: ['role_duty', 'declared_authority', 'declared_limitation'],
  source: ['source_medium', 'source_locator', 'source_excerpt', 'source_person'],
}

export function WikiEntryForm({ fixedTemplate, chooser, entries, fields, ownerId, ...actions }: FormActions & {
  fixedTemplate?: WikiEntryTemplate; entries: WikiEntry[]; fields: WikiField[]; ownerId?: string
  chooser?: { label: string; types: WikiEntryTemplate[] }
}) {
  const [template, setTemplate] = useState<WikiEntryTemplate>(fixedTemplate ?? chooser?.types[0] ?? 'person')
  const [dateError, setDateError] = useState(false)
  const kind = template === 'vehicle' ? 'item' : template
  const title = fixedTemplate === 'map' ? 'Add map reference'
    : fixedTemplate === 'vehicle' ? 'New vehicle'
      : fixedTemplate ? 'New ' + kindLabel[fixedTemplate].toLowerCase() : chooser?.label ?? 'New entry'
  const keys = (initialKeys[kind] ?? []).filter((key) => template !== 'vehicle' || key !== 'item_type')
  const initialFields = keys.map((key) => fields.find((field) => field.key === key)).filter((field) => field !== undefined)
  const linkedFields = initialFields.filter((field) => field.many && field.target_kinds.length)

  function initialLabel(field: WikiField) {
    if (field.key === 'located_in' && kind === 'place') return 'Parent place'
    if (field.key === 'parent') return 'Parents'
    if (field.key === 'sibling') return 'Siblings'
    return field.label
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const authorOnly = values.has('author_only')
    const initialValues = initialFields.flatMap((field) => values.getAll(field.key).filter((value) => String(value).trim())
      .map((value) => ({ field: field.key, value: readValue(value, field), author_only: authorOnly })))
    const date = optionalTime(values, 'initial_at')
    if (initialValues.length && date === null) {
      setDateError(true)
      event.currentTarget.querySelector<HTMLInputElement>('[name="initial_at"]')?.focus()
      return
    }
    setDateError(false)
    actions.onSave({
      op: 'create_entry', name: String(values.get('name')), kind,
      author_only: authorOnly, overview: String(values.get('overview') ?? ''),
      ...(template === 'vehicle' ? { catalog_type: 'vehicle' } : {}),
      ...(initialValues.length && date !== null ? { initial_at: date, initial_values: initialValues } : {}),
    })
  }
  return (
    <form className="wiki-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      <label className="field">Entry name<input name="name" maxLength={100} required /></label>
      {!fixedTemplate && <label className="field">Entry type
        <select name="kind" value={template} onChange={(event) => {
          setTemplate(event.target.value as WikiEntryTemplate)
          setDateError(false)
        }}>
          {(chooser?.types ?? entryTemplates).map((item) => (
            <option key={item} value={item}>{item === 'map' ? 'Map reference' : item === 'vehicle' ? 'Vehicle' : kindLabel[item]}</option>
          ))}
        </select>
      </label>}
      <label className="field">Overview<textarea name="overview" rows={4} maxLength={1500} /></label>
      {template === 'map' && <p className="muted">Link an existing map through its asset location. Measured room layouts are edited from Places.</p>}
      {initialFields.length > 0 && <fieldset className="wiki-change-fields" key={template}>
        <legend>Initial facts</legend>
        <TimeInput name="initial_at" label="Initial facts start at time" optional />
        {dateError && <p className="error-message" role="alert">Choose when the initial facts apply.</p>}
        {initialFields.filter((field) => !linkedFields.includes(field)).map((field) => (
          <ValueInput
            key={field.key} field={field} entries={entries} entryId="" name={field.key}
            label={initialLabel(field)}
            initial={field.key === 'goal_owner' ? ownerId : undefined}
            required={false}
          />
        ))}
        {linkedFields.length > 0 && <details className="wiki-event-options">
          <summary>Family and nationality</summary>
          <div className="wiki-event-links">{linkedFields.map((field) => (
            <EntryChoices key={field.key} label={initialLabel(field)} name={field.key} initial={[]}
              entries={entries.filter((entry) => field.target_kinds.includes(entry.kind))} />
          ))}</div>
        </details>}
      </fieldset>}
      <label className="wiki-checkbox"><input type="checkbox" name="author_only" /> Author only</label>
      <Actions {...actions} submit="Save entry" />
    </form>
  )
}

export function TimeInput({ label, name, day, optional = false }: { label: string; name: string; day?: number | null; optional?: boolean }) {
  return (
    <label className="field">{label}
      <input name={name} type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={day ?? undefined} required={!optional} />
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
  if (field.value_kind === 'distribution') {
    return <DistributionInput name={name} label={label} initial={initial} required={required} />
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
      ) : ['description', 'appearance', 'background', 'source_excerpt'].includes(field.key) ? (
        <textarea name={name} rows={3} maxLength={500} defaultValue={initial} required={required} />
      ) : (
        <input name={name} maxLength={500} defaultValue={initial} required={required} />
      )}
    </label>
  )
}

function readValue(value: FormDataEntryValue | null, field: WikiField): WikiValue {
  const text = String(value ?? '')
  return field.value_kind === 'integer' ? Number(text) : text
}

function PersonSelect({ name, label, entries, optional = false }: { name: string; label: string; entries: WikiEntry[]; optional?: boolean }) {
  return <EntryPicker name={name} label={label} entries={entries.filter(isWikiActor)} required={!optional} />
}

export function CitationInput({ entries, initial }: { entries: WikiEntry[]; initial?: string | null }) {
  return <EntryPicker name="citation_id" label="Source article" entries={entries.filter((entry) => entry.kind === 'source')}
    initial={initial ?? undefined} required={false} />
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

function CanonicalForm({ mode, fact, claim, initialField, entry, fields, entries, at, ...actions }: EntryFormProps & {
  mode: 'fact' | 'claim' | 'correct' | 'correct-claim'; fact?: WikiAssertion; claim?: WikiClaim; initialField?: string
}) {
  const record = fact ?? claim
  const isStatement = mode === 'claim' || mode === 'correct-claim'
  const [precision, setPrecision] = useState<EventDatePrecision>(claim?.date_precision ?? 'exact')
  const validFields = fields.filter((field) => field.kinds.includes(entry.kind))
  const [fieldKey, setFieldKey] = useState(record?.field ?? initialField ?? validFields[0].key)
  const field = validFields.find((item) => item.key === fieldKey)!
  const title = fact ? 'Correct value' : claim ? 'Correct claim' : isStatement ? 'Record claim' : 'Record fact'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value = readValue(values.get('value'), field)
    const source = String(values.get('source') ?? '')
    const citation_id = String(values.get('citation_id') ?? '') || null
    const author_only = values.has('author_only')
    const details = { value, author_only, source, citation_id }
    const unit = values.has('bind_unit') ? { bind_unit: true } : {}
    if (fact) return actions.onSave({ op: 'correct_fact', assertion_id: fact.id, ...details, ...unit })
    const dates = {
      date_precision: precision, tick: optionalTime(values, 'tick'),
      start_tick: optionalTime(values, 'statement_start'), end_tick: optionalTime(values, 'statement_end'),
    }
    if (claim) return actions.onSave({ op: 'correct_claim', claim_id: claim.id, ...details, ...dates, ...unit })
    const qualifier = String(values.get('qualifier_id') ?? '')
    const change = {
      entry_id: entry.id, field: field.key, ...details,
      ...(qualifier ? { qualifier_id: qualifier } : {}),
    }
    actions.onSave(isStatement
      ? { ...change, ...dates, op: 'record_claim', speaker_id: String(values.get('speaker_id') ?? '') || null }
      : {
          ...change, op: 'record_fact', from_tick: Number(values.get('from_tick')),
          until_tick: optionalTime(values, 'until_tick'),
        })
  }
  return (
    <form className="wiki-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      {record ? <p className="muted">{field.label}{fact && ' from time ' + fact.from_tick}</p> : (
        <label className="field">Field
          <select value={fieldKey} onChange={(event) => setFieldKey(event.target.value)}>
            {validFields.map((item) => <option key={item.key} value={item.key}>
              {item.key === 'located_in' && entry.kind === 'place' ? 'Parent place' : item.label}
            </option>)}
          </select>
        </label>
      )}
      <ValueInput key={fieldKey} field={field} entries={entries} entryId={entry.id} name="value" initial={record?.value} />
      {!record && <QualifierInput key={'qualifier-' + fieldKey} field={field} entries={entries} name="qualifier_id" />}
      {record?.qualifier_id && <p className="muted">{entries.find((item) => item.id === record.qualifier_id)?.name}</p>}
      {field.uses_unit && (record ? <>
        <p className="muted">{record.unit ? 'Recorded unit is ' + record.unit + '.' : 'This measurement has no recorded unit.'}</p>
        {(!isStatement || precision === 'exact') && <label className="wiki-checkbox">
          <input type="checkbox" name="bind_unit" /> Use the definition’s unit at the record’s date
        </label>}
      </> : <p className="muted">An exact date records the unit from the selected definition.</p>)}
      {mode === 'claim' && <PersonSelect name="speaker_id" label="Speaker" entries={entries} optional />}
      {isStatement && <>
        <label className="field">Statement date precision<select value={precision} onChange={(change) => setPrecision(change.target.value as EventDatePrecision)}>
          <option value="exact">Exact time</option><option value="bounded">Approximate range</option><option value="unknown">Unknown</option>
        </select></label>
        {precision === 'exact' && <TimeInput name="tick" label="Statement time" day={claim ? claim.tick : at} />}
        {precision === 'bounded' && <div className="wiki-form-row">
          <TimeInput name="statement_start" label="Earliest statement time" day={claim?.start_tick} />
          <TimeInput name="statement_end" label="Latest statement time" day={claim?.end_tick} />
        </div>}
      </>}
      {!record && !isStatement && <div className="wiki-form-row">
        <TimeInput name="from_tick" label="Effective from" day={at} />
        <TimeInput name="until_tick" label="Effective until (optional)" optional />
      </div>}
      {mode === 'claim' && <p className="muted">Choose a speaker or cite a source article.</p>}
      <CitationInput entries={entries} initial={record?.citation_id} />
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={record?.source} /></label>
      <label className="wiki-checkbox"><input type="checkbox" name="author_only" defaultChecked={record?.author_only} /> Author only</label>
      <Actions {...actions} submit={record ? 'Save correction' : isStatement ? 'Save claim' : 'Save fact'} />
    </form>
  )
}

export function EntryChoices({ label, name, entries, initial }: {
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

export function readEventContext(values: FormData) {
  return {
    summary: String(values.get('summary') ?? ''), method: String(values.get('method') ?? ''),
    cause_event_ids: values.getAll('cause_events').map(String),
    cause_assertion_ids: values.getAll('cause_assertions').map(String),
    purpose_ids: values.getAll('purposes').map(String), backstory_ids: values.getAll('backstories').map(String),
    era_ids: values.getAll('eras').map(String),
  }
}

export type EventContextProps = {
  worldId: string; entries: WikiEntry[]; fields: WikiField[]; at: number | null; event?: WikiEvent; events?: WikiEvent[]
}

export function EventContextFields({ worldId, entries, fields, at, event, events }: EventContextProps) {
  const [open, setOpen] = useState(false)
  const [timeline, setTimeline] = useState<WikiEvent[]>([])
  const [timelineError, setTimelineError] = useState(false)
  const [subject, setSubject] = useState('')
  const [source, setSource] = useState<{ subject: string; facts: WikiAssertion[]; failed?: boolean }>()
  const [candidate, setCandidate] = useState('')
  const [causes, setCauses] = useState(event?.cause_state ?? [])

  useEffect(() => {
    if (events || !open) return
    const controller = new AbortController()
    void getWiki(worldId, { section: 'timeline', at, viewAs: '', entryId: '' }, controller.signal).then((view) => {
      setTimeline(view.timeline ?? [])
      setTimelineError(false)
    }).catch(() => { if (!controller.signal.aborted) setTimelineError(true) })
    return () => controller.abort()
  }, [worldId, at, events, open])

  useEffect(() => {
    if (!subject) return
    const controller = new AbortController()
    void getWiki(worldId, { at, viewAs: '', entryId: subject }, controller.signal).then((view) => {
      setSource({ subject, facts: view.article?.assertions ?? [] })
    }).catch(() => {
      if (!controller.signal.aborted) setSource({ subject, facts: [], failed: true })
    })
    return () => controller.abort()
  }, [worldId, at, subject])

  const storedCauseEvents = event?.cause_event_ids ?? []
  const eventOptions = (events ?? timeline).filter((item) => item.id !== event?.id)
  const missingEventOptions = storedCauseEvents.filter((id) => !eventOptions.some((item) => item.id === id))
  const sourceOptions = source?.subject === subject
    ? source.facts.filter((fact) => fact.event_id !== event?.id && !causes.some((item) => item.id === fact.id)) : []
  const causeCandidate = sourceOptions.find((fact) => fact.id === candidate)
  const linked = (role: 'purpose' | 'backstory' | 'era') =>
    event?.links.filter((link) => link.role === role).map((link) => link.entry_id) ?? []
  const hasContext = Boolean(storedCauseEvents.length || causes.length || linked('purpose').length
    || linked('backstory').length || linked('era').length)

  function factLabel(fact: WikiAssertion) {
    const definition = fields.find((field) => field.key === fact.field)
    const name = entries.find((item) => item.id === fact.value)?.name
    const qualifier = entries.find((item) => item.id === fact.qualifier_id)?.name
    const value = definition?.value_kind === 'distribution' ? formatDistribution(fact.value) : name ?? fact.value
    return [definition?.label ?? fact.field, qualifier, value, 'from time ' + fact.from_tick].filter((part) => part != null).join(' · ')
  }

  return (
    <>
      <label className="field">Summary<input name="summary" maxLength={500} defaultValue={event?.summary} /></label>
      <label className="field">How<textarea name="method" rows={2} maxLength={1500} defaultValue={event?.method} /></label>
      <details className="wiki-event-options" open={hasContext} onToggle={(toggle) => setOpen(toggle.currentTarget.open)}>
        <summary>Cause, purpose, and context</summary>
        {timelineError && <p className="muted">Cause events could not load. Close and reopen these details to retry.</p>}
        <EntryChoices label="Cause events" name="cause_events" initial={storedCauseEvents}
          entries={[...eventOptions, ...missingEventOptions.map((id) => ({ id, name: 'Saved cause event' }))]} />
        <fieldset className="wiki-change-fields">
          <legend>Cause state</legend>
          <EntryPicker label="Cause state subject" entries={entries} required={false} onChange={(id) => {
            setSubject(id)
            setCandidate('')
          }} />
          {subject && source?.subject !== subject && <p className="muted">Loading dated facts…</p>}
          {subject && source?.subject === subject && source.failed && <p className="muted">Could not load facts for this entry.</p>}
          {subject && source?.subject === subject && !source.failed && (
            <div className="wiki-form-row">
              <label className="field">State fact<select value={candidate} onChange={(change) => setCandidate(change.target.value)}>
                <option value="">{sourceOptions.length ? 'Choose a fact' : 'No other facts available'}</option>
                {sourceOptions.map((fact) => <option key={fact.id} value={fact.id}>{factLabel(fact)}</option>)}
              </select></label>
              <button className="button secondary" type="button" disabled={!causeCandidate || causes.length >= 40}
                onClick={() => {
                  if (causeCandidate) setCauses((items) => [...items, { ...causeCandidate, entry_id: subject }])
                  setCandidate('')
                }}>Add cause state</button>
            </div>
          )}
          {causes.length > 0 && <ul className="wiki-records">{causes.map((fact) => (
            <li className="wiki-record" key={fact.id}>
              <input type="hidden" name="cause_assertions" value={fact.id} />
              <span>{entries.find((item) => item.id === fact.entry_id)?.name} · {factLabel(fact)}</span>
              <button className="button secondary" type="button"
                onClick={() => setCauses((items) => items.filter((item) => item.id !== fact.id))}>Remove cause state</button>
            </li>
          ))}</ul>}
        </fieldset>
        <div className="wiki-event-links">
          <EntryChoices label="Purpose goals" name="purposes" entries={entries.filter((entry) => entry.kind === 'goal')} initial={linked('purpose')} />
          <EntryChoices label="Backstory of" name="backstories" entries={entries} initial={linked('backstory')} />
          <EntryChoices label="Eras" name="eras" entries={entries.filter((entry) => entry.kind === 'era')} initial={linked('era')} />
        </div>
      </details>
    </>
  )
}

export function WikiEventForm({ worldId, entry, fields, entries, at, event, events, parents = [], parentId, action, ...actions }: Omit<EntryFormProps, 'entry'> & {
  worldId: string; events?: WikiEvent[]
  entry?: WikiEntry; event?: WikiEvent; parents?: WikiEvent[]; parentId?: string; action?: boolean
}) {
  const [rows, setRows] = useState(entry ? [{ id: 0, entryId: entry.id, field: 'status' }] : [])
  const [nextId, setNextId] = useState(1)
  const [ability, setAbility] = useState(event?.ability_use?.ability_id ?? '')
  const [precision, setPrecision] = useState<EventDatePrecision>(event?.date_precision ?? 'exact')
  const canChangePrecision = !entry && !event?.changes.length
  const title = event ? 'Edit event details' : entry ? 'Record dated change' : action ? 'Record action' : 'New event'
  const fieldsFor = (id: string) => fields.filter((field) => {
    const kind = entries.find((item) => item.id === id)?.kind
    return kind !== undefined && field.kinds.includes(kind)
  })

  function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault()
    const values = new FormData(submission.currentTarget)
    const details = {
      ...readEventContext(values), name: String(values.get('name')), source: String(values.get('source') ?? ''),
      citation_id: String(values.get('citation_id') ?? '') || null,
      description: String(values.get('description') ?? ''),
      participant_ids: values.getAll('participants').map(String),
      performer_ids: values.getAll('performers').map(String),
      target_ids: values.getAll('targets').map(String),
      place_ids: values.getAll('places').map(String), item_ids: values.getAll('items').map(String),
      ability_use: ability ? { ability_id: ability, actor_id: String(values.get('actor_id')) } : null,
      start_tick: optionalTime(values, 'start_tick'), end_tick: optionalTime(values, 'end_tick'),
    }
    const date = { tick: precision === 'exact' ? optionalTime(values, 'tick') : null, date_precision: precision }
    if (event) {
      actions.onSave({ ...details, ...(canChangePrecision ? date : {}), op: 'edit_event', event_id: event.id })
    } else {
      const changes = rows.map((row) => {
        const qualifier = String(values.get('qualifier-' + row.id) ?? '')
        const mode = String(values.get('mode-' + row.id)) as 'set' | 'add' | 'end'
        return {
          entry_id: row.entryId, field: row.field,
          value: readValue(values.get('value-' + row.id), fields.find((field) => field.key === row.field)!),
          author_only: values.has('author-only-' + row.id), mode,
          ...(qualifier ? { qualifier_id: qualifier } : {}),
        }
      })
      const parent = parents.length ? String(values.get('parent_id') ?? '') : parentId
      actions.onSave({
        ...details, ...date, op: 'record_event', changes,
        ...(parent ? { parent_id: parent } : {}), ...(action ? { node_kind: 'action' } : {}),
      })
    }
  }
  return (
    <form className="wiki-form wiki-event-form" aria-label={title} onSubmit={submit}>
      <h2>{title}</h2>
      <div className="wiki-form-row">
        <label className="field">Event name<input name="name" maxLength={120} defaultValue={event?.name} required /></label>
        {canChangePrecision && <label className="field">Date precision
          <select value={precision} disabled={rows.length > 0} onChange={(change) => setPrecision(change.target.value as EventDatePrecision)}>
            <option value="exact">Exact time</option><option value="bounded">Approximate range</option><option value="unknown">Unknown</option>
          </select>
        </label>}
      </div>
      {precision === 'exact' && (event && !canChangePrecision
        ? <p className="muted">Effective at time {event.tick}</p>
        : <TimeInput name="tick" label="Event time" day={event ? event.tick : at} />)}
      {!event && parents.length > 0 && <EntryPicker name="parent_id" label="Parent event (optional)"
        entries={parents} initial={parentId} required={false} />}
      {precision === 'exact' && <details className="wiki-event-options" open={event?.date_precision === 'exact' && (event.start_tick !== null || event.end_tick !== null)}>
        <summary>Event duration</summary>
        <div className="wiki-form-row">
          <TimeInput name="start_tick" label="Start time (optional)" day={event?.date_precision === 'exact' ? event.start_tick : null} optional />
          <TimeInput name="end_tick" label="End time (optional)" day={event?.date_precision === 'exact' ? event.end_tick : null} optional />
        </div>
      </details>}
      {precision === 'bounded' && <div className="wiki-form-row">
        <TimeInput name="start_tick" label="Earliest possible time" day={event?.date_precision === 'bounded' ? event.start_tick : null} />
        <TimeInput name="end_tick" label="Latest possible time" day={event?.date_precision === 'bounded' ? event.end_tick : null} />
      </div>}
      {precision !== 'exact' && <p className="muted">State changes require an exact effective time.</p>}
      <label className="field">What happened<textarea name="description" rows={3} maxLength={1500} defaultValue={event?.description} /></label>
      <EventContextFields worldId={worldId} entries={entries} fields={fields} at={at} event={event} events={events} />
      <details className="wiki-event-options" open={!entry || Boolean(event)}>
        <summary>Performers, participants, places, and items</summary>
        <EntryChoices label="Performed by" name="performers" entries={entries.filter(canPerformEvent)}
          initial={event?.links.filter((link) => link.role === 'performer').map((link) => link.entry_id) ?? []} />
        <EntryChoices label="Targets" name="targets" entries={entries}
          initial={event?.links.filter((link) => link.role === 'target').map((link) => link.entry_id) ?? []} />
        <div className="wiki-event-links">
          <EntryChoices label="Participants" name="participants" entries={entries.filter((e) => isWikiActor(e) || e.kind === 'group')}
            initial={event?.links.filter((link) => link.role === 'participant').map((link) => link.entry_id) ?? []} />
          <EntryChoices label="Places" name="places" entries={entries.filter((e) => e.kind === 'place')}
            initial={event?.links.filter((link) => link.role === 'place').map((link) => link.entry_id) ?? []} />
          <EntryChoices label="Items" name="items" entries={entries.filter((e) => e.kind === 'item')}
            initial={event?.links.filter((link) => link.role === 'item').map((link) => link.entry_id) ?? []} />
        </div>
      </details>
      {entries.some((item) => item.kind === 'ability') && (
        <details className="wiki-event-options" open={Boolean(event?.ability_use)}>
          <summary>Ability used</summary>
          <div className="wiki-form-row">
            <EntryPicker label="Ability definition" entries={entries.filter((e) => e.kind === 'ability')}
              initial={ability} required={false} onChange={setAbility} />
            {ability && <EntryPicker name="actor_id" label="Used by" entries={entries.filter(isWikiActor)}
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
      {!event && precision === 'exact' && entries.length > 0 && rows.length < 40 && (
        <button className="button secondary wiki-add-change" type="button" onClick={() => {
          const available = entry && fieldsFor(entry.id).find((field) => !rows.some((row) => row.field === field.key))
          setRows([...rows, { id: nextId, entryId: entry?.id ?? '', field: available?.key ?? (entry ? 'status' : '') }])
          setNextId(nextId + 1)
        }}>{rows.length ? 'Add another change' : 'Add a state change'}</button>
      )}
      <CitationInput entries={entries} initial={event?.citation_id} />
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={event?.source} /></label>
      <Actions {...actions} submit={event ? 'Save event details' : entry ? 'Save dated change' : action ? 'Save action' : 'Save event'} />
    </form>
  )
}

export function WikiEvidenceForm({ edit, entries, at, ...actions }: FormActions & {
  edit: Extract<ArticleEdit, { kind: 'correct-date' | 'observe' }>; entries: WikiEntry[]; at: number | null
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
        day={edit.kind === 'correct-date' ? edit.event.tick : at === null ? null
          : Math.max(at, 'from_tick' in edit.source ? edit.source.from_tick : edit.source.tick ?? edit.source.start_tick ?? 0)}
      />
      {edit.kind === 'observe' && <TimeInput name="about_tick" label="About time (optional)" optional />}
      <Actions {...actions} submit={date ? 'Save corrected date' : 'Save observation'} />
    </form>
  )
}

export function WikiEditForm({ edit, overview, sections, ...props }: EntryFormProps & {
  edit: ArticleEdit; worldId: string; overview?: string; sections?: WikiArticleSection[]
}) {
  if (edit.kind === 'event') return <WikiEventForm {...props} />
  if (edit.kind === 'edit-event') return <WikiEventForm {...props} entry={undefined} event={edit.event} />
  if (edit.kind === 'correct-date' || edit.kind === 'observe') return <WikiEvidenceForm {...props} edit={edit} />
  if (edit.kind === 'rename') return <RenameForm {...props} />
  if (edit.kind === 'overview') return <OverviewForm {...props} overview={overview} />
  if (edit.kind === 'sections') return <ArticleSectionsForm {...props} initial={sections ?? []} />
  if (edit.kind === 'learn') return <LearnAbilityForm {...props} learned={edit.learned} />
  if (edit.kind === 'discovery') return <DiscoveryForm {...props} discovery={edit.discovery} />
  if (edit.kind === 'correct') return <CanonicalForm {...props} mode="correct" fact={edit.fact} />
  if (edit.kind === 'correct-claim') return <CanonicalForm {...props} mode="correct-claim" claim={edit.claim} />
  if (edit.kind === 'proposition') return <PropositionForm {...props} record={edit.record} />
  return <CanonicalForm {...props} mode={edit.kind} initialField={edit.kind === 'fact' ? edit.field : undefined} />
}

function DiscoveryForm({ entry, entries, discovery, ...actions }: EntryFormProps & { discovery?: WikiDiscovery }) {
  const title = discovery ? 'Edit discovery' : 'Record discovery'
  return (
    <form className="wiki-form" aria-label={title} onSubmit={(event) => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      actions.onSave({
        op: 'set_discovery', entry_id: entry.id,
        observer_id: discovery?.observer_id ?? String(values.get('observer_id')),
        learned_at: Number(values.get('learned_at')), source: String(values.get('source') ?? ''),
      })
    }}>
      <h2>{title}</h2>
      <p className="muted">Record when a character learned that {entry.name} exists.</p>
      {discovery
        ? <p>{entries.find((item) => item.id === discovery.observer_id)?.name}</p>
        : <EntryPicker name="observer_id" label="Observer" entries={entries.filter((item) => item.id !== entry.id && isWikiActor(item))} />}
      <TimeInput name="learned_at" label="Learned at" day={discovery?.learned_at} />
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={discovery?.source} /></label>
      <Actions {...actions} submit="Save discovery" />
      {discovery && <button className="button secondary" type="button" disabled={actions.busy}
        onClick={() => actions.onSave({
          op: 'set_discovery', entry_id: entry.id, observer_id: discovery.observer_id, learned_at: null, source: '',
        })}>Remove explicit discovery</button>}
    </form>
  )
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
  const goal = holder.kind === 'goal' || holder.kind === 'milestone'
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
        holder_id: holder.id, entry_id: subjectId, field: field.key, value: readValue(data.get('value'), field),
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
    <form className="wiki-form" aria-label="Calendar settings" onSubmit={(event) => {
      event.preventDefault()
      actions.onSave({ op: 'set_calendar', days_per_year: optionalTime(new FormData(event.currentTarget), 'days') })
    }}>
      <h2>Calendar settings</h2>
      <p className="muted">Set the number of world days in a year for age calculations.</p>
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

function OverviewForm({ entry, overview, ...actions }: FormActions & { entry: WikiEntry; overview?: string }) {
  return (
    <form className="wiki-form" aria-label="Edit overview" onSubmit={(event) => {
      event.preventDefault()
      actions.onSave({
        op: 'update_overview', entry_id: entry.id, overview: String(new FormData(event.currentTarget).get('overview') ?? ''),
      })
    }}>
      <h2>Edit overview</h2>
      <label className="field">Overview<textarea name="overview" rows={5} maxLength={1500} defaultValue={overview} /></label>
      <Actions {...actions} submit="Save overview" />
    </form>
  )
}

function ArticleSectionsForm({ entry, initial, ...actions }: FormActions & { entry: WikiEntry; initial: WikiArticleSection[] }) {
  const [sections, setSections] = useState(initial)

  function update(id: string, field: 'heading' | 'body', value: string) {
    setSections((current) => current.map((section) => section.id === id ? { ...section, [field]: value } : section))
  }

  function move(from: number, to: number) {
    setSections((current) => {
      const next = [...current]
      const [section] = next.splice(from, 1)
      next.splice(to, 0, section)
      return next
    })
  }

  return (
    <form className="wiki-form" aria-label="Edit article sections" onSubmit={(event) => {
      event.preventDefault()
      if (!actions.busy) actions.onSave({ op: 'update_article_sections', entry_id: entry.id, sections })
    }}>
      <h2>Edit article sections</h2>
      <p className="muted">Use sections for the article’s prose. Use History to record dated facts and events.</p>
      {sections.map((section, index) => (
        <fieldset className="wiki-change-fields" key={section.id} disabled={actions.busy}>
          <legend>Section {index + 1}</legend>
          <label className="field">Section heading
            <input required maxLength={120} value={section.heading} onChange={(event) => update(section.id, 'heading', event.target.value)} />
          </label>
          <label className="field">Section text
            <textarea rows={5} maxLength={8000} value={section.body} onChange={(event) => update(section.id, 'body', event.target.value)} />
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={index === 0}
              aria-label={'Move section ' + (index + 1) + ' up'} onClick={() => move(index, index - 1)}>Move up</button>
            <button type="button" className="button secondary" disabled={index === sections.length - 1}
              aria-label={'Move section ' + (index + 1) + ' down'} onClick={() => move(index, index + 1)}>Move down</button>
            <button type="button" className="button secondary" aria-label={'Remove section ' + (index + 1)}
              onClick={() => setSections((current) => current.filter((item) => item.id !== section.id))}>Remove</button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="button secondary" disabled={actions.busy || sections.length >= 20}
        onClick={() => setSections((current) => [...current, { id: crypto.randomUUID(), heading: '', body: '' }])}>Add section</button>
      <Actions {...actions} submit="Save sections" />
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
