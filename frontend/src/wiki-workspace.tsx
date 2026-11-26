import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { HomeMasthead, WorkspaceLink } from './home-masthead'
import {
  isWikiActor, mapImageUrl, searchWiki, wikiHref, type WikiEntry, type WikiEntryTemplate, type WikiLocation, type WikiSection, type WikiWorldHome,
} from './wiki-api'
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
    { key: 'definitions', label: 'Definitions',
      create: [{ type: 'role', label: 'New role or title' }, { type: 'status_def', label: 'New status definition' }],
      chooser: {
        label: 'New definition', types: ['class', 'role', 'status_def', 'ability', 'resource', 'resource_mv', 'body_part', 'body_fn', 'trait',
          'goal', 'milestone', 'requirement', 'method', 'method_step', 'value_def', 'preference', 'motivation',
          'behavior', 'process', 'skill', 'context', 'relation_def', 'relation', 'rel_term', 'era'],
      },
    },
    { key: 'sources', label: 'Sources', create: [{ type: 'source', label: 'New source' }] },
    { key: 'media', label: 'Media', chooser: {
      label: 'New media reference', types: ['image', 'model_3d', 'texture', 'animation'],
    } },
  ] },
]
export const sections = navigation.flatMap(({ destinations }) => destinations)

export const wikiHomeCreate = [
  { key: 'character', label: 'New character', section: 'characters', edit: { kind: 'create', fixedTemplate: 'person' } },
  { key: 'place', label: 'New place', section: 'places', edit: { kind: 'create', fixedTemplate: 'place' } },
  { key: 'item', label: 'New item', section: 'items', edit: { kind: 'create', fixedTemplate: 'item' } },
  { key: 'vehicle', label: 'New vehicle', section: 'vehicles', edit: { kind: 'create', fixedTemplate: 'vehicle' } },
  { key: 'map', label: 'New map', section: 'maps', edit: { kind: 'map-image' } },
  { key: 'event', label: 'New event', section: 'timeline', edit: { kind: 'new-event' } },
  { key: 'entry', label: 'More entry types', section: 'all', edit: { kind: 'create' } },
] as const

const worldToolDetails: Partial<Record<WikiSection, string>> = {
  maps: 'Image maps and linked pins',
  timeline: 'Nested events and dated changes',
  definitions: 'Classes, roles, goals, and relationships',
  sources: 'Records, citations, and evidence',
  media: 'Images, models, and other references',
}

export function sectionFor(entry: WikiEntry): WikiSection {
  if (entry.kind === 'health_case') return 'all'
  if (entry.kind === 'person') return 'characters'
  if (entry.kind === 'organism' || entry.kind === 'species') return 'organisms'
  if (entry.kind === 'place' || entry.kind === 'territory') return 'places'
  if (entry.kind === 'group' || entry.kind === 'culture') return 'groups'
  if (entry.kind === 'map') return 'maps'
  if (entry.kind === 'source') return 'sources'
  if (entry.kind === 'item') return entry.catalog_type === 'vehicle' ? 'vehicles' : 'items'
  if (entry.kind === 'image' || entry.kind === 'model_3d' || entry.kind === 'texture' || entry.kind === 'animation') return 'media'
  return 'definitions'
}

export function entryLabel(entry: WikiEntry) {
  return entry.catalog_type === 'vehicle' ? 'Vehicle' : kindLabel[entry.kind]
}

export function WikiNavigation({ section, disabled, hrefFor, onSelect }: {
  section: WikiSection; disabled: boolean; hrefFor: (section: WikiSection) => string; onSelect: (section: WikiSection) => void
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
              <WorkspaceLink key={key} href={hrefFor(key)} disabled={disabled}
                aria-current={section === key || (section === 'library' && key === 'all') ? 'page' : undefined}
                onFollow={() => { setExpanded(false); onSelect(key) }}>{label}</WorkspaceLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export function WikiHome({ worldId, worldName, home, entries, sectionHref, entryHref, onSelect, onEntry, actions, canCreate, disabled }: {
  worldId: string; worldName: string; home?: WikiWorldHome; entries?: WikiEntry[]
  sectionHref?: (section: WikiSection) => string; entryHref?: (entry: WikiEntry) => string
  onSelect?: (section: WikiSection) => void; onEntry?: (entry: WikiEntry) => void; actions?: ReactNode; canCreate?: boolean; disabled?: boolean
}) {
  const hrefFor = sectionHref ?? ((section) => wikiHref(worldId, { section }))
  const articleHref = entryHref ?? ((entry) => wikiHref(worldId, { entryId: entry.id, section: sectionFor(entry) }))
  function catalogLink(key: WikiSection, label: string, detail?: string) {
    const count = detail ? undefined : entries?.filter((entry) => inDirectory(entry, key)).length
    return <WorkspaceLink key={key} className="home-index-link" href={hrefFor(key)} disabled={disabled}
      onFollow={onSelect && (() => onSelect(key))}>
      <strong>{label}</strong>
      {detail ? <span>{detail}</span> : count !== undefined && <span>{count} {count === 1 ? 'article' : 'articles'}</span>}
      <span aria-hidden="true">↗</span>
    </WorkspaceLink>
  }
  return (
    <section className="world-home" aria-label="World Wiki overview">
      <HomeMasthead title={worldName} introduction={home?.introduction}
        cover={home?.cover_map_id ? mapImageUrl(worldId, home.cover_map_id) : undefined}>{actions}</HomeMasthead>
      <div className={canCreate ? 'world-home-workspace world-home-workspace--build' : 'world-home-workspace'}>
        <section className="home-index home-tools" aria-labelledby="world-tools-title">
          <h2 id="world-tools-title">World tools</h2>
          <div className="home-tool-grid">
            {navigation[2].destinations.map(({ key, label }) => catalogLink(key, label, worldToolDetails[key]))}
          </div>
        </section>
        {canCreate && <section className="home-index home-create" aria-labelledby="world-create-title">
          <h2 id="world-create-title">Create in this world</h2>
          <div className="home-create-links">{wikiHomeCreate.map(({ key, label, section }) => (
            <WorkspaceLink key={key} className="button secondary" disabled={disabled}
              href={wikiHref(worldId, { section }) + '&create=' + key}>{label}</WorkspaceLink>
          ))}</div>
        </section>}
      </div>
      <div className={home?.featured.length ? 'world-home-columns world-home-columns--featured' : 'world-home-columns'}>
        <section className="home-index" aria-labelledby="world-catalog-title">
          <div className="home-index-heading">
            <h2 id="world-catalog-title">Explore the Wiki</h2>
            <WorkspaceLink href={hrefFor('all')} disabled={disabled} onFollow={onSelect && (() => onSelect('all'))}>All articles</WorkspaceLink>
          </div>
          <div className="home-index-grid">{navigation[1].destinations.map(({ key, label }) => catalogLink(key, label))}</div>
        </section>
        {Boolean(home?.featured.length) && <section className="home-index" aria-labelledby="featured-title">
          <h2 id="featured-title">Featured articles</h2>
          <ul className="home-featured">{home?.featured.map((entry) => (
            <li key={entry.id}><WorkspaceLink href={articleHref(entry)} disabled={disabled} onFollow={onEntry && (() => onEntry(entry))}>
              <span>{entryLabel(entry)}</span><strong>{entry.name}</strong>
            </WorkspaceLink></li>
          ))}</ul>
        </section>}
      </div>
    </section>
  )
}

export function WikiIntroductionForm({ home, entries, coverIds, ...actions }: FormActions & {
  home?: WikiWorldHome; entries: WikiEntry[]; coverIds: string[]
}) {
  const [featured, setFeatured] = useState(home?.featured.map((entry) => entry.id) ?? [])
  const [candidate, setCandidate] = useState('')
  const names = new Map(entries.map((entry) => [entry.id, entry.name]))
  const choices = entries.filter((entry) => !entry.author_only && !featured.includes(entry.id))

  function move(index: number, direction: number) {
    setFeatured((selected) => {
      const ordered = [...selected]
      ;[ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]]
      return ordered
    })
  }
  return (
    <form className="wiki-form" aria-label="Edit world home" onSubmit={(event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      actions.onSave({
        op: 'update_world_home',
        introduction: String(form.get('introduction') ?? ''),
        cover_map_id: String(form.get('cover') ?? '') || null,
        featured_entry_ids: featured,
      })
    }}>
      <h2>Edit world home</h2>
      <fieldset className="wiki-change-fields" disabled={actions.busy}>
        <label className="field">Introduction
          <textarea name="introduction" rows={6} maxLength={3000} defaultValue={home?.introduction} />
        </label>
        <label className="field">Cover image
          <select name="cover" defaultValue={home?.cover_map_id ?? ''}>
            <option value="">CGS default cover</option>
            {entries.filter((entry) => coverIds.includes(entry.id)).map((entry) =>
              <option value={entry.id} key={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <p className="muted">Upload a map to make its image available here.</p>
      </fieldset>
      <fieldset className="wiki-change-fields" disabled={actions.busy}>
        <legend>Featured articles</legend>
        <ol className="home-curation-list">{featured.map((id, index) => <li key={id}>
          <strong>{names.get(id)}</strong>
          <div className="form-actions">
            <button className="button secondary" type="button" disabled={index === 0} onClick={() => move(index, -1)}
              aria-label={'Move ' + names.get(id) + ' up'}>Up</button>
            <button className="button secondary" type="button" disabled={index === featured.length - 1} onClick={() => move(index, 1)}
              aria-label={'Move ' + names.get(id) + ' down'}>Down</button>
            <button className="button secondary" type="button" onClick={() => setFeatured((list) => list.filter((item) => item !== id))}
              aria-label={'Remove ' + names.get(id) + ' from featured articles'}>Remove</button>
          </div>
        </li>)}</ol>
        <label className="field">Choose an article
          <select value={candidate} onChange={(event) => setCandidate(event.target.value)}>
            <option value="">Select an article</option>
            {choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entryLabel(entry)})</option>)}
          </select>
        </label>
        <button className="button secondary" type="button" disabled={!candidate || featured.length >= 8} onClick={() => {
          setFeatured((list) => [...list, candidate])
          setCandidate('')
        }}>Feature article</button>
      </fieldset>
      <Actions {...actions} submit="Save world home" />
    </form>
  )
}

function inDirectory(entry: WikiEntry, section: WikiSection) {
  if (section === 'library') return !isWikiActor(entry) && !['place', 'map', 'item'].includes(entry.kind)
  return section === 'all' || (section === 'items' && entry.kind === 'item') || sectionFor(entry) === section
}

function EntryList({ entries, currentId, disabled, hrefFor, onOpen }: {
  entries: WikiEntry[]; currentId?: string; disabled: boolean; hrefFor: (entry: WikiEntry) => string; onOpen: (entry: WikiEntry) => void
}) {
  return <ul>{entries.map((entry) => (
    <li key={entry.id}>
      <WorkspaceLink href={hrefFor(entry)} disabled={disabled} aria-current={entry.id === currentId ? 'page' : undefined}
        onFollow={() => onOpen(entry)}>
        <strong>{entry.name}</strong><span>{entryLabel(entry)}</span>
      </WorkspaceLink>
    </li>
  ))}</ul>
}

export function WikiDirectory({ section, entries, currentId, disabled, hrefFor, onOpen, onPlaces, actions }: {
  section: WikiSection; entries: WikiEntry[]; currentId: string; disabled: boolean
  hrefFor: (entry: WikiEntry) => string
  onOpen: (entry: WikiEntry) => void; onPlaces: () => void; actions?: ReactNode
}) {
  const [filter, setFilter] = useState('')
  const [type, setType] = useState('')
  const available = entries.filter((entry) => inDirectory(entry, section))
  const query = filter.trim().toLowerCase()
  const showTypes = section === 'definitions' || section === 'all'
  const types = showTypes ? [...new Set(available.map(entryLabel))].sort((first, second) => first.localeCompare(second)) : []
  const selectedType = types.includes(type) ? type : ''
  const results = available.filter((entry) => (!selectedType || entryLabel(entry) === selectedType) && entry.name.toLowerCase().includes(query))
  return (
    <nav className={currentId ? 'wiki-directory wiki-related-directory' : 'wiki-directory wiki-catalog'} aria-label="Wiki entries">
      <div className="wiki-card-heading">
        <h2>{currentId ? 'In this catalog' : section === 'library' ? 'Library' : sections.find(({ key }) => key === section)?.label}</h2>
        {actions}
      </div>
      {section === 'maps' && <p className="muted">
        Open an image map or a saved reference. Open a place to view its measured layout in History.{' '}
        <button className="wiki-reference" type="button" disabled={disabled} onClick={onPlaces}>Open Places</button>
      </p>}
      {available.length > 0 && <div className="wiki-directory-filters">
        <label className="field">Find an entry
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} disabled={disabled} />
        </label>
        {(types.length > 1 || selectedType) && <label className="field">Article type
          <select value={selectedType} disabled={disabled} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            {types.map((entryType) => <option key={entryType} value={entryType}>{entryType}</option>)}
          </select>
        </label>}
      </div>}
      {results.length > 0
        ? <EntryList entries={results} currentId={currentId} disabled={disabled} hrefFor={hrefFor} onOpen={onOpen} />
        : <p className="muted">{query || selectedType ? 'No matching entries.' : 'No articles in this section yet.'}</p>}
    </nav>
  )
}

export function WikiSearch({ worldId, revision, disabled, hrefFor, onOpen, onAuthError }: {
  worldId: string; revision: number; disabled: boolean
  hrefFor: (entry: WikiEntry) => string
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
          : result.entries.length ? <EntryList entries={result.entries} disabled={disabled} hrefFor={hrefFor}
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
