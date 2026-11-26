import { type FormEvent, useState } from 'react'
import { type DraftSource, type Entry, type EntryKind, type Link, type LinkKind, type Visibility, entryKinds, linkKinds } from './draft-api'
import { Choices, Pick, authorityChoices, factChoices, ruleChoices, textValue, titleChoices, values, visibilityLabel } from './scenario-fields'

export { visibilityLabel } from './scenario-fields'

export const entryLabel: Record<EntryKind, string> = {
  place: 'Place', actor: 'Character', item: 'Item', role: 'Role',
}

export const linkLabel: Record<LinkKind, string> = {
  affiliation: 'Affiliation', located_in: 'Located in', owns: 'Owns', carries: 'Carries', requires: 'Requires',
}

export function entryName(entry: Entry) {
  return entry.name ?? 'Untitled ' + entryLabel[entry.kind].toLowerCase()
}

export function entryOption(entry: Entry, entries: Entry[]) {
  const name = entryName(entry)
  const duplicate = entries.some((other) => other.id !== entry.id && entryName(other) === name)
  return name + ' · ' + entryLabel[entry.kind] + (duplicate ? ' · ' + entry.id.slice(0, 8) : '')
}

function VisibilityField({ value, onChange, incomplete = false }: {
  value: Visibility | ''
  onChange: (value: Visibility | '') => void
  incomplete?: boolean
}) {
  return (
    <div className="field">
      <label htmlFor="draft-visibility">Visibility</label>
      <select id="draft-visibility" value={value} onChange={(event) => onChange(event.target.value as Visibility | '')}>
        {incomplete && <option value="">Choose later</option>}
        {Object.entries(visibilityLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </div>
  )
}

export function EntryForm({ record, entries, source, disabled, onSave, onClose }: {
  record?: Entry
  entries: Entry[]
  source: DraftSource
  disabled: boolean
  onSave: (entry: Entry) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<EntryKind>(record?.kind ?? 'place')
  const [name, setName] = useState(record?.name ?? '')
  const [visibility, setVisibility] = useState<Visibility | ''>(record ? record.visibility ?? '' : 'author')
  const [description, setDescription] = useState(record?.description ?? '')
  const [archetype, setArchetype] = useState(record?.archetype ?? '')
  const [role, setRole] = useState(record?.role_id ?? '')
  const [parent, setParent] = useState(record?.parent_place_id === null ? 'none' : record?.parent_place_id ?? '')
  const [behavior, setBehavior] = useState(record?.policy?.mode ?? '')
  const [id] = useState(() => record?.id ?? crypto.randomUUID())
  const playableRules = ruleChoices(source.rules).filter((choice) => source.rules[choice.value].template !== 'progress')
  const alarm = record?.policy?.mode === 'alarm_move' ? record.policy : undefined

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const value: Entry = { ...record, id, kind }
    delete value.name
    delete value.visibility
    if (name.trim()) value.name = name.trim()
    if (visibility) value.visibility = visibility
    if (kind === 'item' || kind === 'role') {
      delete value.description
      if (description.trim()) value.description = description.trim()
      if (kind === 'role') value.authority = values(data, 'authority')
    }
    if (kind === 'actor') {
      delete value.archetype
      delete value.role_id
      if (archetype.trim()) value.archetype = archetype.trim()
      if (role) value.role_id = role
      delete value.policy
      if (behavior === 'hold') value.policy = { mode: 'hold' }
      if (behavior === 'alarm_move') value.policy = {
        mode: 'alarm_move', stimulus_fact_id: textValue(data, 'stimulus'),
        destination_point_id: textValue(data, 'destination'), move_rule_id: textValue(data, 'move_rule'),
      }
    }
    if (kind === 'actor' || kind === 'item') {
      const grants = values(data, 'rules')
      delete value.action_rule_ids
      if (kind === 'item' || grants.length) value.action_rule_ids = grants
    }
    if (kind === 'place') {
      delete value.parent_place_id
      if (parent) value.parent_place_id = parent === 'none' ? null : parent
    }
    onSave(value)
  }

  return (
    <form className="draft-form" onSubmit={submit} aria-label={record ? 'Edit entry' : 'Add entry'}>
      <fieldset disabled={disabled}>
        <div className="field">
          <label htmlFor="entry-type">Entry type</label>
          <select id="entry-type" value={kind} disabled={Boolean(record)} onChange={(event) => setKind(event.target.value as EntryKind)}>
            {entryKinds.map((option) => <option key={option} value={option}>{entryLabel[option]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="entry-name">Name</label>
          <input id="entry-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
        </div>
        <VisibilityField value={visibility} onChange={setVisibility} incomplete />
        {kind === 'place' && (
          <div className="field">
            <label htmlFor="entry-parent">Parent place</label>
            <select id="entry-parent" value={parent} onChange={(event) => setParent(event.target.value)}>
              <option value="">Choose later</option>
              <option value="none">No parent</option>
              {entries.filter((item) => item.kind === 'place' && item.id !== id).map((item) => (
                <option key={item.id} value={item.id}>{entryOption(item, entries)}</option>
              ))}
            </select>
          </div>
        )}
        {kind === 'actor' && (
          <>
            <div className="field">
              <label htmlFor="entry-archetype">Archetype</label>
              <input id="entry-archetype" value={archetype} onChange={(event) => setArchetype(event.target.value)} maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="entry-role">Role</label>
              <select id="entry-role" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="">Choose later</option>
                {entries.filter((item) => item.kind === 'role').map((item) => (
                  <option key={item.id} value={item.id}>{entryOption(item, entries)}</option>
                ))}
              </select>
            </div>
            <Pick label="Behavior" name="behavior" empty="Choose later" required={false} value={behavior}
              options={[{ value: 'hold', label: 'Hold position' }, { value: 'alarm_move', label: 'Move to alarm on a stimulus' }]}
              onChange={(value) => setBehavior(value as typeof behavior)} />
            {behavior === 'alarm_move' && (
              <>
                <Pick label="Stimulus fact" name="stimulus" options={factChoices(source.facts)} empty="Select a fact" value={alarm?.stimulus_fact_id} />
                <Pick label="Alarm point" name="destination" empty="Select a point" value={alarm?.destination_point_id}
                  options={titleChoices(Object.values(source.layout?.points ?? {}).map(({ id, label }) => ({ value: id, label })))} />
                <Pick label="Movement rule" name="move_rule" options={ruleChoices(source.rules, 'move')} empty="Select a rule" value={alarm?.move_rule_id} />
              </>
            )}
          </>
        )}
        {(kind === 'item' || kind === 'role') && (
          <div className="field">
            <label htmlFor="entry-description">Description</label>
            <textarea id="entry-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} />
          </div>
        )}
        {(kind === 'actor' || kind === 'item') && <Choices key={kind} legend="Granted action rules" name="rules" options={playableRules} selected={record?.action_rule_ids} />}
        {kind === 'role' && <Choices legend="Role authority" name="authority" options={authorityChoices} selected={record?.authority} />}
        <div className="form-actions">
          <button className="button primary" type="submit">Save entry</button>
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </form>
  )
}

export function LinkForm({ source, entries, disabled, onSave, onClose }: {
  source: Entry
  entries: Entry[]
  disabled: boolean
  onSave: (link: Link) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<LinkKind>('located_in')
  const [target, setTarget] = useState('')
  const [visibility, setVisibility] = useState<Visibility | ''>('author')
  const [id] = useState(() => crypto.randomUUID())
  const targets = entries.filter((entry) => entry.id !== source.id && (kind !== 'located_in' || entry.kind === 'place'))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (target && visibility) onSave({ id, kind, visibility, from_id: source.id, to_id: target })
  }

  return (
    <form className="draft-form" onSubmit={submit} aria-label="Add link">
      <fieldset disabled={disabled}>
        <div className="field">
          <label htmlFor="link-type">Relationship</label>
          <select id="link-type" value={kind} onChange={(event) => { setKind(event.target.value as LinkKind); setTarget('') }}>
            {linkKinds.map((option) => <option key={option} value={option}>{linkLabel[option]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="link-target">Link to</label>
          <select id="link-target" value={target} onChange={(event) => setTarget(event.target.value)} required>
            <option value="">Select an entry</option>
            {targets.map((entry) => <option key={entry.id} value={entry.id}>{entryOption(entry, entries)}</option>)}
          </select>
        </div>
        <VisibilityField value={visibility} onChange={setVisibility} />
        <div className="form-actions">
          <button className="button primary" type="submit">Save link</button>
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </form>
  )
}
