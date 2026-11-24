import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, type SignedInSession } from './api'
import {
  getWiki, readWikiAttempt, saveWikiChange, storeWikiAttempt,
  type WikiArticle, type WikiAttempt, type WikiCommand, type WikiEvent, type WikiKind,
  type WikiLocation, type WikiSection, type WikiValue, type WikiView,
} from './wiki-api'
import { kindLabel, type ArticleEdit, WikiEditForm, WikiEntryForm, WikiEventForm, WikiEvidenceForm } from './wiki-forms'
import { WikiTimeline } from './wiki-timeline'

const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const sections: { key: WikiSection; label: string }[] = [
  { key: 'all', label: 'Overview' }, { key: 'characters', label: 'Characters' },
  { key: 'places', label: 'Places' }, { key: 'timeline', label: 'Timeline' },
  { key: 'library', label: 'Library' },
]
type WikiEdit = ArticleEdit | { kind: 'create'; fixedKind?: WikiKind } | { kind: 'new-event' }

function sectionFor(kind: WikiKind): WikiSection {
  if (kind === 'person') return 'characters'
  if (kind === 'place') return 'places'
  return 'library'
}

function initialLocation(): WikiLocation {
  const params = new URLSearchParams(window.location.search)
  const at = Number(params.get('at') ?? 0)
  const entryId = params.get('entry') ?? ''
  const viewAs = params.get('view_as') ?? ''
  const eventId = params.get('event') ?? ''
  const section = sections.find((item) => item.key === params.get('section'))?.key ?? 'all'
  return {
    at: Number.isSafeInteger(at) && at >= 0 ? at : 0,
    entryId: validId.test(entryId) ? entryId : '',
    viewAs: validId.test(viewAs) ? viewAs : '',
    section,
    eventId: validId.test(eventId) ? eventId : '',
  }
}

type Display = {
  view: WikiView
  openEntry: (id: string) => void
  navigationLocked: boolean
}

function fieldLabel(view: WikiView, key: string) {
  return view.fields.find((field) => field.key === key)?.label ?? key
}

function entryName(view: WikiView, id: string) {
  return view.entries.find((entry) => entry.id === id)?.name
}

function ValueText({ field, value, view, openEntry, navigationLocked }: Display & { field: string; value: WikiValue }) {
  const definition = view.fields.find((item) => item.key === field)
  if (definition?.target_kind && typeof value === 'string') {
    const name = entryName(view, value)
    return name ? (
      <button className="wiki-reference" type="button" disabled={navigationLocked} onClick={() => openEntry(value)}>{name}</button>
    ) : <span>Unavailable entry</span>
  }
  return <span>{value}</span>
}

function times(from: number, until: number | null) {
  return until === null ? 'From time ' + from : 'From time ' + from + ' until time ' + until
}

function Observations({ article, display }: { article: WikiArticle; display: Display }) {
  const viewpoint = display.view.viewpoint
  return (
    <section className="wiki-block" aria-label={viewpoint ? 'Character knowledge' : 'Recorded observations'}>
      <h2>{viewpoint ? 'Character knowledge' : 'Recorded observations'}</h2>
      {article.observations.length === 0 ? (
        <p className="muted">{viewpoint ? 'No recorded knowledge of this entry at this time.' : 'No observations recorded.'}</p>
      ) : (
        <ul className="wiki-records">
          {article.observations.map((item) => (
            <li className="wiki-record" key={item.id} id={'wiki-record-' + item.id}>
              <div>
                <strong>{fieldLabel(display.view, item.field)}</strong>
                <div><ValueText {...display} field={item.field} value={item.value} /></div>
                <p className="muted">
                  {viewpoint ? 'Learned' : (entryName(display.view, item.observer_id) ?? 'Character') + ' learned'} at time {item.learned_at}
                  {' · About time ' + item.about_tick}
                  {item.speaker_id ? ' · Statement by ' + (entryName(display.view, item.speaker_id) ?? 'a character') : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Article({ article, display, onEdit, onTimeline }: {
  article: WikiArticle; display: Display; onEdit?: (edit: ArticleEdit) => void
  onTimeline: (event: WikiEvent) => void
}) {
  const { view } = display
  const edit = display.navigationLocked ? undefined : onEdit
  const values = (article.values ?? []).filter((item) => item.state !== 'unknown')
  const summary = values.find((item) => item.field === 'description')
  const placeType = values.find((item) => item.field === 'place_type')
  const articleKind = placeType?.state === 'value' ? placeType.value : kindLabel[article.entry.kind]
  const facts = values.filter((item) => item.state === 'conflict' || (
    item.field !== 'description' && item.field !== 'place_type'
  ))
  return (
    <>
      <header className="wiki-article-title">
        <div>
          <p className="muted">{articleKind}{article.entry.author_only ? ' · Author only' : ''}</p>
          <h2>{article.entry.name}</h2>
        </div>
        {edit && (
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'fact' })}>Record fact</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'event' })}>Record dated change</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'claim' })}>Record claim</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'rename' })}>Rename</button>
          </div>
        )}
      </header>
      {!view.viewpoint && (
        <>
          {summary?.state === 'value' && <p className="wiki-article-summary wiki-prose">{summary.value}</p>}
          <section className="wiki-block" aria-label="Facts at the selected time">
            <h2>Facts at time {view.at}</h2>
            <dl className="wiki-facts">
              {facts.map((item) => (
                <div key={item.field}>
                  <dt>{fieldLabel(view, item.field)}</dt>
                  <dd>{item.state === 'value' ? <ValueText {...display} field={item.field} value={item.value} />
                    : item.state === 'conflict' ? <span className="wiki-conflict">Conflicting values</span>
                    : <span className="muted">Unknown at this time</span>}</dd>
                </div>
              ))}
            </dl>
            {facts.length === 0 && <p className="muted">No additional facts for this time.</p>}
          </section>
          {article.learned_abilities && (
            <section className="wiki-block" aria-label="Learned abilities">
              <div className="wiki-card-heading">
                <h2>Learned abilities</h2>
                {edit && <button type="button" className="button secondary" onClick={() => edit({ kind: 'learn' })}>Record learned ability</button>}
              </div>
              {article.learned_abilities.length ? (
                <ul className="wiki-records">
                  {article.learned_abilities.map((learned) => (
                    <li key={learned.id} className="wiki-record">
                      <div>
                        <button type="button" className="wiki-reference" disabled={display.navigationLocked}
                          onClick={() => display.openEntry(learned.ability_id)}>{entryName(view, learned.ability_id)}</button>
                        <p className="muted">Learned at time {learned.learned_at}{learned.source ? ' · ' + learned.source : ''}</p>
                      </div>
                      {edit && <button type="button" className="button secondary" onClick={() => edit({ kind: 'learn', learned })}>Correct ability record</button>}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No abilities learned by time {view.at}.</p>}
            </section>
          )}
          {article.contents && (
            <section className="wiki-block" aria-label="Here at the selected time">
              <h2>Here at time {view.at}</h2>
              {article.contents.length ? (
                <ul className="wiki-contents">
                  {article.contents.map((item) => (
                    <li key={item.id}>
                      <button type="button" className="wiki-reference" disabled={display.navigationLocked}
                        onClick={() => display.openEntry(item.id)}>{item.name}</button> <span className="muted">{kindLabel[item.kind]}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No entries are linked here at this time.</p>}
            </section>
          )}
          <section className="wiki-block" aria-label="Consistency findings">
            <h2>Consistency findings</h2>
            {(article.findings ?? []).length === 0 ? <p className="muted">No findings from the current timeline and evidence checks.</p> : (
              <ul className="wiki-findings">
                {article.findings?.map((finding) => (
                  <li key={finding.id}>
                    <strong>{fieldLabel(view, finding.field)}. </strong>
                    {finding.code === 'CANON_CONFLICT'
                      ? 'Conflicting canon values. ' + times(finding.from_tick, finding.until_tick) + '.'
                      : 'The source of a recorded observation changed. Review the recorded evidence.'}
                    {' '}
                    {finding.record_ids.map((id, index) => (
                      <a key={id} href={'#wiki-record-' + id}>Record {index + 1}</a>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="wiki-block" aria-label="Fact history">
            <h2>Fact history</h2>
            {(article.assertions ?? []).length === 0 ? <p className="muted">No canonical facts recorded.</p> : (
              <ul className="wiki-records">
                {article.assertions?.map((fact) => (
                  <li className="wiki-record" key={fact.id} id={'wiki-record-' + fact.id}>
                    <div>
                      <strong>{fieldLabel(view, fact.field)}</strong>
                      <div><ValueText {...display} field={fact.field} value={fact.value} /></div>
                      <p className="muted">{times(fact.from_tick, fact.until_tick)}{fact.author_only ? ' · Author only' : ''}</p>
                      {fact.source && <p className="muted">Source: {fact.source}</p>}
                      {fact.event_id && <a href={'#wiki-record-' + fact.event_id}>View event</a>}
                    </div>
                    {edit && (
                      <div className="form-actions">
                        <button className="button secondary" type="button" onClick={() => edit({ kind: 'correct', fact })}>Correct value</button>
                        {!fact.author_only && !article.entry.author_only && (
                          <button className="button secondary" type="button" onClick={() => edit({ kind: 'observe', source: fact, sourceKind: 'assertion' })}>Record observation</button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="wiki-block" aria-label="Dated events">
            <h2>Dated events</h2>
            {(article.events ?? []).length === 0 ? <p className="muted">No events recorded.</p> : (
              <ul className="wiki-records">
                {article.events?.map((event) => (
                  <li className="wiki-record" key={event.id} id={'wiki-record-' + event.id}>
                    <div>
                      <strong>{event.name}</strong>
                      <p className="muted">Time {event.tick}{event.source ? ' · ' + event.source : ''}</p>
                      {event.description && <p className="wiki-prose">{event.description}</p>}
                    </div>
                    <div className="form-actions">
                      <button className="button secondary" type="button" disabled={display.navigationLocked}
                        onClick={() => onTimeline(event)}>View in timeline</button>
                      {edit && <button className="button secondary" type="button" onClick={() => edit({ kind: 'correct-date', event })}>Correct event date</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="wiki-block" aria-label="Attributed claims">
            <h2>Attributed claims</h2>
            {(article.claims ?? []).length === 0 ? <p className="muted">No claims recorded.</p> : (
              <ul className="wiki-records">
                {article.claims?.map((claim) => (
                  <li className="wiki-record" key={claim.id} id={'wiki-record-' + claim.id}>
                    <div>
                      <strong>{fieldLabel(view, claim.field)}</strong>
                      <div><ValueText {...display} field={claim.field} value={claim.value} /></div>
                      <p className="muted">{entryName(view, claim.speaker_id)} at time {claim.tick}{claim.author_only ? ' · Author only' : ''}</p>
                      {claim.source && <p className="muted">Source: {claim.source}</p>}
                    </div>
                    {edit && !claim.author_only && !article.entry.author_only && (
                      <button className="button secondary" type="button" onClick={() => edit({ kind: 'observe', source: claim, sourceKind: 'claim' })}>Record observation</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <Observations article={article} display={display} />
    </>
  )
}

export function Wiki({ account, worldId, onAuthError }: {
  account: SignedInSession; worldId: string; onAuthError: (error: unknown) => boolean
}) {
  const [attempt, setAttempt] = useState(() => readWikiAttempt(account.account_id, worldId))
  const [location, setLocation] = useState(() => attempt?.location ?? initialLocation())
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; view?: WikiView; error?: 'unavailable' | 'connection' } | null>(null)
  const [editing, setEditing] = useState<WikiEdit | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const key = JSON.stringify([location, refresh])
  const view = result?.key === key ? result.view : undefined
  const failure = result?.key === key ? result.error : undefined
  const section = location.section ?? 'all'
  const directory = view?.entries.filter((entry) => (
    (section === 'all' || sectionFor(entry.kind) === section)
    && entry.name.toLowerCase().includes(search.trim().toLowerCase())
  )) ?? []
  const navigationLocked = Boolean(editing || attempt || saving)
  const clearAttempt = useCallback(() => {
    storeWikiAttempt(account.account_id, worldId, null)
    setAttempt(null)
  }, [account.account_id, worldId])

  useEffect(() => {
    const controller = new AbortController()
    void getWiki(worldId, location, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        if (!data.can_edit) clearAttempt()
        setResult({ key, view: data })
      }
    }, (error: unknown) => {
      if (controller.signal.aborted || onAuthError(error)) return
      const unavailable = error instanceof ApiError && error.status === 404
      if (unavailable) clearAttempt()
      setResult({ key, error: unavailable ? 'unavailable' : 'connection' })
    })
    return () => controller.abort()
  }, [worldId, location, key, clearAttempt, onAuthError])

  useEffect(() => {
    const params = new URLSearchParams()
    if (location.at) params.set('at', String(location.at))
    if (location.viewAs) params.set('view_as', location.viewAs)
    if (location.entryId) params.set('entry', location.entryId)
    if (location.section && location.section !== 'all') params.set('section', location.section)
    if (location.section === 'timeline' && location.eventId) params.set('event', location.eventId)
    window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params.toString() : ''))
  }, [location])

  function navigate(next: WikiLocation) {
    setNotice('')
    setSaveError('')
    setLocation(next)
  }

  function openEntry(id: string, at = location.at) {
    const selected = view?.entries.find((entry) => entry.id === id)
    if (!selected) return
    setSearch('')
    navigate({ ...location, entryId: id, section: section === 'all' ? 'all' : sectionFor(selected.kind), at })
  }

  function beginEdit(edit: WikiEdit) {
    setNotice('')
    setSaveError('')
    setEditing(edit)
  }

  async function send(pending: WikiAttempt) {
    if (saving) return
    setAttempt(pending)
    storeWikiAttempt(account.account_id, worldId, pending)
    setSaving(true)
    setSaveError('')
    setNotice('')
    try {
      const saved = await saveWikiChange(worldId, pending, account.csrf_token)
      clearAttempt()
      setEditing(null)
      setNotice('Wiki change saved.')
      if (pending.command.op === 'create_entry') {
        const nextSection = !pending.location.section || pending.location.section === 'all'
          ? 'all' : sectionFor(pending.command.kind)
        setSearch('')
        setLocation({ ...pending.location, entryId: saved.record_id, section: nextSection })
      } else {
        setLocation(pending.location.section === 'timeline' ? { ...pending.location, eventId: saved.record_id } : pending.location)
      }
      setRefresh((previous) => previous + 1)
    } catch (error) {
      if (onAuthError(error)) return
      if (error instanceof ApiError && error.status < 500) {
        clearAttempt()
        if (error.status === 404 || error.status === 403) {
          setEditing(null)
          setResult(null)
          setRefresh((previous) => previous + 1)
        } else if (error.code === 'STALE_WIKI') {
          setStale(true)
          setSaveError('The Wiki changed in another tab. Reload and review the latest records before retrying this edit.')
        } else {
          setSaveError(error.fieldErrors.map((item) => item.message).join(' ') || 'CGS couldn’t save this change.')
        }
      } else {
        setSaveError('CGS couldn’t confirm the save. Retry to recover the same request.')
      }
    } finally {
      setSaving(false)
    }
  }

  function save(command: WikiCommand) {
    if (view?.edit_counter === undefined || attempt || stale) return
    void send({ command, edit: view.edit_counter, key: crypto.randomUUID(), location })
  }

  function selectTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const time = Number(new FormData(event.currentTarget).get('at'))
    if (Number.isSafeInteger(time) && time >= 0) navigate({ ...location, at: time })
  }

  const actions = {
    onSave: save,
    busy: Boolean(attempt || saving || stale),
    onCancel: () => { setEditing(null); setSaveError(''); setStale(false) },
  }

  return (
    <>
      <a className="back-link" href={'/worlds/' + worldId + '/'}>← Back to world</a>
      {!view && !failure && <p className="muted" role="status">Loading Wiki…</p>}
      {failure && (
        <section className="error-state">
          <h1>{failure === 'unavailable' ? 'Wiki unavailable' : 'Couldn’t load the Wiki'}</h1>
          <button className="button secondary" type="button" onClick={() => {
            if (failure === 'unavailable') navigate({ at: 0, viewAs: '', entryId: '' })
            setRefresh((previous) => previous + 1)
          }}>{failure === 'unavailable' ? 'Open Wiki home' : 'Try again'}</button>
        </section>
      )}
      {view && (
        <>
          <header className="workspace-heading">
            <div>
              <p className="muted">World Wiki</p>
              <h1>{view.world_name}</h1>
            </div>
            {view.can_edit && (
              <div className="form-actions">
                {section === 'timeline' ? (
                  <button className="button primary" type="button" disabled={navigationLocked}
                    onClick={() => beginEdit({ kind: 'new-event' })}>New event</button>
                ) : (
                  <>
                    {section === 'characters' && <button className="button primary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'create', fixedKind: 'person' })}>New character</button>}
                    {section === 'places' && <button className="button primary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'create', fixedKind: 'place' })}>New place</button>}
                    <button className={'button ' + (section === 'all' || section === 'library' ? 'primary' : 'secondary')} type="button"
                      disabled={navigationLocked} onClick={() => beginEdit({ kind: 'create' })}>New entry</button>
                  </>
                )}
              </div>
            )}
          </header>
          <nav className="wiki-sections" aria-label="Wiki sections">
            {sections.map((item) => (
              <button key={item.key} type="button" disabled={navigationLocked}
                aria-current={section === item.key ? 'page' : undefined} onClick={() => {
                  if (section === item.key) return
                  setSearch('')
                  navigate({ ...location, section: item.key, entryId: '', eventId: '' })
                }}>{item.label}</button>
            ))}
          </nav>
          <div className="wiki-toolbar">
            {section !== 'timeline' && <form className="wiki-time" onSubmit={selectTime}>
              <label className="field">World time
                <input key={location.at} name="at" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} defaultValue={location.at} disabled={navigationLocked} required />
              </label>
              <button className="button secondary" type="submit" disabled={navigationLocked}>Show time</button>
            </form>}
            <label className="field">View as
              <select value={location.viewAs} disabled={navigationLocked} onChange={(event) => {
                const selected = view.article?.entry
                setSearch('')
                navigate({ ...location, viewAs: event.target.value, entryId: selected?.author_only ? '' : location.entryId })
              }}>
                <option value="">Author</option>
                {view.entries.filter((entry) => entry.kind === 'person').map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
                {view.viewpoint && !view.entries.some((entry) => entry.id === view.viewpoint?.id) && (
                  <option value={view.viewpoint.id}>{view.viewpoint.name}</option>
                )}
              </select>
            </label>
          </div>
          {notice && <p className="notice success wiki-message" role="status">{notice}</p>}
          {saveError && <p className="error-message wiki-message" role="alert">{saveError}</p>}
          {attempt && !saving && (
            <div className="wiki-message form-actions">
              {!saveError && <p className="notice">A previous save is unconfirmed.</p>}
              <button className="button primary" type="button" onClick={() => void send(attempt)}>Retry save</button>
            </div>
          )}
          {stale && (
            <button className="button secondary wiki-message" type="button" onClick={() => {
              actions.onCancel()
              setRefresh((previous) => previous + 1)
            }}>Reload and discard edit</button>
          )}
          {section === 'timeline' ? (
            <div className="wiki-article">
              {(editing?.kind === 'new-event' || editing?.kind === 'edit-event') && (
                <WikiEventForm {...actions} fields={view.fields} entries={view.entries} at={view.at}
                  event={editing.kind === 'edit-event' ? editing.event : undefined} />
              )}
              {editing?.kind === 'correct-date' && <WikiEvidenceForm {...actions} edit={editing} entries={view.entries} at={view.at} />}
              {!editing && <WikiTimeline events={view.timeline ?? []} entries={view.entries} fields={view.fields}
                currentEvent={location.eventId} onEdit={view.can_edit && !navigationLocked ? beginEdit : undefined}
                onOpen={navigationLocked ? undefined : openEntry} />}
            </div>
          ) : <div className="wiki-layout">
            <nav className="wiki-directory" aria-label="Wiki entries">
              <h2>{section === 'all' ? 'Entries' : sections.find((item) => item.key === section)?.label}</h2>
              <label className="field">Find an entry<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              {directory.length === 0 ? <p className="muted">{search.trim() ? 'No matching entries.' : 'No entries in this view.'}</p> : (
                <ul>
                  {directory.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button" aria-current={entry.id === location.entryId ? 'page' : undefined}
                        disabled={navigationLocked} onClick={() => navigate({ ...location, entryId: entry.id })}
                      ><strong>{entry.name}</strong><span>{kindLabel[entry.kind]}</span></button>
                    </li>
                  ))}
                </ul>
              )}
            </nav>
            <div className="wiki-article">
              {editing?.kind === 'create' && <WikiEntryForm {...actions} fixedKind={editing.fixedKind} entries={view.entries} fields={view.fields} at={view.at} />}
              {editing && editing.kind !== 'create' && editing.kind !== 'new-event' && view.article && (
                <WikiEditForm edit={editing} {...actions} entry={view.article.entry} fields={view.fields} entries={view.entries} at={view.at} />
              )}
              {!editing && view.article && (
                <Article
                  article={view.article} onEdit={view.can_edit ? beginEdit : undefined}
                  display={{ view, navigationLocked, openEntry }}
                  onTimeline={(event) => navigate({ ...location, section: 'timeline', entryId: '', eventId: event.id })}
                />
              )}
              {!editing && !view.article && <p className="muted">Choose an entry to read it at the selected world time.</p>}
            </div>
          </div>}
        </>
      )}
    </>
  )
}
