import { useEffect, useState } from 'react'
import { type Audience, type Draft, type DraftSource, type Edit, type Rule, type RuleTemplate, type WorkspaceRecovery } from './draft-api'
import { Choices, NumberField, Pick, RecordRows, ScenarioIssues, audienceChoices, centimeters, entryChoices, factChoices, ruleChoices, ruleLabel, textValue, values } from './scenario-fields'

function ruleFromForm(id: string, template: RuleTemplate, data: FormData): Rule {
  const base = { id, name: textValue(data, 'name').trim(), rule_version: 1 as const }
  const number = (name: string) => Number(textValue(data, name))
  switch (template) {
    case 'search': return { ...base, template, parameters: { site_id: textValue(data, 'site'), discovery_fact_ids: values(data, 'discoveries') } }
    case 'report': return { ...base, template, parameters: { audiences: values(data, 'audiences') as Audience[] } }
    case 'move': return { ...base, template, parameters: { maximum_cm: centimeters(data, 'distance'), focus_cost: number('focus') } }
    case 'cast': return { ...base, template, parameters: {
      range_cm: centimeters(data, 'distance'), focus_cost: number('focus'), hit_min_d20: number('hit'), damage: number('damage'),
      target_role_id: textValue(data, 'role'), on_attempt_fact_id: textValue(data, 'stimulus') || null,
    } }
    case 'progress': return { ...base, template, parameters: {
      xp_award: number('xp'), unlock_at_xp: number('threshold'), points: number('points'), unlock_level: number('level'),
      class_key: textValue(data, 'class'), unlock_rule_id: textValue(data, 'unlock'),
    } }
    case 'allocate':
    case 'wait': return { ...base, template, parameters: {} }
  }
}

function RuleFields({ template, record, source }: { template: RuleTemplate; record?: Rule; source: DraftSource }) {
  if (template === 'search') {
    const p = record?.template === 'search' ? record.parameters : undefined
    return (
      <>
        <Pick label="Search site" name="site" options={entryChoices(source, 'place')} empty="Select a place" value={p?.site_id} />
        <Choices legend="Discoverable facts" name="discoveries" options={factChoices(source.facts)} selected={p?.discovery_fact_ids} />
      </>
    )
  }
  if (template === 'report') {
    return <Choices legend="Report audiences" name="audiences" options={audienceChoices(source)}
      selected={record?.template === 'report' ? record.parameters?.audiences : ['party']} />
  }
  if (template === 'move' || template === 'cast') {
    const p = record?.template === template ? record.parameters : undefined
    const distance = p && ('maximum_cm' in p ? p.maximum_cm : p.range_cm)
    const cast = p && 'hit_min_d20' in p ? p : undefined
    return (
      <>
        <div className="scenario-field-grid">
          <NumberField label={template === 'move' ? 'Maximum distance (m)' : 'Range (m)'} name="distance"
            value={distance === undefined ? (template === 'move' ? 6 : 3) : distance / 100} min={0.01} max={100} step={0.01} />
          <NumberField label="Focus cost" name="focus" value={p?.focus_cost ?? (template === 'move' ? 0 : 1)} min={0} max={100} />
        </div>
        {template === 'cast' && (
          <>
            <div className="scenario-field-grid">
              <NumberField label="Minimum d20 hit" name="hit" value={cast?.hit_min_d20 ?? 12} min={1} max={20} />
              <NumberField label="Damage" name="damage" value={cast?.damage ?? 3} min={1} max={1000} />
            </div>
            <Pick label="Target role" name="role" options={entryChoices(source, 'role')} empty="Select a role" value={cast?.target_role_id} />
            <Pick label="On-attempt fact" name="stimulus" options={factChoices(source.facts)} empty="None" required={false} value={cast?.on_attempt_fact_id ?? ''} />
          </>
        )}
      </>
    )
  }
  if (template === 'progress') {
    const p = record?.template === 'progress' ? record.parameters : undefined
    return (
      <>
        <div className="scenario-field-grid">
          <NumberField label="XP award" name="xp" value={p?.xp_award ?? 2} min={1} max={1000} />
          <NumberField label="XP to unlock" name="threshold" value={p?.unlock_at_xp ?? 10} min={1} max={1_000_000} />
          <NumberField label="Unspent points awarded" name="points" value={p?.points ?? 2} min={1} max={20} />
          <NumberField label="Level after unlock" name="level" value={p?.unlock_level ?? 5} min={1} max={100} />
        </div>
        <label className="field">Class key<input name="class" defaultValue={p?.class_key} required maxLength={64} pattern="[a-z][a-z0-9_]{0,63}" placeholder="warden" /></label>
        <Pick label="Rule to unlock" name="unlock" options={ruleChoices(source.rules).filter(({ value }) => source.rules[value].template !== 'progress')}
          empty="Select a rule" value={p?.unlock_rule_id} />
      </>
    )
  }
  return null
}

function RuleForm({ record, source, disabled, onSave, onCancel }: {
  record?: Rule; source: DraftSource; disabled: boolean; onSave: (record: Rule) => void; onCancel: () => void
}) {
  const [template, setTemplate] = useState<RuleTemplate>(record?.template ?? 'move')
  const [id] = useState(() => record?.id ?? crypto.randomUUID())
  return (
    <form className="draft-form" aria-label="Rule setup" onSubmit={(event) => {
      event.preventDefault()
      onSave(ruleFromForm(id, template, new FormData(event.currentTarget)))
    }}>
      <fieldset disabled={disabled}>
        {record ? <p className="muted">{ruleLabel[template]} · Version {record.rule_version}</p> : (
          <Pick label="Rule template" name="template" options={Object.entries(ruleLabel).map(([value, label]) => ({ value, label }))}
            value={template} onChange={(value) => setTemplate(value as RuleTemplate)} />
        )}
        <label className="field">Rule name<input name="name" defaultValue={record?.name} required maxLength={100} /></label>
        <RuleFields key={template} template={template} record={record} source={source} />
        <div className="form-actions">
          <button className="button primary" type="submit">Save rule</button>
          <button className="button secondary" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  )
}

function describeRule(rule: Rule) {
  if (!rule.parameters) return 'Parameters unset'
  switch (rule.template) {
    case 'move': return rule.parameters.maximum_cm / 100 + ' m · ' + rule.parameters.focus_cost + ' Focus'
    case 'cast': return rule.parameters.range_cm / 100 + ' m · ' + rule.parameters.focus_cost + ' Focus · ' + rule.parameters.damage + ' damage'
    case 'search': return rule.parameters.discovery_fact_ids.length + ' discoverable facts'
    case 'report': return rule.parameters.audiences.length + ' allowed audiences'
    case 'progress': return rule.parameters.xp_award + ' XP awarded · Level ' + rule.parameters.unlock_level + ' unlock'
    default: return 'Version ' + rule.rule_version
  }
}

export function DraftRules({ draft, recovery, editable, disabled, onBusy, onSave }: {
  draft: Draft; editable: boolean; disabled: boolean; onBusy: (busy: boolean) => void
  recovery?: WorkspaceRecovery
  onSave: (edits: Edit[], baseline: DraftSource) => void
}) {
  const [panel, setPanel] = useState<{ id?: string; prefill?: Rule; base: DraftSource } | null>(() => {
    const edit = recovery?.edits[0]
    if (!recovery || !edit || edit.op === 'remove') return null
    const id = edit.pointer.split('/').at(-1)!
    return { id: edit.op === 'set' ? id : undefined, prefill: recovery.source.rules[id], base: recovery.base }
  })
  const busy = panel !== null
  useEffect(() => { onBusy(busy) }, [busy, onBusy])
  const rules = draft.source.rules
  const options = ruleChoices(rules)
  const canOpen = !disabled && !panel
  return (
    <div className="scenario-columns">
      <section className="draft-sheet" aria-label="Action rules">
        <div className="draft-entry-heading">
          <h2>Rules</h2>
          {editable && <button className="button secondary" type="button" disabled={!canOpen} onClick={() => setPanel({ base: draft.source })}>Add rule</button>}
        </div>
        {options.length ? <RecordRows disabled={!canOpen} rows={options.map(({ value, label }) => ({
          id: value, label, detail: ruleLabel[rules[value].template] + ' · ' + describeRule(rules[value]),
        }))} onEdit={editable ? (id) => setPanel({ id, base: draft.source }) : undefined} onRemove={editable ? (id) => {
          if (window.confirm('Remove this rule from the draft?')) onSave([{ op: 'remove', pointer: '/rules/' + id }], draft.source)
        } : undefined} /> : <p className="muted">No rules yet.</p>}
        <ScenarioIssues problems={draft.problems} prefix="/rules" />
      </section>
      {panel && (
        <section className="draft-sheet" aria-label="Rule details">
          <h2>{panel.id ? 'Edit rule' : 'New rule'}</h2>
          <RuleForm key={panel.id ?? 'new'} record={panel.prefill ?? (panel.id ? panel.base.rules[panel.id] : undefined)} source={draft.source} disabled={disabled || !editable}
            onCancel={() => setPanel(null)} onSave={(rule) => onSave([{ op: panel.id ? 'set' : 'add', pointer: '/rules/' + rule.id, value: rule }], panel.base)} />
        </section>
      )}
    </div>
  )
}
