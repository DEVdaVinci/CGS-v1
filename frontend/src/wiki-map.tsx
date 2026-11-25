import { type FormEvent, type PointerEvent, useRef, useState } from 'react'
import { ApiError } from './api'
import { mapImageUrl, uploadMapImage, type WikiEntry, type WikiImageMap, type WikiMapPin } from './wiki-api'
import { Actions, EntryPicker, type FormActions } from './wiki-forms'

export function WikiMapImageForm({ worldId, map, token, onAuthError, ...actions }: FormActions & {
  worldId: string; map?: WikiEntry; token: string; onAuthError: (error: unknown) => boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [imageError, setImageError] = useState('')
  const uploadKey = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const title = map ? 'Attach map image' : 'New map'
  const busy = actions.busy || uploading

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const image = fileInput.current?.files?.[0]
    const name = String(form.get('name') ?? '').trim()
    if (!image) return
    if (!map && !name) {
      setImageError('Enter a map name.')
      return
    }
    setImageError('')
    setUploading(true)
    try {
      const key = uploadKey.current ?? crypto.randomUUID()
      uploadKey.current = key
      const { upload_id } = await uploadMapImage(worldId, image, key, token)
      actions.onSave(map
        ? { op: 'attach_map_image', map_id: map.id, upload_id }
        : { op: 'create_image_map', name, upload_id, author_only: form.has('author_only') })
    } catch (error) {
      if (!onAuthError(error)) {
        const detail = error instanceof ApiError ? error.fieldErrors.map((item) => item.message).join(' ') : ''
        setImageError(detail || 'CGS couldn’t confirm the upload. Try again or choose another image.')
        if (error instanceof ApiError && error.status === 409) uploadKey.current = null
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <form className="wiki-form" aria-label={title} onSubmit={(event) => void submit(event)}>
      <h2>{title}</h2>
      {!map && <label className="field">Map name<input name="name" maxLength={100} required disabled={busy} /></label>}
      <label className="field">Map image
        <input type="file" accept="image/png,image/jpeg" ref={fileInput} disabled={busy} required onChange={() => {
          uploadKey.current = null
          setImageError('')
        }} />
      </label>
      <p className="muted">PNG or JPEG, up to 20 MiB and 32 megapixels.</p>
      {!map && <label className="wiki-checkbox"><input name="author_only" type="checkbox" disabled={busy} /> Author only</label>}
      {imageError && <p className="error-message" role="alert">{imageError}</p>}
      <Actions {...actions} busy={busy} submit={map ? 'Attach image' : 'Create map'} />
    </form>
  )
}

const zoomLevels = [1, 1.5, 2, 3, 4]

type Position = { x: string; y: string }

export function WikiMapPanel({ entry, map, worldId, entries, busy, onAttach, onSave, onOpenPlace }: {
  entry: WikiEntry; map?: WikiImageMap; worldId: string; entries: WikiEntry[]; busy: boolean
  onAttach?: () => void; onSave?: FormActions['onSave']; onOpenPlace: (id: string) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [pinEdit, setPinEdit] = useState<'new' | WikiMapPin | null>(null)
  const [position, setPosition] = useState<Position>({ x: '50', y: '50' })
  const [zoomIndex, setZoomIndex] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)
  const [imageAttempt, setImageAttempt] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const suppressPlacement = useRef(false)

  if (!map) {
    return (
      <section className="wiki-block" aria-label="Map image">
        <p className="muted">An existing map locator is available in History when one has been recorded.</p>
        {onAttach && <button type="button" className="button primary" disabled={busy} onClick={onAttach}>Attach map image</button>}
      </section>
    )
  }

  const selected = map.pins.find((pin) => pin.id === selectedId)
  const places = entries.filter((item) => item.kind === 'place')
  const linkedPlace = places.find((place) => place.id === selected?.place_id)
  const existingPin = typeof pinEdit === 'object' ? pinEdit : null
  const placing = Boolean(pinEdit && onSave && !busy)
  const zoom = zoomLevels[zoomIndex]

  function choosePin(pin: WikiMapPin) {
    setSelectedId(pin.id)
    setPinEdit(null)
  }

  function startPin(pin: WikiMapPin | 'new') {
    setPinEdit(pin)
    if (pin === 'new') {
      setSelectedId('')
      setPosition({ x: '50', y: '50' })
    } else {
      setPosition({ x: String(pin.x * 100), y: String(pin.y * 100) })
    }
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return
    suppressPlacement.current = false
    if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const box = event.currentTarget
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop, moved: false }
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const start = pan.current
    if (start?.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved) {
      if (Math.hypot(dx, dy) < 6) return
      start.moved = true
      suppressPlacement.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.currentTarget.scrollLeft = start.left - dx
    event.currentTarget.scrollTop = start.top - dy
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.id === event.pointerId) pan.current = null
  }

  function savePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onSave || busy) return
    const form = new FormData(event.currentTarget)
    onSave({
      op: 'save_map_pin', map_id: entry.id, pin_id: existingPin?.id, label: String(form.get('label')),
      place_id: String(form.get('place_id') || '') || null,
      x: Number(position.x) / 100, y: Number(position.y) / 100,
    })
  }

  return (
    <section className="wiki-block wiki-image-map" aria-label="Interactive map">
      <div className="wiki-card-heading wiki-map-toolbar">
        <div className="form-actions" aria-label="Map view controls">
          <button type="button" className="button secondary" disabled={zoomIndex === 0} onClick={() => setZoomIndex(zoomIndex - 1)}>Zoom out</button>
          <button type="button" className="button secondary" disabled={zoomIndex === zoomLevels.length - 1}
            onClick={() => setZoomIndex(zoomIndex + 1)}>Zoom in</button>
          <button type="button" className="button secondary" onClick={() => {
            setZoomIndex(0)
            viewport.current?.scrollTo(0, 0)
          }}>Reset view</button>
          <output aria-label="Map zoom">{zoom * 100}%</output>
        </div>
        {onSave && <button type="button" className="button primary" disabled={busy} onClick={() => startPin('new')}>Add pin</button>}
      </div>
      {placing && <p className="muted">Click to place the pin, drag to pan, or enter its position.</p>}
      <div className="wiki-map-workspace">
        <div className="wiki-map-canvas">
          <div className="wiki-map-viewport" ref={viewport} role="region" tabIndex={0} aria-label="Map viewport"
            data-placing={placing || undefined} onPointerDown={startPan} onPointerMove={movePan}
            onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}
            onPointerLeave={(event) => { if (!pan.current?.moved) endPan(event) }}>
            <div className="wiki-map-image" style={{ width: zoom * 100 + '%', aspectRatio: map.width + ' / ' + map.height }}
              onClick={(event) => {
                if (!placing || imageFailed || suppressPlacement.current) return
                const box = event.currentTarget.getBoundingClientRect()
                const percent = (value: number) => String(Math.round(Math.max(0, Math.min(1, value)) * 10000) / 100)
                setPosition({ x: percent((event.clientX - box.left) / box.width), y: percent((event.clientY - box.top) / box.height) })
              }}>
              <img key={imageAttempt} src={mapImageUrl(worldId, entry.id)} alt={entry.name + ' map image'} draggable={false}
                onError={() => setImageFailed(true)} />
              {map.pins.filter((pin) => pin.id !== existingPin?.id || !placing).map((pin) => (
                <button key={pin.id} className="wiki-map-pin" type="button"
                  aria-label={'Select ' + pin.label + ' on map'} aria-pressed={pin.id === selectedId} disabled={busy}
                  style={{ left: pin.x * 100 + '%', top: pin.y * 100 + '%' }} onClick={(event) => {
                    event.stopPropagation()
                    choosePin(pin)
                  }} />
              ))}
              {placing && <span aria-hidden="true" className="wiki-map-pin wiki-map-pin-preview" style={{ left: position.x + '%', top: position.y + '%' }} />}
            </div>
          </div>
          {imageFailed && <div className="form-actions">
            <p className="error-message" role="alert">The map image couldn’t be opened.</p>
            <button className="button secondary" type="button" onClick={() => {
              setImageFailed(false)
              setImageAttempt((previous) => previous + 1)
            }}>Retry image</button>
          </div>}
        </div>
        <aside className="wiki-map-sidebar" aria-label="Map pins">
          <div className="wiki-map-pin-list">
            <h3>Pins</h3>
            {!map.pins.length ? <p className="muted">No pins yet.</p> : (
              <ul className="wiki-records">
                {map.pins.map((pin) => (
                  <li key={pin.id}>
                    <button type="button" className="button secondary" aria-pressed={pin.id === selectedId}
                      disabled={busy} onClick={() => choosePin(pin)}>{pin.label}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selected && (!pinEdit || !onSave) && <section className="wiki-map-pin-detail" aria-label="Selected pin">
            <h3>{selected.label}</h3>
            <div className="form-actions">
              {linkedPlace && <button type="button" className="wiki-reference" disabled={busy}
                onClick={() => onOpenPlace(linkedPlace.id)}>Open {linkedPlace.name}</button>}
              {onSave && <>
                <button type="button" className="button secondary" disabled={busy} onClick={() => startPin(selected)}>Edit pin</button>
                <button type="button" className="button secondary" disabled={busy}
                  onClick={() => onSave({ op: 'remove_map_pin', map_id: entry.id, pin_id: selected.id })}>Remove pin</button>
              </>}
            </div>
          </section>}
          {pinEdit && onSave && <form key={existingPin?.id ?? 'new'} className="wiki-form wiki-map-pin-detail"
            aria-label={existingPin ? 'Edit map pin' : 'Add map pin'} onSubmit={savePin}>
            <fieldset className="wiki-change-fields" disabled={busy}>
              <legend>{existingPin ? 'Edit pin' : 'New pin'}</legend>
              <label className="field">Pin label<input autoFocus name="label" defaultValue={existingPin?.label} maxLength={100} required /></label>
              <EntryPicker name="place_id" label="Linked place" entries={places} required={false} initial={existingPin?.place_id ?? undefined} />
              <div className="wiki-form-row">
                <label className="field">Horizontal position (%)
                  <input type="number" min={0} max={100} step="any" required value={position.x}
                    onChange={(event) => setPosition({ ...position, x: event.target.value })} />
                </label>
                <label className="field">Vertical position (%)
                  <input type="number" min={0} max={100} step="any" required value={position.y}
                    onChange={(event) => setPosition({ ...position, y: event.target.value })} />
                </label>
              </div>
              <Actions busy={busy} onCancel={() => setPinEdit(null)} submit="Save pin" />
            </fieldset>
          </form>}
        </aside>
      </div>
    </section>
  )
}
