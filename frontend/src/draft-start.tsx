import { useEffect, useRef, useState } from 'react'
import { type ActorStart, type Audience, type Draft, type DraftSource, type Edit, type InitialObservation, type StartState, type WorkspaceRecovery, ranks } from './draft-api'
import { type Choice, Choices, NumberField, Pick, RecordRows, ScenarioIssues, WorkspaceActions, entryChoices, factChoices, ruleChoices, sameValue, textValue, titleChoices, values } from './scenario-fields'

const stats = [
  ['hp', 'HP', 1, 0, 1000], ['hp_max', 'Maximum HP', 1, 1, 1000],
  ['focus', 'Focus', 0, 0, 100], ['focus_max', 'Maximum Focus', 0, 0, 100],
  ['xp', 'XP', 0, 0, 1_000_000], ['level', 'Level', 1, 1, 100], ['unspent_points', 'Unspent points', 0, 0, 100],
] as const
const attributes = ['strength', 'agility', 'perception'] as const

function blankStart(): StartState {
  return {
    tick: 0, controlled_player_id: '', scout_ids: [], sentry_id: '', progress_rule_id: '',
    encounter_id: crypto.randomUUID(), actors: {}, item_positions: {}, initial_observations: [],
  }
}

type Panel = { kind: 'actor'; id?: string } | { kind: 'item' | 'observation' }

function ActorFields({ actor, points, rules }: { actor?: ActorStart; points: Choice[]; rules: Choice[] }) {
  return (
    <>
      <Pick label="Starting point" name="point" options={points} empty="Select a point" value={actor?.point_id} />
      <div className="scenario-field-grid">
        {stats.map(([field, label, initial, min, max]) => (
          <NumberField key={field} label={label} name={field} value={actor?.[field] ?? initial} min={min} max={max} />
        ))}
        <Pick label="Rank" name="rank" options={ranks.map((value) => ({ value, label: value }))} value={actor?.rank ?? 'F'} />
        <label className="field">Class key<input name="class" defaultValue={actor?.class_key ?? 'none'}
          required maxLength={64} pattern="[a-z][a-z0-9_]{0,63}" /></label>
      </div>
      <div className="scenario-field-grid">
        {attributes.map((field) => <NumberField key={field} label={field[0].toUpperCase() + field.slice(1)}
          name={field} value={actor?.attributes[field] ?? 1} min={0} max={100} />)}
      </div>
      <Choices legend="Extra action rules" name="rules" options={rules} selected={actor?.extra_rule_ids} />
      <div className="inline-actions">
        <label className="check-option"><input type="checkbox" name="occupies" defaultChecked={actor?.occupies ?? true} /> Occupies point</label>
        <label className="check-option"><input type="checkbox" name="defeated" defaultChecked={actor?.statuses.includes('defeated')} /> Defeated</label>
      </div>
    </>
  )
}

function actorFromForm(data: FormData): ActorStart {
  const number = (name: string) => Number(textValue(data, name))
  return {
    point_id: textValue(data, 'point'), hp: number('hp'), hp_max: number('hp_max'),
    focus: number('focus'), focus_max: number('focus_max'), xp: number('xp'), level: number('level'),
    unspent_points: number('unspent_points'), rank: textValue(data, 'rank') as ActorStart['rank'], class_key: textValue(data, 'class'),
    attributes: { strength: number('strength'), agility: number('agility'), perception: number('perception') },
    extra_rule_ids: values(data, 'rules'), occupies: data.has('occupies'), statuses: data.has('defeated') ? ['defeated'] : [],
  }
}

export function DraftStart({ draft, recovery, editable, disabled, onBusy, onSave }: {
  draft: Draft; editable: boolean; disabled: boolean; onBusy: (busy: boolean) => void
  recovery?: WorkspaceRecovery
  onSave: (edits: Edit[], baseline: DraftSource) => void
}) {
  const [base, setBase] = useState(recovery?.base ?? draft.source)
  const [start, setStart] = useState((recovery?.source ?? base).start)
  const [panel, setPanel] = useState<Panel | null>(null)
  const activePanel = useRef<HTMLElement>(null)
  const edits: Edit[] = sameValue(base.start, start) ? [] : [{ op: 'set', pointer: '/start', value: start }]
  const busy = Boolean(panel) || edits.length > 0
  useEffect(() => { onBusy(busy) }, [busy, onBusy])
  useEffect(() => { if (panel) activePanel.current?.focus() }, [panel])

  const points = titleChoices(Object.values(draft.source.layout?.points ?? {}).map(({ id, label }) => ({ value: id, label })))
  const actors = entryChoices(draft.source, 'actor')
  const positioned = actors.filter(({ value }) => start?.actors[value])
  const availableActors = actors.filter(({ value }) => !start?.actors[value])
  const audiences = [{ value: 'party', label: 'Party' }, ...positioned.map(({ value, label }) => ({ value: 'actor:' + value, label }))]
  const items = entryChoices(draft.source, 'item')
  const knownFacts = factChoices(draft.source.facts)
  const progressRules = ruleChoices(draft.source.rules, 'progress')
  const rules = ruleChoices(draft.source.rules).filter(({ value }) => draft.source.rules[value].template !== 'progress')
  const labelOf = (options: Choice[], id: string) => options.find(({ value }) => value === id)?.label ?? 'Unavailable'
  const ready = Boolean(start?.controlled_player_id && start?.sentry_id && start?.progress_rule_id)
  const locked = disabled || !editable
  const canOpen = !locked && panel === null
  const formTitle = panel ? { actor: 'Character setup', item: 'Item placement', observation: 'Initial observation' }[panel.kind] : undefined

  function stage(data: FormData) {
    if (!start || !panel) return
    if (panel.kind === 'actor') {
      const id = panel.id ?? textValue(data, 'actor')
      setStart({ ...start, actors: { ...start.actors, [id]: actorFromForm(data) } })
    } else if (panel.kind === 'item') {
      setStart({ ...start, item_positions: { ...start.item_positions, [textValue(data, 'item')]: textValue(data, 'point') } })
    } else {
      const observation: InitialObservation = { audience: textValue(data, 'audience') as Audience, fact_id: textValue(data, 'fact') }
      if (!start.initial_observations.some(({ audience, fact_id }) => audience === observation.audience && fact_id === observation.fact_id)) {
        setStart({ ...start, initial_observations: [...start.initial_observations, observation] })
      }
    }
    setPanel(null)
  }

  function removeActor(id: string) {
    if (!start) return
    const actors = { ...start.actors }
    delete actors[id]
    setStart({
      ...start, actors,
      controlled_player_id: start.controlled_player_id === id ? '' : start.controlled_player_id,
      sentry_id: start.sentry_id === id ? '' : start.sentry_id,
      scout_ids: start.scout_ids.filter((actor) => actor !== id),
      initial_observations: start.initial_observations.filter(({ audience }) => audience !== 'actor:' + id),
    })
  }

  return (
    <div className="scenario-workspace">
      {editable && start && <WorkspaceActions caption="Save starting state" edits={edits} disabled={disabled || Boolean(panel)} ready={ready}
        onSave={() => onSave(edits, base)} onDiscard={() => { setBase(draft.source); setStart(draft.source.start) }} />}
      <div className="scenario-columns">
        <div className="scenario-stack">
          <section className="draft-sheet" aria-label="Encounter setup">
            <div className="draft-entry-heading">
              <h2>Starting state</h2>
              {editable && !start && <button type="button" className="button secondary" disabled={locked}
                onClick={() => setStart(blankStart())}>Set up starting state</button>}
            </div>
            {!start ? <p className="muted">Set character and item positions, starting stats, and who knows each fact.</p> : editable ? (
              <div className="scenario-form draft-form">
                <fieldset disabled={!canOpen}>
                  <Pick label="Player character" name="player" options={positioned} empty="Select a positioned character"
                    value={start.controlled_player_id} onChange={(value) => setStart({ ...start, controlled_player_id: value })} />
                  <Pick label="Encounter sentry" name="sentry" options={positioned} empty="Select a positioned character"
                    value={start.sentry_id} onChange={(value) => setStart({ ...start, sentry_id: value })} />
                  <Choices legend="Scouts" name="scouts" options={positioned} selected={start.scout_ids}
                    onChange={(scout_ids) => setStart({ ...start, scout_ids })} />
                  <Pick label="Progression rule" name="progress" options={progressRules} empty="Select a progression rule"
                    value={start.progress_rule_id} onChange={(value) => setStart({ ...start, progress_rule_id: value })} />
                  <label className="field">Starting tick<input type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} value={start.tick}
                    onChange={(event) => { if (event.target.validity.valid) setStart({ ...start, tick: Number(event.target.value) }) }} /></label>
                </fieldset>
                {!ready && <p className="muted">Add positioned characters, then select the player, sentry, and progression rule.</p>}
              </div>
            ) : (
              <dl className="draft-meta">
                <dt>Player</dt><dd>{labelOf(actors, start.controlled_player_id)}</dd>
                <dt>Sentry</dt><dd>{labelOf(actors, start.sentry_id)}</dd>
                <dt>Scouts</dt><dd>{start.scout_ids.map((id) => labelOf(actors, id)).join(', ') || 'None'}</dd>
                <dt>Progression</dt><dd>{labelOf(progressRules, start.progress_rule_id)}</dd>
                <dt>Starting tick</dt><dd>{start.tick}</dd>
              </dl>
            )}
            <ScenarioIssues problems={draft.problems} prefix="/start" />
          </section>
          {start && (
            <>
              <section className="draft-sheet" aria-label="Character placements">
                <div className="draft-entry-heading">
                  <h2>Characters</h2>
                  {editable && <button type="button" className="button secondary" disabled={!canOpen || !points.length || !availableActors.length}
                    onClick={() => setPanel({ kind: 'actor' })}>Add character setup</button>}
                </div>
                {positioned.length ? <RecordRows disabled={!canOpen} rows={positioned.map(({ value, label }) => {
                  const state = start.actors[value]
                  return { id: value, label, detail: labelOf(points, state.point_id) + ' · ' + state.hp + '/' + state.hp_max
                    + ' HP · ' + state.focus + '/' + state.focus_max + ' Focus · ' + state.xp + ' XP · Level ' + state.level + ' · Rank ' + state.rank }
                })} onEdit={editable ? (id) => setPanel({ kind: 'actor', id }) : undefined}
                onRemove={editable ? removeActor : undefined} /> : <p className="muted">No starting characters yet.</p>}
              </section>
              <section className="draft-sheet" aria-label="Item placements">
                <div className="draft-entry-heading">
                  <h2>Items</h2>
                  {editable && <button type="button" className="button secondary" disabled={!canOpen || !points.length || !items.length}
                    onClick={() => setPanel({ kind: 'item' })}>Place item</button>}
                </div>
                {Object.keys(start.item_positions).length ? <RecordRows disabled={!canOpen} rows={Object.entries(start.item_positions).map(([id, point]) => ({
                  id, label: labelOf(items, id), detail: labelOf(points, point),
                }))} onRemove={editable ? (id) => {
                  const positions = { ...start.item_positions }
                  delete positions[id]
                  setStart({ ...start, item_positions: positions })
                } : undefined} /> : <p className="muted">No starting items yet.</p>}
              </section>
            </>
          )}
        </div>
        {start && (
          <div className="scenario-stack scenario-side">
            {panel && (
              <section ref={activePanel} tabIndex={-1} className="draft-sheet" aria-label={formTitle}>
                <h2>{formTitle}</h2>
                <form className="draft-form" aria-label={formTitle} key={panel.kind + ('id' in panel ? panel.id : '')}
                  onSubmit={(event) => { event.preventDefault(); stage(new FormData(event.currentTarget)) }}>
                  <fieldset disabled={locked}>
                    {panel.kind === 'actor' && (
                      <>
                        {panel.id ? <p>{labelOf(actors, panel.id)}</p> : <Pick label="Character" name="actor" options={availableActors} empty="Select a character" />}
                        <ActorFields actor={panel.id ? start.actors[panel.id] : undefined} points={points} rules={rules} />
                      </>
                    )}
                    {panel.kind === 'item' && (
                      <>
                        <Pick label="Item" name="item" options={items} empty="Select an item" />
                        <Pick label="Starting point" name="point" options={points} empty="Select a point" />
                      </>
                    )}
                    {panel.kind === 'observation' && (
                      <>
                        <Pick label="Audience" name="audience" options={audiences} value="party" />
                        <Pick label="Known fact" name="fact" options={knownFacts} empty="Select a fact" />
                      </>
                    )}
                    <div className="form-actions">
                      <button type="submit" className="button primary">Stage {panel.kind === 'actor' ? 'character' : panel.kind}</button>
                      <button type="button" className="button secondary" onClick={() => setPanel(null)}>Cancel</button>
                    </div>
                  </fieldset>
                </form>
              </section>
            )}
            <section className="draft-sheet" aria-label="Initial knowledge">
              <div className="draft-entry-heading">
                <h2>Initial knowledge</h2>
                {editable && <button type="button" className="button secondary" disabled={!canOpen || !knownFacts.length}
                  onClick={() => setPanel({ kind: 'observation' })}>Add observation</button>}
              </div>
              {start.initial_observations.length ? <RecordRows disabled={!canOpen} rows={start.initial_observations.map(({ audience, fact_id }, index) => ({
                id: String(index), label: labelOf(audiences, audience) + ' · ' + labelOf(knownFacts, fact_id),
              }))} onRemove={editable ? (index) => setStart({
                ...start, initial_observations: start.initial_observations.filter((_, i) => i !== Number(index)),
              }) : undefined} /> : <p className="muted">No starting observations yet.</p>}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
