import { useEffect, useRef, useState } from 'react'
import { type Bounds, type Draft, type DraftSource, type Edit, type Fact, type FactValue, type Layout, type LayoutEdge, type LayoutPoint, type Visibility, type WorkspaceRecovery } from './draft-api'
import {
  type Choice, Choices, Coordinate, NumberField, Pick, RecordRows, ScenarioIssues, WorkspaceActions,
  centimeters, entryChoices, factChoices, recordEdits, ruleChoices, sameValue, textValue, titleChoices, values, visibilityChoices,
} from './scenario-fields'

type Panel = { kind: 'frame' } | { kind: 'room' | 'point' | 'edge' | 'fact'; id: string }
type RoomBounds = Record<string, Bounds | undefined>

function roomBounds(source: DraftSource): RoomBounds {
  return Object.fromEntries(Object.values(source.entities).filter((entry) => entry.kind === 'place').map((entry) => [entry.id, entry.bounds]))
}

function blankLayout(): Layout {
  return { frame_id: crypto.randomUUID(), unit: 'cm', origin: { x_cm: 0, y_cm: 0 }, grid_cm: 100, points: {}, edges: {} }
}

function without<T>(records: Record<string, T>, id: string) {
  const updated = { ...records }
  delete updated[id]
  return updated
}

function drawMap(surface: HTMLCanvasElement, layout: Layout | null, rooms: RoomBounds) {
  const ctx = surface.getContext('2d')
  const width = surface.clientWidth
  if (!ctx || width < 80) return
  const height = Math.round(width * 2 / 3)
  const density = Math.min(2, window.devicePixelRatio || 1)
  surface.width = Math.round(width * density)
  surface.height = Math.round(height * density)
  ctx.setTransform(density, 0, 0, density, 0, 0)
  const rectangles = Object.values(rooms).filter((bounds) => bounds !== undefined)
  const points = Object.values(layout?.points ?? {})
  const xs = [...rectangles.flatMap((room) => [room.x_min_cm, room.x_max_cm]), ...points.map((point) => point.at.x_cm)]
  const ys = [...rectangles.flatMap((room) => [room.y_min_cm, room.y_max_cm]), ...points.map((point) => point.at.y_cm)]
  const left = Math.min(0, ...xs), right = Math.max(100, ...xs)
  const bottom = Math.min(0, ...ys), top = Math.max(100, ...ys)
  const scale = Math.min((width - 56) / (right - left), (height - 46) / (top - bottom))
  const x = (value: number) => width / 2 + scale * (value - (left + right) / 2)
  const y = (value: number) => height / 2 - scale * (value - (bottom + top) / 2)

  ctx.clearRect(0, 0, width, height)
  for (const room of rectangles) {
    const w = scale * (room.x_max_cm - room.x_min_cm), h = scale * (room.y_max_cm - room.y_min_cm)
    ctx.fillStyle = '#e1e9fc'
    ctx.strokeStyle = '#93a6d0'
    ctx.lineWidth = 1.5
    ctx.fillRect(x(room.x_min_cm), y(room.y_max_cm), w, h)
    ctx.strokeRect(x(room.x_min_cm), y(room.y_max_cm), w, h)
  }
  const grid = (layout?.grid_cm ?? 100) * scale
  if (grid >= 13) {
    ctx.strokeStyle = '#8ca1c629'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let px = x(layout?.origin.x_cm ?? 0) % grid; px < width; px += grid) {
      ctx.moveTo(px, 0)
      ctx.lineTo(px, height)
    }
    for (let py = y(layout?.origin.y_cm ?? 0) % grid; py < height; py += grid) {
      ctx.moveTo(0, py)
      ctx.lineTo(width, py)
    }
    ctx.stroke()
  }
  for (const edge of Object.values(layout?.edges ?? {})) {
    const from = layout?.points[edge.from_point_id], to = layout?.points[edge.to_point_id]
    if (!from || !to) continue
    ctx.beginPath()
    ctx.strokeStyle = edge.traversable ? '#28539c' : '#8a5762'
    ctx.setLineDash(edge.required_fact_id || !edge.traversable ? [7, 4] : [])
    ctx.lineWidth = 2.5
    ctx.moveTo(x(from.at.x_cm), y(from.at.y_cm))
    ctx.lineTo(x(to.at.x_cm), y(to.at.y_cm))
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.font = '12px system-ui, sans-serif'
  const labels: { left: number; right: number; top: number; bottom: number }[] = []
  for (const point of points) {
    const px = x(point.at.x_cm), py = y(point.at.y_cm)
    ctx.beginPath()
    ctx.fillStyle = point.visibility === 'public' ? '#173e85' : '#795794'
    ctx.arc(px, py, 4, 0, 2 * Math.PI)
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#f7faff'
    const labelWidth = Math.min(ctx.measureText(point.label).width, 106)
    for (const [left, baseline] of [[px + 7, py - 7], [px + 7, py + 18], [px - labelWidth - 7, py - 7], [px - labelWidth - 7, py + 18]]) {
      const box = { left, right: left + labelWidth, top: baseline - 12, bottom: baseline + 2 }
      if (box.left < 3 || box.right > width - 3 || box.top < 3 || box.bottom > height - 3) continue
      if (labels.some((other) => box.left < other.right + 4 && box.right + 4 > other.left && box.top < other.bottom && box.bottom > other.top)) continue
      labels.push(box)
      ctx.strokeText(point.label, left, baseline, 106)
      ctx.fillText(point.label, left, baseline, 106)
      break
    }
  }
}

function MapPreview({ layout, rooms }: { layout: Layout | null; rooms: RoomBounds }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current
    if (!surface) return
    const draw = () => drawMap(surface, layout, rooms)
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(surface, { box: 'border-box' })
    return () => observer.disconnect()
  }, [layout, rooms])

  return (
    <figure className="map-preview">
      <canvas ref={canvas} width={720} height={480} role="img" aria-label="Map preview of authored room bounds, points, and paths" />
      <figcaption className="muted">Dashed paths are conditional or blocked. Coordinates use meters.</figcaption>
    </figure>
  )
}

function FactFields({ fact, subjects, references, actors }: {
  fact?: Fact; subjects: Choice[]; references: Choice[]; actors: Choice[]
}) {
  const [kind, setKind] = useState(fact?.kind ?? 'truth')
  const [valueKind, setValueKind] = useState(fact?.value.kind ?? 'boolean')
  const value = fact?.value.kind === valueKind ? fact.value.value : undefined
  return (
    <>
      {fact ? (
        <><p className="muted">{fact.kind === 'truth' ? 'Verified truth' : 'Attributed claim'}</p><input type="hidden" name="kind" value={fact.kind} /></>
      ) : (
        <Pick label="Fact type" name="kind" options={[{ value: 'truth', label: 'Verified truth' }, { value: 'claim', label: 'Attributed claim' }]}
          value={kind} onChange={(next) => setKind(next as Fact['kind'])} />
      )}
      <Pick label="Subject" name="subject" options={subjects} empty="Select a subject" value={fact?.subject_id} />
      {kind === 'claim' && <Pick label="Claimant" name="claimant" options={actors} empty="Select a character" value={fact?.kind === 'claim' ? fact.claimant_id : ''} />}
      <label className="field">Predicate<input name="predicate" defaultValue={fact?.predicate} required maxLength={64} pattern="[a-z][a-z0-9_]{0,63}" placeholder="gate_open" /></label>
      <Pick label="Value type" name="value_kind" value={valueKind} onChange={(next) => setValueKind(next as FactValue['kind'])}
        options={[
          { value: 'boolean', label: 'True or false' }, { value: 'integer', label: 'Whole number' },
          { value: 'text', label: 'Text' }, { value: 'reference', label: 'One record' }, { value: 'references', label: 'Multiple records' },
        ]} />
      {valueKind === 'boolean' && <Pick label="Value" name="value" options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} value={String(value ?? true)} />}
      {valueKind === 'integer' && <NumberField label="Value" name="value" value={typeof value === 'number' ? value : 0} min={-2147483648} max={2147483647} />}
      {valueKind === 'text' && <label className="field">Value<textarea name="value" defaultValue={typeof value === 'string' ? value : ''} rows={3} maxLength={500} required /></label>}
      {valueKind === 'reference' && <Pick label="Value" name="value" options={references} empty="Select a record" value={typeof value === 'string' ? value : ''} />}
      {valueKind === 'references' && <Choices legend="Value records" name="value" options={references} selected={Array.isArray(value) ? value : []} />}
      <div className="scenario-field-grid">
        <NumberField label="Effective from tick" name="from_tick" value={fact?.effective_from_tick ?? 0} min={0} max={Number.MAX_SAFE_INTEGER} />
        <NumberField label="Effective until tick" name="until_tick" value={fact?.effective_until_tick} min={1} max={Number.MAX_SAFE_INTEGER} required={false} />
      </div>
      <Pick label="Visibility" name="visibility" options={visibilityChoices} value={fact?.visibility ?? 'author'} />
      <Choices legend="Source references" name="sources" options={references} selected={fact?.source_ref_ids} />
    </>
  )
}

function factValue(data: FormData): FactValue {
  const value = textValue(data, 'value')
  switch (textValue(data, 'value_kind')) {
    case 'boolean': return { kind: 'boolean', value: value === 'true' }
    case 'integer': return { kind: 'integer', value: Number(value) }
    case 'references': return { kind: 'references', value: values(data, 'value') }
    case 'reference': return { kind: 'reference', value }
    default: return { kind: 'text', value }
  }
}

const boundFields = [
  ['x_min_cm', 'Minimum X'], ['y_min_cm', 'Minimum Y'], ['x_max_cm', 'Maximum X'], ['y_max_cm', 'Maximum Y'],
] as const

export function DraftLayout({ draft, recovery, editable, disabled, onBusy, onSave }: {
  draft: Draft; editable: boolean; disabled: boolean; onBusy: (busy: boolean) => void
  recovery?: WorkspaceRecovery
  onSave: (edits: Edit[], baseline: DraftSource) => void
}) {
  const [base, setBase] = useState(recovery?.base ?? draft.source)
  const startingSource = recovery?.source ?? base
  const [layout, setLayout] = useState(startingSource.layout)
  const [rooms, setRooms] = useState(() => roomBounds(startingSource))
  const [facts, setFacts] = useState(startingSource.facts)
  const [panel, setPanel] = useState<Panel | null>(null)
  const activePanel = useRef<HTMLElement>(null)
  const edits = recordEdits('/facts', base.facts, facts)
  for (const [id, bounds] of Object.entries(rooms)) {
    const prior = base.entities[id]?.bounds
    if (!sameValue(prior, bounds)) {
      const pointer = '/entities/' + id + '/bounds'
      edits.push(bounds ? { op: prior ? 'set' : 'add', pointer, value: bounds } : { op: 'remove', pointer })
    }
  }
  if (!sameValue(base.layout, layout)) edits.push({ op: 'set', pointer: '/layout', value: layout })
  const busy = Boolean(panel) || edits.length > 0
  useEffect(() => {
    onBusy(busy)
  }, [busy, onBusy])
  useEffect(() => { if (panel) activePanel.current?.focus() }, [panel])

  const points = layout?.points ?? {}, edges = layout?.edges ?? {}
  const places = entryChoices(draft.source, 'place')
  const pointOptions = titleChoices(Object.values(points).map((point) => ({ value: point.id, label: point.label })))
  const edgeName = (edge: LayoutEdge) => (points[edge.from_point_id]?.label ?? 'Missing point') + ' ↔ ' + (points[edge.to_point_id]?.label ?? 'Missing point')
  const knownFacts = factChoices(facts)
  const entryOptions = entryChoices(draft.source)
  const references = titleChoices([
    ...entryOptions, ...pointOptions.map((point) => ({ ...point, label: 'Point · ' + point.label })),
    ...Object.values(edges).map((edge) => ({ value: edge.id, label: 'Path · ' + edgeName(edge) })),
    ...Object.values(draft.source.links).map(({ id, kind, from_id, to_id }) => ({
      value: id,
      label: 'Link · ' + (draft.source.entities[from_id]?.name ?? 'Entry') + ' ' + kind.replaceAll('_', ' ') +
        ' ' + (draft.source.entities[to_id]?.name ?? 'Entry'),
    })),
    ...ruleChoices(draft.source.rules).map((rule) => ({ ...rule, label: 'Rule · ' + rule.label })),
    ...knownFacts,
  ])
  const annotation = (choices: Choice[], id: string) => choices.find((choice) => choice.value === id)?.label ?? 'Unavailable'
  const locked = disabled || !editable
  const point = panel?.kind === 'point' ? points[panel.id] : undefined
  const edge = panel?.kind === 'edge' ? edges[panel.id] : undefined
  const fact = panel?.kind === 'fact' ? facts[panel.id] : undefined

  function stage(data: FormData) {
    if (!panel) return
    switch (panel.kind) {
      case 'frame':
        if (layout) setLayout({
          ...layout, grid_cm: Number(textValue(data, 'grid')),
          origin: { x_cm: centimeters(data, 'x'), y_cm: centimeters(data, 'y') },
        })
        break
      case 'room': {
        const bounds = Object.fromEntries(boundFields.map(([key]) => [key, centimeters(data, key)])) as Bounds
        setRooms({ ...rooms, [panel.id]: bounds })
        break
      }
      case 'point': {
        if (!layout) return
        const record: LayoutPoint = {
          id: panel.id, label: textValue(data, 'point_name').trim(), place_id: textValue(data, 'place'),
          at: { x_cm: centimeters(data, 'x'), y_cm: centimeters(data, 'y') },
          visibility: textValue(data, 'visibility') as Visibility,
        }
        setLayout({ ...layout, points: { ...points, [record.id]: record } })
        break
      }
      case 'edge': {
        if (!layout) return
        const record: LayoutEdge = {
          id: panel.id, from_point_id: textValue(data, 'from'), to_point_id: textValue(data, 'to'),
          traversable: data.has('traversable'), required_fact_id: textValue(data, 'required_fact') || null,
        }
        setLayout({ ...layout, edges: { ...edges, [record.id]: record } })
        break
      }
      case 'fact': {
        const until = textValue(data, 'until_tick')
        const record: Fact = {
          id: panel.id, subject_id: textValue(data, 'subject'), predicate: textValue(data, 'predicate').trim(),
          value: factValue(data), effective_from_tick: Number(textValue(data, 'from_tick')),
          effective_until_tick: until ? Number(until) : null, visibility: textValue(data, 'visibility') as Visibility,
          source_ref_ids: values(data, 'sources'),
          ...(textValue(data, 'kind') === 'claim' ? { kind: 'claim', claimant_id: textValue(data, 'claimant') } : { kind: 'truth' }),
        }
        setFacts({ ...facts, [record.id]: record })
        break
      }
    }
    setPanel(null)
  }

  const formTitle = panel ? { frame: 'Layout settings', room: 'Room bounds', point: 'Map point', edge: 'Path', fact: 'Fact or claim' }[panel.kind] : undefined
  const canOpen = !locked && panel === null
  return (
    <div className="scenario-workspace">
      {editable && <WorkspaceActions caption="Save layout and facts" edits={edits} disabled={disabled || Boolean(panel)}
        onSave={() => onSave(edits, base)} onDiscard={() => {
          setBase(draft.source)
          setRooms(roomBounds(draft.source))
          setLayout(draft.source.layout)
          setFacts(draft.source.facts)
        }} />}
      <div className="scenario-columns">
        <div className="scenario-stack">
          <section className="draft-sheet" aria-label="Dungeon layout">
            <div className="draft-entry-heading">
              <h2>Layout</h2>
              {editable && (layout
                ? <button type="button" className="button secondary" disabled={!canOpen} onClick={() => setPanel({ kind: 'frame' })}>Layout settings</button>
                : <button type="button" className="button secondary" disabled={!canOpen} onClick={() => setLayout(blankLayout())}>Set up layout</button>)}
            </div>
            {!layout && Object.values(rooms).every((bounds) => !bounds)
              ? <p className="muted">Set room bounds and add points to preview your map.</p>
              : <MapPreview layout={layout} rooms={rooms} />}
            <ScenarioIssues problems={draft.problems} prefix="/layout" />
          </section>
          <section className="draft-sheet" aria-label="Rooms">
            <h2>Room bounds</h2>
            {places.length ? <RecordRows disabled={!canOpen} rows={places.map(({ value, label }) => ({
              id: value, label, detail: rooms[value]
                ? '(' + rooms[value]!.x_min_cm / 100 + ', ' + rooms[value]!.y_min_cm / 100 + ') to (' +
                  rooms[value]!.x_max_cm / 100 + ', ' + rooms[value]!.y_max_cm / 100 + ') m'
                : 'Bounds unset',
            }))} onEdit={editable ? (id) => setPanel({ kind: 'room', id }) : undefined} />
              : <p className="muted">Add a place in Entries first.</p>}
          </section>
          <section className="draft-sheet" aria-label="Map points">
            <div className="draft-entry-heading">
              <h2>Points</h2>
              {editable && <button type="button" className="button secondary" disabled={!canOpen || !layout || places.length === 0}
                onClick={() => setPanel({ kind: 'point', id: crypto.randomUUID() })}>Add point</button>}
            </div>
            {pointOptions.length ? <RecordRows disabled={!canOpen} rows={pointOptions.map(({ value, label }) => ({
              id: value, label, detail: annotation(places, points[value].place_id) + ' · ' + points[value].at.x_cm / 100 + ', ' + points[value].at.y_cm / 100 + ' m',
            }))} onEdit={editable ? (id) => setPanel({ kind: 'point', id }) : undefined}
            onRemove={editable && layout ? (id) => setLayout({ ...layout, points: without(points, id) }) : undefined} />
              : <p className="muted">No map points yet.</p>}
          </section>
          <section className="draft-sheet" aria-label="Paths">
            <div className="draft-entry-heading">
              <h2>Paths</h2>
              {editable && <button type="button" className="button secondary" disabled={!canOpen || !layout || pointOptions.length < 2}
                onClick={() => setPanel({ kind: 'edge', id: crypto.randomUUID() })}>Add path</button>}
            </div>
            {Object.keys(edges).length ? <RecordRows disabled={!canOpen} rows={Object.values(edges).map((record) => ({
              id: record.id, label: edgeName(record), detail: [
                record.traversable ? 'Traversable' : 'Blocked',
                record.required_fact_id ? 'Requires ' + annotation(knownFacts, record.required_fact_id) : '',
              ].filter(Boolean).join(' · '),
            }))} onEdit={editable ? (id) => setPanel({ kind: 'edge', id }) : undefined}
              onRemove={editable && layout ? (id) => setLayout({ ...layout, edges: without(edges, id) }) : undefined} />
              : <p className="muted">No paths yet.</p>}
          </section>
        </div>
        <div className="scenario-stack scenario-side">
          {panel && (
            <section ref={activePanel} tabIndex={-1} className="draft-sheet" aria-label={formTitle}>
              <h2>{formTitle}</h2>
              <form className="draft-form" aria-label={formTitle} key={panel.kind + ('id' in panel ? panel.id : '')}
                onSubmit={(event) => { event.preventDefault(); stage(new FormData(event.currentTarget)) }}>
                <fieldset disabled={locked}>
                  {panel.kind === 'frame' && layout && (
                    <>
                      <Coordinate label="Origin X" name="x" cm={layout.origin.x_cm} />
                      <Coordinate label="Origin Y" name="y" cm={layout.origin.y_cm} />
                      <NumberField label="Grid size (cm)" name="grid" value={layout.grid_cm} min={1} max={500} />
                    </>
                  )}
                  {panel.kind === 'room' && (
                    <>
                      <p>{annotation(places, panel.id)}</p>
                      <div className="scenario-field-grid">
                        {boundFields.map(([key, label]) => <Coordinate key={key} label={label} name={key} cm={rooms[panel.id]?.[key]} />)}
                      </div>
                    </>
                  )}
                  {panel.kind === 'point' && (
                    <>
                      <label className="field">Point name<input name="point_name" defaultValue={point?.label} required maxLength={100} /></label>
                      <Pick label="Room" name="place" options={places} empty="Select a room" value={point?.place_id} />
                      <div className="scenario-field-grid">
                        <Coordinate label="X" name="x" cm={point?.at.x_cm} />
                        <Coordinate label="Y" name="y" cm={point?.at.y_cm} />
                      </div>
                      <Pick label="Visibility" name="visibility" options={visibilityChoices} value={point?.visibility ?? 'author'} />
                    </>
                  )}
                  {panel.kind === 'edge' && (
                    <>
                      <Pick label="From point" name="from" options={pointOptions} empty="Select a point" value={edge?.from_point_id} />
                      <Pick label="To point" name="to" options={pointOptions} empty="Select a point" value={edge?.to_point_id} />
                      <label className="check-option"><input name="traversable" type="checkbox" defaultChecked={edge?.traversable ?? true} /> Traversable</label>
                      <Pick label="Required fact" name="required_fact" options={knownFacts} empty="None" value={edge?.required_fact_id ?? ''} required={false} />
                    </>
                  )}
                  {panel.kind === 'fact' && <FactFields fact={fact} actors={entryChoices(draft.source, 'actor')}
                    subjects={references} references={references} />}
                  <div className="form-actions">
                    <button type="submit" className="button primary">Stage {panel.kind === 'edge' ? 'path' : panel.kind === 'room' ? 'bounds' : panel.kind === 'frame' ? 'settings' : panel.kind}</button>
                    {panel.kind === 'room' && rooms[panel.id] && <button type="button" className="button secondary"
                      onClick={() => { setRooms({ ...rooms, [panel.id]: undefined }); setPanel(null) }}>Clear bounds</button>}
                    <button type="button" className="button secondary" onClick={() => setPanel(null)}>Cancel</button>
                  </div>
                </fieldset>
              </form>
            </section>
          )}
          <section className="draft-sheet" aria-label="Facts and claims">
            <div className="draft-entry-heading">
              <h2>Facts and claims</h2>
              {editable && <button type="button" className="button secondary" disabled={!canOpen || references.length === 0}
                onClick={() => setPanel({ kind: 'fact', id: crypto.randomUUID() })}>Add fact or claim</button>}
            </div>
            {knownFacts.length ? <RecordRows disabled={!canOpen} rows={knownFacts.map(({ value, label }) => ({
              id: value, label, detail: [
                annotation(references, facts[value].subject_id),
                facts[value].value.kind === 'references' ? facts[value].value.value.length + ' references'
                  : facts[value].value.kind === 'reference' ? annotation(references, String(facts[value].value.value)) : String(facts[value].value.value),
              ].join(' · '),
            }))} onEdit={editable ? (id) => setPanel({ kind: 'fact', id }) : undefined} onRemove={editable ? (id) => setFacts(without(facts, id)) : undefined} />
              : <p className="muted">No facts or claims yet.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
