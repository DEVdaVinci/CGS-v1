import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { isWikiActor, searchWiki, type WikiEntry, type WikiEntryTemplate, type WikiLocation, type WikiSection } from './wiki-api'
import { Actions, type FormActions, kindLabel, TimeInput } from './wiki-forms'

type Destination = {
  key: WikiSection; label: string; create?: { type: WikiEntryTemplate; label: string }[]
  chooser?: { label: string; types: WikiEntryTemplate[] }
}

const navigation: { title: string; destinations: Destination[] }[] = [
  { title: 'World Wiki', destinations: [
    { key: 'overview', label: 'World overview' },
    { key: 'all', label: 'All articles' },
  ] },
  { title: 'Worldbuilding', destinations: [
    { key: 'characters', label: 'Characters', create: [{ type: 'person', label: 'New character' }] },
    { key: 'organisms', label: 'Organisms & species', create: [
      { type: 'organism', label: 'New organism' }, { type: 'species', label: 'New species' },
    ] },
    { key: 'places', label: 'Places', create: [
      { type: 'place', label: 'New place' }, { type: 'territory', label: 'New territory' },
    ] },
    { key: 'groups', label: 'Groups & cultures', create: [
      { type: 'group', label: 'New group' }, { type: 'culture', label: 'New culture' },
    ] },
    { key: 'items', label: 'Items', create: [{ type: 'item', label: 'New item' }] },
    { key: 'vehicles', label: 'Vehicles', create: [{ type: 'vehicle', label: 'New vehicle' }] },
  ] },
  { title: 'World tools', destinations: [
    { key: 'maps', label: 'Maps', create: [{ type: 'map', label: 'Add map reference' }] },
    { key: 'timeline', label: 'Timeline' },
    { key: 'definitions', label: 'Definitions', chooser: {
      label: 'New definition', types: ['class', 'role', 'ability', 'resource', 'body_part', 'trait', 'goal', 'era'],
    } },
    { key: 'media', label: 'Media', chooser: {
      label: 'New media reference', types: ['image', 'model_3d', 'texture', 'animation'],
    } },
  ] },
]
export const sections = navigation.flatMap(({ destinations }) => destinations)

export function sectionFor(entry: WikiEntry): WikiSection {
  if (entry.kind === 'person') return 'characters'
  if (entry.kind === 'organism' || entry.kind === 'species') return 'organisms'
  if (entry.kind === 'place' || entry.kind === 'territory') return 'places'
  if (entry.kind === 'group' || entry.kind === 'culture') return 'groups'
  if (entry.kind === 'map') return 'maps'
  if (entry.kind === 'item') return entry.catalog_type === 'vehicle' ? 'vehicles' : 'items'
  if (entry.kind === 'image' || entry.kind === 'model_3d' || entry.kind === 'texture' || entry.kind === 'animation') return 'media'
  return 'definitions'
}

export function entryLabel(entry: WikiEntry) {
  return entry.catalog_type === 'vehicle' ? 'Vehicle' : kindLabel[entry.kind]
}

export function WikiNavigation({ section, disabled, onSelect }: {
  section: WikiSection; disabled: boolean; onSelect: (section: WikiSection) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <aside className="wiki-sidebar">
      <button className="button secondary wiki-menu-toggle" type="button" aria-expanded={expanded}
        aria-controls="wiki-sections" onClick={() => setExpanded((open) => !open)}>Menu</button>
      <nav id="wiki-sections" className="wiki-workspace-nav" data-expanded={expanded} aria-label="Wiki sections">
        {navigation.map(({ title, destinations }) => (
          <div className="wiki-nav-group" key={title}>
            <h2>{title}</h2>
            {destinations.map(({ key, label }) => (
              <button type="button" key={key} disabled={disabled} aria-current={section === key ? 'page' : undefined}
                onClick={() => { setExpanded(false); onSelect(key) }}>{label}</button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export function WikiHome({ worldName, introduction, entries, onSelect, onEdit }: {
  worldName: string; introduction?: string; entries: WikiEntry[]; onSelect: (section: WikiSection) => void; onEdit?: () => void
}) {
  return (
    <section className="wiki-home" aria-label="World Wiki overview">
      <header className="wiki-home-intro">
        <h1>{worldName}</h1>
        {introduction && <p className="wiki-prose">{introduction}</p>}
        {onEdit && <button className="button secondary" type="button" onClick={onEdit}>Edit world introduction</button>}
      </header>
      {navigation.slice(1).map(({ title, destinations }) => <section className="wiki-home-destinations" key={title}>
        <h2>{title}</h2>
        <div className="wiki-home-grid">
          {destinations.map(({ key, label }) => {
            const count = entries.filter((entry) => inDirectory(entry, key)).length
            return <button key={key} className="wiki-home-card" type="button" onClick={() => onSelect(key)}>
              <strong>{label}</strong>
              <span>{key === 'timeline' ? 'Events and calendars'
                : count + (count === 1 ? ' article' : ' articles')}</span>
            </button>
          })}
        </div>
      </section>)}
    </section>
  )
}

export function WikiIntroductionForm({ introduction, ...actions }: FormActions & { introduction?: string }) {
  return (
    <form className="wiki-form" aria-label="Edit world introduction" onSubmit={(event) => {
      event.preventDefault()
      actions.onSave({
        op: 'update_world_introduction',
        introduction: String(new FormData(event.currentTarget).get('introduction') ?? ''),
      })
    }}>
      <h2>Edit world introduction</h2>
      <label className="field">Introduction
        <textarea name="introduction" rows={7} maxLength={3000} defaultValue={introduction} disabled={actions.busy} />
      </label>
      <Actions {...actions} submit="Save introduction" />
    </form>
  )
}

function inDirectory(entry: WikiEntry, section: WikiSection) {
  return section === 'all' || (section === 'items' && entry.kind === 'item') || sectionFor(entry) === section
}

function EntryList({ entries, currentId, disabled, onOpen }: {
  entries: WikiEntry[]; currentId?: string; disabled: boolean; onOpen: (entry: WikiEntry) => void
}) {
  return <ul>{entries.map((entry) => (
    <li key={entry.id}>
      <button type="button" disabled={disabled} aria-current={entry.id === currentId ? 'page' : undefined}
        onClick={() => onOpen(entry)}>
        <strong>{entry.name}</strong><span>{entryLabel(entry)}</span>
      </button>
    </li>
  ))}</ul>
}

export function WikiDirectory({ section, entries, currentId, disabled, onOpen, onPlaces, actions }: {
  section: WikiSection; entries: WikiEntry[]; currentId: string; disabled: boolean
  onOpen: (entry: WikiEntry) => void; onPlaces: () => void; actions?: ReactNode
}) {
  const [filter, setFilter] = useState('')
  const available = entries.filter((entry) => inDirectory(entry, section))
  const query = filter.trim().toLowerCase()
  const results = available.filter((entry) => entry.name.toLowerCase().includes(query))
  return (
    <nav className={currentId ? 'wiki-directory wiki-related-directory' : 'wiki-directory wiki-catalog'} aria-label="Wiki entries">
      <div className="wiki-card-heading">
        <h2>{currentId ? 'In this catalog' : sections.find(({ key }) => key === section)?.label}</h2>
        {actions}
      </div>
      {section === 'maps' && <p className="muted">
        Open an image map or a saved reference. Open a place to view its measured layout in History.{' '}
        <button className="wiki-reference" type="button" disabled={disabled} onClick={onPlaces}>Open Places</button>
      </p>}
      {available.length > 0 && <label className="field">Find an entry
        <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} disabled={disabled} />
      </label>}
      {results.length > 0
        ? <EntryList entries={results} currentId={currentId} disabled={disabled} onOpen={onOpen} />
        : <p className="muted">{query ? 'No matching entries.' : 'No articles in this section yet.'}</p>}
    </nav>
  )
}

export function WikiSearch({ worldId, revision, disabled, onOpen, onAuthError }: {
  worldId: string; revision: number; disabled: boolean
  onOpen: (entry: WikiEntry) => void; onAuthError: (error: unknown) => boolean
}) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ entries: WikiEntry[] } | { error: true } | null>(null)

  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    void searchWiki(worldId, query, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult(data)
    }, (error: unknown) => {
      if (!controller.signal.aborted && !onAuthError(error)) setResult({ error: true })
    })
    return () => controller.abort()
  }, [worldId, query, revision, onAuthError])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = input.trim()
    if (name !== query) {
      setResult(null)
      setQuery(name)
    }
  }

  return <div className="wiki-search">
    <form role="search" className="wiki-search-form" onSubmit={submit}>
      <label className="field"><span className="visually-hidden">Search this world</span>
        <input type="search" value={input} placeholder="Search this world" maxLength={100} required
          disabled={disabled} onChange={(event) => {
            setInput(event.target.value)
            if (!event.target.value.trim()) setQuery('')
          }} />
      </label>
      <button type="submit" className="button secondary" disabled={disabled}>Search</button>
    </form>
    {query && <section className="wiki-directory wiki-search-results" aria-label="Search results">
      <div className="wiki-card-heading">
        <h2>Search results</h2>
        <button type="button" className="wiki-reference" onClick={() => { setInput(''); setQuery(''); setResult(null) }}>Clear</button>
      </div>
      {!result ? <p role="status" className="muted">Searching…</p>
        : 'error' in result ? <p role="alert" className="error-message">Search unavailable. Clear and try again.</p>
          : result.entries.length ? <EntryList entries={result.entries} disabled={disabled}
            onOpen={(entry) => { setInput(''); setQuery(''); setResult(null); onOpen(entry) }} />
            : <p className="muted" role="status">No matching articles.</p>}
    </section>}
  </div>
}

export function WikiHistoryControls({ location, entries, viewpoint, disabled, onChange, timeline = false }: {
  location: WikiLocation; entries: WikiEntry[]; viewpoint: WikiEntry | null; disabled: boolean
  onChange: (at: number, viewAs: string) => void
  timeline?: boolean
}) {
  return (
    <form className="wiki-history-controls" aria-label={timeline ? 'State and viewpoint' : 'Historical view'} onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const raw = String(data.get('at') ?? '')
      const at = Number(raw)
      if (raw && Number.isSafeInteger(at) && at >= 0) onChange(at, String(data.get('view_as') ?? ''))
    }}>
      <fieldset disabled={disabled}>
        <TimeInput key={location.at} name="at" label={timeline ? 'State and viewpoint time' : 'View state at time'} day={location.at} />
        <label className="field">View as
          <select key={location.viewAs} name="view_as" defaultValue={location.viewAs}>
            <option value="">Author</option>
            {entries.filter(isWikiActor).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            {viewpoint && !entries.some((entry) => entry.id === viewpoint.id) && <option value={viewpoint.id}>{viewpoint.name}</option>}
          </select>
        </label>
        <button className="button secondary" type="submit">{timeline ? 'Apply state view' : 'Show time'}</button>
      </fieldset>
    </form>
  )
}
