import { type ReactNode } from 'react'
import { type DraftSource, type Edit, type EditValue, type EntryKind, type Fact, type Issue, type Rule, type RuleTemplate, type Visibility, actionKinds } from './draft-api'

export const visibilityLabel: Record<Visibility, string> = {
  author: 'Author only', observed: 'Discovered during play', public: 'Public within the world',
}

export const ruleLabel: Record<RuleTemplate, string> = {
  search: 'Search', report: 'Report', move: 'Move', cast: 'Cast',
  progress: 'Progression', allocate: 'Allocate points', wait: 'Wait',
}

export type Choice = { value: string; label: string }
export const visibilityChoices = Object.entries(visibilityLabel).map(([value, label]) => ({ value, label }))
export const authorityChoices = actionKinds.map((value) => ({ value, label: ruleLabel[value] }))

export function entryChoices(source: DraftSource, kind?: EntryKind) {
  const entries = Object.values(source.entities)
  return titleChoices(entries.filter((entry) => !kind || entry.kind === kind).map((entry) => ({
    value: entry.id, label: entry.name || 'Untitled ' + (entry.kind === 'actor' ? 'character' : entry.kind),
  })))
}

export function titleChoices(choices: Choice[]) {
  const counts = new Map<string, number>()
  for (const { label } of choices) counts.set(label, (counts.get(label) ?? 0) + 1)
  return choices.map(({ value, label }) => ({
    value, label: counts.get(label)! > 1 ? label + ' · ' + value.slice(0, 8) : label,
  })).sort((first, second) => first.label.localeCompare(second.label) || first.value.localeCompare(second.value))
}

export function factChoices(facts: Record<string, Fact>) {
  return titleChoices(Object.values(facts).map((fact) => ({
    value: fact.id,
    label: fact.predicate.replaceAll('_', ' ') + ' · ' + (fact.kind === 'claim' ? 'Claim' : 'Truth') + ' · tick ' + fact.effective_from_tick,
  })))
}

export function ruleChoices(rules: Record<string, Rule>, template?: RuleTemplate) {
  return titleChoices(Object.values(rules).filter((rule) => !template || rule.template === template).map((rule) => ({
    value: rule.id, label: rule.name || ruleLabel[rule.template],
  })))
}

export function audienceChoices(source: DraftSource) {
  return [{ value: 'party', label: 'Party' }, ...entryChoices(source, 'actor').map(({ value, label }) => ({
    value: 'actor:' + value, label,
  }))]
}

export function Pick({ label, name, options, value, empty, required = true, onChange }: {
  label: string; name: string; options: Choice[]; value?: string; empty?: string
  required?: boolean; onChange?: (value: string) => void
}) {
  const selection = onChange ? { value: value ?? '', onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value) }
    : { defaultValue: value ?? '' }
  return (
    <label className="field">
      {label}
      <select name={name} required={required} {...selection}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

export function Choices({ legend, name, options, selected = [], onChange }: {
  legend: string; name: string; options: Choice[]; selected?: string[]; onChange?: (values: string[]) => void
}) {
  return (
    <fieldset className="choice-field">
      <legend>{legend}</legend>
      {options.length === 0 ? <p className="muted">None available</p> : (
        <div className="choice-grid">
          {options.map(({ value, label }) => (
            <label key={value}>
              <input type="checkbox" name={name} value={value} {...(onChange ? {
                checked: selected.includes(value),
                onChange: (event) => onChange(event.target.checked ? [...selected, value] : selected.filter((id) => id !== value)),
              } : { defaultChecked: selected.includes(value) })} />
              {label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

export function NumberField({ label, name, value, min, max, step = 1, required = true }: {
  label: string; name: string; value?: number | null; min?: number; max?: number; step?: number; required?: boolean
}) {
  return <label className="field">{label}<input name={name} type="number" defaultValue={value ?? ''} min={min} max={max} step={step} required={required} /></label>
}

export function Coordinate({ label, name, cm }: { label: string; name: string; cm?: number }) {
  return <NumberField label={label + ' (m)'} name={name} value={cm === undefined ? 0 : cm / 100} min={-1_000_000} max={1_000_000} step={0.01} />
}

export function textValue(data: FormData, name: string) {
  return String(data.get(name) ?? '')
}

export function values(data: FormData, name: string) {
  return data.getAll(name).map(String)
}

export function centimeters(data: FormData, name: string) {
  return Math.round(Number(textValue(data, name)) * 100)
}

export function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false
  if (Array.isArray(first) !== Array.isArray(second)) return false
  const a = first as Record<string, unknown>, b = second as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}

export function draftValue(source: DraftSource, pointer: string): unknown {
  return pointer.slice(1).split('/').reduce<unknown>(
    (value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, source,
  )
}

export function recordEdits<T extends EditValue>(prefix: string, before: Record<string, T>, after: Record<string, T>): Edit[] {
  const edits: Edit[] = []
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const pointer = prefix + '/' + id
    if (!(id in after)) edits.push({ op: 'remove', pointer })
    else if (!(id in before)) edits.push({ op: 'add', pointer, value: after[id] })
    else if (!sameValue(before[id], after[id])) edits.push({ op: 'set', pointer, value: after[id] })
  }
  return edits
}

export function RecordRows({ rows, onEdit, onRemove, disabled }: {
  rows: { id: string; label: string; detail?: ReactNode }[]
  onEdit?: (id: string) => void; onRemove?: (id: string) => void; disabled: boolean
}) {
  return (
    <ul className="draft-list scenario-records">
      {rows.map(({ id, label, detail }) => (
        <li key={id} className="draft-link-row">
          <div><strong>{label}</strong>{detail && <div className="muted">{detail}</div>}</div>
          {(onEdit || onRemove) && (
            <div className="inline-actions">
              {onEdit && <button type="button" className="button secondary" aria-label={'Edit ' + label} disabled={disabled} onClick={() => onEdit(id)}>Edit</button>}
              {onRemove && <button type="button" className="button secondary" aria-label={'Remove ' + label} disabled={disabled} onClick={() => onRemove(id)}>Remove</button>}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function WorkspaceActions({ caption, edits, disabled, ready = true, onSave, onDiscard }: {
  caption: string; edits: Edit[]; disabled: boolean; ready?: boolean; onSave: () => void; onDiscard: () => void
}) {
  return (
    <div className="scenario-actions">
      <div className="inline-actions">
        <button className="button primary" type="button" disabled={disabled || !ready || edits.length === 0 || edits.length > 40} onClick={onSave}>{caption}</button>
        {edits.length > 0 && <button className="button secondary" type="button" disabled={disabled} onClick={onDiscard}>Discard staged changes</button>}
      </div>
      {edits.length > 40 && <p className="error-message" role="alert">A save can include up to 40 changes. Reduce this group before saving.</p>}
      {edits.length > 0 && <span className="muted">{edits.length} staged {edits.length === 1 ? 'change' : 'changes'}</span>}
    </div>
  )
}

export function ScenarioIssues({ problems, prefix }: { problems: Issue[]; prefix: string }) {
  const visible = problems.filter(({ pointer }) => pointer?.startsWith(prefix))
  return visible.length > 0 && (
    <details className="draft-checks">
      <summary>Before publication</summary>
      <ul>{visible.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
    </details>
  )
}
