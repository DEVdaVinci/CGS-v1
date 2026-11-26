import { useState } from 'react'
import { type WikiConnection, type WikiEntry, type WikiPlaceLayout, type WikiWaypoint } from './wiki-api'
import { Actions, EntryPicker, optionalTime, TimeInput, type FormActions } from './wiki-forms'

export type LayoutEdit =
  | { kind: 'layout' }
  | { kind: 'waypoint'; point?: WikiWaypoint }
  | { kind: 'connection'; connection?: WikiConnection }

export function isLayoutEdit(edit: { kind: string }): edit is LayoutEdit {
  return edit.kind === 'layout' || edit.kind === 'waypoint' || edit.kind === 'connection'
}

function dimension(value: number) {
  return (value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' m'
}

export function WikiLayoutPanel({ layout, entries, onEdit, onOpen }: {
  layout: WikiPlaceLayout; entries: WikiEntry[]; onEdit?: (edit: LayoutEdit) => void; onOpen: (id: string) => void
}) {
  const { frame, connections } = layout
  const aspect = frame ? frame.width_cm / frame.height_cm : 1
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const framesByPlace = new Map(layout.available.map((item) => [item.place_id, item]))

  function endpoint(place: string, id: string) {
    const point = framesByPlace.get(place)?.points.find((item) => item.id === id)
    const entry = entriesById.get(place)
    return entry ? <button type="button" className="wiki-reference" onClick={() => onOpen(place)}>
      {entry.name}{point ? ' · ' + point.name : ''}
    </button> : null
  }

  return (
    <section className="wiki-block" aria-label="Place layout">
      <header className="wiki-card-heading">
        <h2>Layout</h2>
        {onEdit && <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'layout' })}>
          {frame ? 'Edit layout' : 'Add layout'}
        </button>}
      </header>
      {frame ? <>
        <p className="muted">{frame.name} · {dimension(frame.width_cm)} × {dimension(frame.height_cm)}
          {' · From time ' + frame.from_tick}</p>
        <figure className="wiki-plan">
          <div className="wiki-plan-drawing" style={{ aspectRatio: aspect, maxWidth: Math.min(360 * aspect, 704) }}
            role="img" aria-label={'Measured plan for ' + frame.name}>
            {frame.points.map((point) => (
              <span key={point.id} className="wiki-plan-marker" title={point.name}
                style={{ left: ((point.x_cm - frame.left_cm) / frame.width_cm) * 100 + '%',
                  top: ((point.y_cm - frame.top_cm) / frame.height_cm) * 100 + '%' }}>
                <span className="wiki-plan-marker-name">{point.name}</span>
              </span>
            ))}
          </div>
          <figcaption className="muted">Origin at {dimension(frame.left_cm)}, {dimension(frame.top_cm)}</figcaption>
        </figure>
        <div className="wiki-card-heading">
          <h3>Waypoints</h3>
          {onEdit && <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'waypoint' })}>Add waypoint</button>}
        </div>
        {frame.points.length ? <ul className="wiki-records">{frame.points.map((point) => (
          <li className="wiki-record" key={point.id}>
            <span><strong>{point.name}</strong> <span className="muted">{dimension(point.x_cm)}, {dimension(point.y_cm)}</span></span>
            {onEdit && <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'waypoint', point })}>Edit waypoint</button>}
          </li>
        ))}</ul> : <p className="muted">No named waypoints at this time.</p>}
        <div className="wiki-card-heading">
          <h3>Connections</h3>
          {onEdit && layout.available.reduce((count, item) => count + item.points.length, 0) >= 2 && (
            <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'connection' })}>Add connection</button>
          )}
        </div>
        {connections.length ? <ul className="wiki-records">{connections.map((connection) => (
          <li className="wiki-record" key={connection.id}>
            <div>
              <strong>{connection.name}</strong>
              <p>{endpoint(connection.from_place, connection.from_point)} {connection.bidirectional ? '↔' : '→'} {endpoint(connection.to_place, connection.to_point)}</p>
              <p className="muted">From time {connection.from_tick}{connection.until_tick === null ? '' : ' until time ' + connection.until_tick}
                {' · '}{connection.bidirectional ? 'Both directions' : 'One way'}
                {' · '}{connection.length_cm === null ? 'Length unspecified' : dimension(connection.length_cm)}</p>
              {connection.description && <p className="wiki-prose">{connection.description}</p>}
              {connection.source && <p className="muted">{connection.source}</p>}
            </div>
            {onEdit && <button type="button" className="button secondary" onClick={() => onEdit({ kind: 'connection', connection })}>Edit connection</button>}
          </li>
        ))}</ul> : <p className="muted">No connections at this time.</p>}
      </> : <p className="muted">No measured layout at this time.</p>}
    </section>
  )
}

function CmInput({ label, name, value, min = -Number.MAX_SAFE_INTEGER, optional = false }: {
  label: string; name: string; value?: number; min?: number; optional?: boolean
}) {
  return <label className="field">{label}<input type="number" name={name} min={min} max={Number.MAX_SAFE_INTEGER}
    step={1} required={!optional} defaultValue={value} /></label>
}

type LayoutFormProps = FormActions & { entry: WikiEntry; layout: WikiPlaceLayout; entries: WikiEntry[]; at: number | null }

export function WikiLayoutForm({ edit, ...props }: LayoutFormProps & { edit: LayoutEdit }) {
  if (edit.kind === 'connection') return <ConnectionForm {...props} connection={edit.connection} />
  const { entry, layout: { frame }, at, ...actions } = props
  const point = edit.kind === 'waypoint' ? edit.point : undefined
  const title = edit.kind === 'layout' ? (frame ? 'Edit layout' : 'Add layout') : point ? 'Edit waypoint' : 'Add waypoint'
  return (
    <form className="wiki-form" aria-label={title} onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const common = { place_id: entry.id, name: String(data.get('name')), from_tick: Number(data.get('from_tick')) }
      actions.onSave(edit.kind === 'layout' ? {
        ...common, op: 'save_layout', left_cm: Number(data.get('left_cm')), top_cm: Number(data.get('top_cm')),
        width_cm: Number(data.get('width_cm')), height_cm: Number(data.get('height_cm')),
      } : {
        ...common, op: 'save_waypoint', x_cm: Number(data.get('x_cm')), y_cm: Number(data.get('y_cm')),
        ...(point ? { point_id: point.id } : {}),
      })
    }}>
      <h2>{title}</h2>
      <label className="field">{edit.kind === 'layout' ? 'Layout name' : 'Waypoint name'}
        <input name="name" maxLength={100} defaultValue={edit.kind === 'layout' ? frame?.name : point?.name} required />
      </label>
      <TimeInput name="from_tick" label="Effective from" day={at} />
      {edit.kind === 'layout' ? <div className="wiki-form-row">
        <CmInput name="left_cm" label="Left (cm)" value={frame?.left_cm ?? 0} />
        <CmInput name="top_cm" label="Top (cm)" value={frame?.top_cm ?? 0} />
        <CmInput name="width_cm" label="Width (cm)" value={frame?.width_cm} min={1} />
        <CmInput name="height_cm" label="Height (cm)" value={frame?.height_cm} min={1} />
      </div> : <div className="wiki-form-row">
        <CmInput name="x_cm" label="X (cm)" value={point?.x_cm ?? frame?.left_cm} />
        <CmInput name="y_cm" label="Y (cm)" value={point?.y_cm ?? frame?.top_cm} />
      </div>}
      <Actions {...actions} submit={edit.kind === 'layout' ? 'Save layout' : 'Save waypoint'} />
    </form>
  )
}

function ConnectionForm({ entry, entries, layout, at, connection, ...actions }: LayoutFormProps & { connection?: WikiConnection }) {
  const [origin, setOrigin] = useState(connection?.from_place ?? entry.id)
  const [destination, setDestination] = useState(connection?.to_place ?? entry.id)
  const targets = layout.available.filter((frame) => frame.points.length)
  const choices = entries.filter((candidate) => targets.some((frame) => frame.place_id === candidate.id))
  const title = connection ? 'Edit connection' : 'Add connection'
  return (
    <form className="wiki-form" aria-label={title} onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      actions.onSave({
        op: 'save_connection', name: String(data.get('name')), description: String(data.get('description') ?? ''),
        source: String(data.get('source') ?? ''), from_place: origin, from_point: String(data.get('from_point')),
        to_place: destination, to_point: String(data.get('to_point')), bidirectional: data.has('bidirectional'),
        from_tick: Number(data.get('from_tick')), until_tick: optionalTime(data, 'until_tick'),
        length_cm: optionalTime(data, 'length_cm'), ...(connection ? { connection_id: connection.id } : {}),
      })
    }}>
      <h2>{title}</h2>
      <label className="field">Connection name<input name="name" maxLength={100} defaultValue={connection?.name} required /></label>
      <div className="wiki-form-row">
        <EntryPicker label="From place" entries={choices} initial={origin} onChange={setOrigin} />
        <EntryPicker key={origin} name="from_point" label="From waypoint"
          entries={targets.find((frame) => frame.place_id === origin)?.points ?? []}
          initial={origin === connection?.from_place ? connection.from_point : undefined} />
      </div>
      <div className="wiki-form-row">
        <EntryPicker label="To place" entries={choices} initial={destination} onChange={setDestination} />
        <EntryPicker key={destination} name="to_point" label="To waypoint"
          entries={targets.find((frame) => frame.place_id === destination)?.points ?? []}
          initial={destination === connection?.to_place ? connection.to_point : undefined} />
      </div>
      <div className="wiki-form-row">
        <TimeInput name="from_tick" label="Effective from" day={connection?.from_tick ?? at} />
        <TimeInput name="until_tick" label="Effective until (optional)" day={connection?.until_tick ?? undefined} optional />
        <CmInput name="length_cm" label="Length (cm, optional)" value={connection?.length_cm ?? undefined} min={0} optional />
      </div>
      <label className="wiki-checkbox"><input type="checkbox" name="bidirectional" defaultChecked={connection?.bidirectional ?? true} /> Two-way connection</label>
      <label className="field">Description<textarea name="description" maxLength={500} rows={3} defaultValue={connection?.description} /></label>
      <label className="field">Source (optional)<input name="source" maxLength={500} defaultValue={connection?.source} /></label>
      <Actions {...actions} submit="Save connection" />
    </form>
  )
}
