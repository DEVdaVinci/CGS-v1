import { type FormEvent, useEffect, useState } from 'react'
import { isWikiActor, searchWiki, type WikiEntry, type WikiEntryTemplate, type WikiLocation, type WikiSection } from './wiki-api'
import { kindLabel, TimeInput } from './wiki-forms'

export const sections: { key: WikiSection; label: string; create?: WikiEntryTemplate; action?: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'all', label: 'All articles' },
  { key: 'characters', label: 'Characters', create: 'person', action: 'New character' },
  { key: 'places', label: 'Places', create: 'place', action: 'New place' },
  { key: 'items', label: 'Items', create: 'item', action: 'New item' },
  { key: 'vehicles', label: 'Vehicles', create: 'vehicle', action: 'New vehicle' },
  { key: 'maps', label: 'Maps', create: 'map', action: 'Add map reference' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'library', label: 'Library' },
]

export function sectionFor(entry: WikiEntry): WikiSection {
  if (isWikiActor(entry)) return 'characters'
  if (entry.kind === 'place') return 'places'
  if (entry.kind === 'map') return 'maps'
  if (entry.kind === 'item') return entry.catalog_type === 'vehicle' ? 'vehicles' : 'items'
  return 'library'
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
      <nav id="wiki-sections" className="wiki-sections" data-expanded={expanded} aria-label="Wiki sections">
        {sections.map(({ key, label }) => (
          <button type="button" key={key} disabled={disabled} aria-current={section === key ? 'page' : undefined}
            onClick={() => { setExpanded(false); onSelect(key) }}>{label}</button>
        ))}
      </nav>
    </aside>
  )
}

export function WikiHome({ entries, onSelect }: { entries: WikiEntry[]; onSelect: (section: WikiSection) => void }) {
  const cards = sections.filter(({ key }) => key !== 'overview')
  return (
    <section className="wiki-home" aria-label="World Wiki overview">
      <h2>Explore the world</h2>
      <div className="wiki-home-grid">
        {cards.map(({ key, label }) => {
          const count = key === 'all' ? entries.length : entries.filter((entry) => inDirectory(entry, key)).length
          return <button key={key} className="wiki-home-card" type="button" onClick={() => onSelect(key)}>
            <strong>{label}</strong>
            <span>{key === 'timeline' ? 'Events and calendars'
              : key === 'maps' ? 'Image maps and linked places' : count + (count === 1 ? ' article' : ' articles')}</span>
          </button>
        })}
      </div>
    </section>
  )
}

function inDirectory(entry: WikiEntry, section: WikiSection) {
  return section === 'all' || (section === 'items' ? entry.kind === 'item' : sectionFor(entry) === section)
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

export function WikiDirectory({ section, entries, currentId, disabled, onOpen, onPlaces }: {
  section: WikiSection; entries: WikiEntry[]; currentId: string; disabled: boolean
  onOpen: (entry: WikiEntry) => void; onPlaces: () => void
}) {
  const [filter, setFilter] = useState('')
  const available = entries.filter((entry) => inDirectory(entry, section))
  const query = filter.trim().toLowerCase()
  const results = available.filter((entry) => entry.name.toLowerCase().includes(query))
  return (
    <nav className="wiki-directory" aria-label="Wiki entries">
      <h2>{sections.find(({ key }) => key === section)?.label}</h2>
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
