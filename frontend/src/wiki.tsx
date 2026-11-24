import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, type SignedInSession } from './api'
import {
  getWiki, isWikiActor, readWikiAttempt, saveWikiChange, storeWikiAttempt,
  type WikiArticle, type WikiAttempt, type WikiCommand, type WikiEvent, type WikiKind, type WikiLinkedFact,
  type WikiLocation, type WikiSection, type WikiValue, type WikiView,
} from './wiki-api'
import { kindLabel, type ArticleEdit, WikiCalendarForm, WikiEditForm, WikiEntryForm, WikiEventForm, WikiEvidenceForm } from './wiki-forms'
import { formatDistribution } from './wiki-distribution'
import { WikiGroupForm, WikiOrganizeForm } from './wiki-event-outline'
import { isLayoutEdit, WikiLayoutForm, WikiLayoutPanel, type LayoutEdit } from './wiki-layout'
import { WikiTimeline, type TimelineEdit } from './wiki-timeline'

const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const sections: { key: WikiSection; label: string }[] = [
  { key: 'all', label: 'Overview' }, { key: 'characters', label: 'Characters' },
  { key: 'places', label: 'Places' }, { key: 'timeline', label: 'Timeline' },
  { key: 'library', label: 'Library' },
]
type WikiEdit = ArticleEdit | TimelineEdit | LayoutEdit
  | { kind: 'create'; fixedKind?: WikiKind; ownerId?: string } | { kind: 'calendar' }

function sectionFor(kind: WikiKind): WikiSection {
  if (kind === 'person' || kind === 'organism') return 'characters'
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

function fieldLabel(view: WikiView, key: string, kind?: WikiKind) {
  if (key === 'located_in' && kind === 'place') return 'Part of'
  if (key === 'located_in' && kind === 'group') return 'Legacy location'
  if (key === 'located_in' && kind) return 'Location at this time'
  return view.fields.find((field) => field.key === key)?.label ?? key
}

function entryName(view: WikiView, id: string) {
  return view.entries.find((entry) => entry.id === id)?.name
}

function EntryReference({ id, view, openEntry, navigationLocked }: Display & { id: string }) {
  const name = entryName(view, id)
  return name ? (
    <button className="wiki-reference" type="button" disabled={navigationLocked} onClick={() => openEntry(id)}>{name}</button>
  ) : <span>Unavailable entry</span>
}

function ValueText({ field, value, ...display }: Display & { field: string; value: WikiValue }) {
  const definition = display.view.fields.find((item) => item.key === field)
  if (definition?.value_kind === 'distribution') return <span>{formatDistribution(value)}</span>
  return definition?.target_kinds.length && typeof value === 'string' ? <EntryReference {...display} id={value} /> : <span>{value}</span>
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
                {' · '}<EntryReference {...display} id={item.entry_id} />
                {item.qualifier_id && <> · <EntryReference {...display} id={item.qualifier_id} /></>}
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

function Propositions({ article, display, edit }: { article: WikiArticle; display: Display; edit?: (value: ArticleEdit) => void }) {
  const records = article.propositions ?? []
  const goal = article.entry.kind === 'goal'
  const label = goal ? 'Desired state' : 'Beliefs'
  const canRecord = isWikiActor(article.entry) || goal
  if (!canRecord && !records.length) return null
  return (
    <section className="wiki-block" aria-label={label}>
      <div className="wiki-card-heading">
        <h2>{label}</h2>
        {edit && canRecord && <button className="button secondary" type="button"
          onClick={() => edit({ kind: 'proposition' })}>{goal ? 'Record desired state' : 'Record belief'}</button>}
      </div>
      {!records.length && <p className="muted">{goal ? 'No desired state recorded.' : 'No beliefs recorded for this time.'}</p>}
      {records.length > 0 && <ul className="wiki-records">{records.map((record) => (
        <li className="wiki-record" key={record.id}>
          <div>
            <strong>{record.kind === 'desired_state' ? 'Desired state' : 'Belief'}</strong>
            {' · '}<EntryReference {...display} id={record.holder_id} />
            <p><EntryReference {...display} id={record.subject_id} /> · {fieldLabel(display.view, record.field)}
              {record.qualifier_id && <> · <EntryReference {...display} id={record.qualifier_id} /></>}
              {' · '}<ValueText {...display} field={record.field} value={record.value} /></p>
            <p className="muted">{times(record.from_tick, record.until_tick)}
              {record.about_tick === null ? '' : ' · About time ' + record.about_tick}
              {record.author_only ? ' · Author only' : ''}</p>
            {record.source && <p className="muted">{record.source}</p>}
            {record.evidence_id && <a href={'#wiki-record-' + record.evidence_id}>Recorded evidence</a>}
          </div>
          {edit && record.holder_id === article.entry.id && <button className="button secondary" type="button"
            onClick={() => edit({ kind: 'proposition', record })}>{goal ? 'Correct desired state' : 'Correct belief'}</button>}
        </li>
      ))}</ul>}
    </section>
  )
}

function Article({ article, display, onEdit, onTimeline, onGoal, onLayoutEdit }: {
  article: WikiArticle; display: Display; onEdit?: (edit: ArticleEdit) => void
  onTimeline: (event: WikiEvent) => void
  onGoal: (ownerId: string) => void
  onLayoutEdit?: (edit: LayoutEdit) => void
}) {
  const { view } = display
  const edit = display.navigationLocked ? undefined : onEdit
  const values = (article.values ?? []).filter((item) => item.state !== 'unknown' || item.field === 'death_tick')
  const summary = values.find((item) => item.field === 'description')
  const specificType = values.find((item) => ['place_type', 'group_type', 'item_type', 'ability_type'].includes(item.field))
  const articleKind = specificType?.state === 'value' ? specificType.value : kindLabel[article.entry.kind]
  const firstLocation = isWikiActor(article.entry) ? article.assertions?.find((fact) => fact.field === 'located_in') : undefined
  const facts = values.filter((item) => item.state === 'conflict' || (
    item.field !== 'description' && item.field !== 'place_type'
  ))
  const factSections = new Map(
    view.fields.filter((field) => field.kinds.includes(article.entry.kind)).map((field) => [field.section || 'Overview', field.key]),
  )
  const related = new Map<string, WikiLinkedFact[]>()
  for (const item of article.incoming_links ?? []) {
    const list = related.get(item.label) ?? []
    list.push(item)
    related.set(item.label, list)
  }
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
            {Array.from(factSections, ([section, firstField]) => {
              const group = facts.filter((item) =>
                (view.fields.find((field) => field.key === item.field)?.section || 'Overview') === section)
              const identity = section === 'Identity and classification' && article.age_years !== undefined
              const showGoal = section === 'Mind and goals' && isWikiActor(article.entry) && edit
              const locationHistory = section === 'Spatial relationships' ? firstLocation : undefined
              if (!group.length && !edit && !identity && !locationHistory) return null
              return <section className="wiki-fact-section" aria-label={section} key={section}>
                <div className="wiki-card-heading">
                  <h3>{section}</h3>
                  {edit && <div className="form-actions">
                    {showGoal && <button type="button" className="button secondary" onClick={() => onGoal(article.entry.id)}>New goal</button>}
                    <button type="button" className="button secondary" onClick={() => edit({ kind: 'fact', field: firstField })}>Add fact</button>
                  </div>}
                </div>
                <dl className="wiki-facts">
                  {identity && <div><dt>Age</dt><dd>{article.age_years === null ? 'Unknown at this time' : article.age_years + ' years'}</dd></div>}
                  {group.map((item) => (
                    <div key={[item.field, item.qualifier_id, item.state === 'value' ? item.value : item.state].join(':')}>
                      <dt>{fieldLabel(view, item.field, article.entry.kind)}
                        {item.qualifier_id && <> · <EntryReference {...display} id={item.qualifier_id} /></>}
                      </dt>
                      <dd>{item.state === 'value' ? <><ValueText {...display} field={item.field} value={item.value} />{item.unit && ' ' + item.unit}</>
                        : item.state === 'conflict' ? <span className="wiki-conflict">Conflicting values</span>
                        : <span className="muted">Unknown at this time</span>}
                        {item.default_sources?.length ? <small className="wiki-default-source">From {item.default_sources.map((id) =>
                          <EntryReference {...display} id={id} key={id} />)}</small> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
                {locationHistory && <a href={'#wiki-record-' + locationHistory.id}>Location history</a>}
              </section>
            })}
          </section>
          {Array.from(related, ([label, links]) => (
            <section className="wiki-block" key={label} aria-label={label}>
              <h2>{label}</h2>
              <ul className="wiki-records">{links.map((link) => (
                <li key={link.id} className="wiki-record">
                  <div><EntryReference {...display} id={link.entry_id} />
                    {link.qualifier_id && <> · <EntryReference {...display} id={link.qualifier_id} /></>}
                    <p className="muted">{times(link.from_tick, link.until_tick)}{link.source ? ' · ' + link.source : ''}</p>
                  </div>
                </li>
              ))}</ul>
            </section>
          ))}
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
              <div className="wiki-place-contents">
                {[{ title: 'Parts', items: article.parts ?? [] }, { title: 'Occupants', items: article.occupants ?? [] }].map(({ title, items }) => (
                  <section key={title} aria-label={title}>
                    <h3>{title}</h3>
                    {items.length ? <ul className="wiki-contents">{items.map((item) => (
                      <li key={item.id}><EntryReference {...display} id={item.id} /> <span className="muted">{kindLabel[item.kind]}</span></li>
                    ))}</ul> : <p className="muted">None recorded at this time.</p>}
                  </section>
                ))}
              </div>
            </section>
          )}
          {article.layout && <WikiLayoutPanel layout={article.layout} entries={view.entries}
            onEdit={display.navigationLocked ? undefined : onLayoutEdit}
            onOpen={(id) => { if (!display.navigationLocked) display.openEntry(id) }} />}
          {article.legacy_location_review && <p className="notice wiki-message">
            Review this group's legacy location. The old record may describe headquarters or physical whereabouts.
          </p>}
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
                      <p className="muted">{event.tick === null ? 'Event group' : 'Time ' + event.tick}{event.source ? ' · ' + event.source : ''}</p>
                      {event.links.some((link) => link.role === 'backstory' && link.entry_id === article.entry.id)
                        && <p className="muted">Backstory</p>}
                      {(event.summary || event.description) && <p className="wiki-prose">{event.summary || event.description}</p>}
                    </div>
                    <div className="form-actions">
                      <button className="button secondary" type="button" disabled={display.navigationLocked}
                        onClick={() => onTimeline(event)}>View in timeline</button>
                      {edit && event.tick !== null && <button className="button secondary" type="button"
                        onClick={() => edit({ kind: 'correct-date', event })}>Correct event date</button>}
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
                    {claim.qualifier_id && <> · <EntryReference {...display} id={claim.qualifier_id} /></>}
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
      <Propositions article={article} display={display} edit={edit} />
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
  const key = JSON.stringify([location.at, location.viewAs, location.section, location.entryId, refresh])
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
        setLocation({
          ...pending.location,
          at: pending.command.initial_at ?? pending.location.at,
          entryId: saved.record_id,
          section: nextSection,
        })
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
                  <>
                    <button className="button primary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'new-event' })}>New event</button>
                    <button className="button secondary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'new-group' })}>New group</button>
                  </>
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
              <label className="field">View state at time
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
                {view.entries.filter(isWikiActor).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
                {view.viewpoint && !view.entries.some((entry) => entry.id === view.viewpoint?.id) && (
                  <option value={view.viewpoint.id}>{view.viewpoint.name}</option>
                )}
              </select>
            </label>
            {view.can_edit && section !== 'timeline' && (
              <button className="button secondary" type="button" disabled={navigationLocked}
                onClick={() => beginEdit({ kind: 'calendar' })}>Calendar settings</button>
            )}
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
              {(editing?.kind === 'new-event' || (editing?.kind === 'edit-event' && editing.event.node_kind !== 'group')) && (
                <WikiEventForm {...actions} worldId={worldId} fields={view.fields} entries={view.entries} at={view.at} events={view.timeline}
                  event={editing.kind === 'edit-event' ? editing.event : undefined}
                  parents={view.timeline?.filter((event) => event.node_kind === 'group')}
                  parentId={editing.kind === 'new-event' ? editing.parentId : undefined}
                  action={editing.kind === 'new-event' && editing.action} />
              )}
              {(editing?.kind === 'new-group' || (editing?.kind === 'edit-event' && editing.event.node_kind === 'group')) && (
                <WikiGroupForm {...actions} worldId={worldId} fields={view.fields} at={view.at} entries={view.entries} events={view.timeline ?? []}
                  parentId={editing.kind === 'new-group' ? editing.parentId : undefined}
                  event={editing.kind === 'edit-event' ? editing.event : undefined} />
              )}
              {editing?.kind === 'organize' && <WikiOrganizeForm {...actions} event={editing.event} events={view.timeline ?? []} />}
              {editing?.kind === 'correct-date' && <WikiEvidenceForm {...actions} edit={editing} entries={view.entries} at={view.at} />}
              {!editing && <WikiTimeline events={view.timeline ?? []} entries={view.entries} fields={view.fields}
                currentEvent={location.eventId} onEdit={view.can_edit && !navigationLocked ? beginEdit : undefined}
                onFocus={(eventId) => navigate({ ...location, eventId })}
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
              {editing?.kind === 'create' && <WikiEntryForm {...actions} fixedKind={editing.fixedKind} ownerId={editing.ownerId}
                entries={view.entries} fields={view.fields} at={view.at} />}
              {editing?.kind === 'calendar' && <WikiCalendarForm {...actions} daysPerYear={view.days_per_year ?? null} />}
              {editing && isLayoutEdit(editing) && view.article?.layout && <WikiLayoutForm {...actions} edit={editing}
                entry={view.article.entry} layout={view.article.layout} entries={view.entries} at={view.at} />}
              {editing && !isLayoutEdit(editing) && editing.kind !== 'create' && editing.kind !== 'new-event'
                && editing.kind !== 'new-group' && editing.kind !== 'organize' && editing.kind !== 'calendar' && view.article && (
                <WikiEditForm edit={editing} {...actions} worldId={worldId} entry={view.article.entry} fields={view.fields} entries={view.entries}
                  at={view.at} observations={view.article.observations} />
              )}
              {!editing && view.article && (
                <Article
                  article={view.article} onEdit={view.can_edit ? beginEdit : undefined}
                  display={{ view, navigationLocked, openEntry }}
                  onTimeline={(event) => navigate({ ...location, section: 'timeline', entryId: '', eventId: event.id })}
                  onGoal={(ownerId) => beginEdit({ kind: 'create', fixedKind: 'goal', ownerId })}
                  onLayoutEdit={view.can_edit ? beginEdit : undefined}
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
