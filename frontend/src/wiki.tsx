import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, type SignedInSession } from './api'
import {
  getWiki, isWikiActor, readWikiAttempt, saveWikiChange, storeWikiAttempt,
  type WikiArticle, type WikiAttempt, type WikiCommand, type WikiEntry, type WikiEntryTemplate, type WikiKind,
  type WikiLinkedFact, type WikiLocation, type WikiSection, type WikiValue, type WikiView,
} from './wiki-api'
import { kindLabel, type ArticleEdit, WikiCalendarForm, WikiEditForm, WikiEntryForm, WikiEventForm, WikiEvidenceForm } from './wiki-forms'
import { formatDistribution } from './wiki-distribution'
import { WikiGroupForm, WikiOrganizeForm } from './wiki-event-outline'
import { isLayoutEdit, WikiLayoutForm, WikiLayoutPanel, type LayoutEdit } from './wiki-layout'
import { WikiTimeline, type TimelineEdit } from './wiki-timeline'
import { entryLabel, sectionFor, sections, WikiDirectory, WikiHistoryControls, WikiHome, WikiNavigation, WikiSearch } from './wiki-workspace'

const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
type WikiEdit = ArticleEdit | TimelineEdit | LayoutEdit
  | { kind: 'create'; fixedTemplate?: WikiEntryTemplate; ownerId?: string } | { kind: 'calendar' }

function initialLocation(): WikiLocation {
  const params = new URLSearchParams(window.location.search)
  const rawAt = params.get('at')
  const at = rawAt && /^\d+$/.test(rawAt) && Number.isSafeInteger(Number(rawAt)) ? Number(rawAt) : null
  const entry = params.get('entry') ?? ''
  const viewpoint = params.get('view_as') ?? ''
  const eventId = params.get('event') ?? ''
  const entryId = validId.test(entry) ? entry : ''
  const viewAs = validId.test(viewpoint) ? viewpoint : ''
  const section = sections.find((item) => item.key === params.get('section'))?.key ?? (entryId ? 'all' : 'overview')
  return {
    // Older character-view bookmarks could omit their original zero date.
    at: at ?? (viewAs ? 0 : null),
    entryId,
    viewAs,
    section,
    eventId: validId.test(eventId) ? eventId : '',
    history: params.get('tab') === 'history',
  }
}

type Display = {
  view: WikiView
  openEntry: (id: string, at?: number) => void
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

function Family({ family, display, onEdit }: {
  family: NonNullable<WikiArticle['family']>; display: Display; onEdit?: (edit: ArticleEdit) => void
}) {
  return (
    <section className="wiki-block" aria-label="Family">
      <div className="wiki-card-heading">
        <h2>Family at time {display.view.at}</h2>
        {onEdit && <div className="form-actions">
          <button className="button secondary" type="button" onClick={() => onEdit({ kind: 'fact', field: 'parent' })}>Add parent</button>
          <button className="button secondary" type="button" onClick={() => onEdit({ kind: 'fact', field: 'sibling' })}>Add sibling</button>
        </div>}
      </div>
      <dl className="wiki-facts">
        <div><dt>Parents</dt><dd>{family.parents.length ? <ul className="wiki-records">
          {family.parents.map((id) => <li key={id}><EntryReference {...display} id={id} /></li>)}
        </ul> : <span className="muted">None recorded</span>}</dd></div>
        <div><dt>Children</dt><dd>{family.children.length ? <ul className="wiki-records">
          {family.children.map((id) => <li key={id}><EntryReference {...display} id={id} /></li>)}
        </ul> : <span className="muted">None recorded</span>}</dd></div>
        <div><dt>Siblings</dt><dd>{family.siblings.length ? <ul className="wiki-records">
          {family.siblings.map((relative) => <li key={relative.entry_id}>
            <EntryReference {...display} id={relative.entry_id} />
            {relative.declared && <small className="wiki-default-source">Recorded sibling</small>}
            {relative.shared_parent_ids.length > 0 && <small className="wiki-default-source">
              Shared parent {relative.shared_parent_ids.map((id) => <EntryReference {...display} id={id} key={id} />)}
            </small>}
          </li>)}
        </ul> : <span className="muted">None recorded</span>}</dd></div>
      </dl>
    </section>
  )
}

function Article({ article, display, history, historyControls, onShowHistory, onShowOverview, onEdit, onTimeline, onGoal, onLayoutEdit }: {
  article: WikiArticle; display: Display; onEdit?: (edit: ArticleEdit) => void
  history: boolean; historyControls: ReactNode; onShowHistory: () => void; onShowOverview: () => void
  onTimeline: (eventId: string) => void
  onGoal: (ownerId: string) => void
  onLayoutEdit?: (edit: LayoutEdit) => void
}) {
  const { view } = display
  const edit = display.navigationLocked ? undefined : onEdit
  const values = (article.values ?? []).filter((item) => item.state !== 'unknown' || item.field === 'death_tick')
  const summary = values.find((item) => item.field === 'description')
  const specificType = values.find((item) => ['place_type', 'group_type', 'item_type', 'ability_type'].includes(item.field))
  const articleKind = !article.entry.catalog_type && specificType?.state === 'value'
    ? specificType.value : entryLabel(article.entry)
  const firstLocation = isWikiActor(article.entry) ? article.assertions?.find((fact) => fact.field === 'located_in') : undefined
  const facts = values.filter((item) => item.state === 'conflict' || (
    item.field !== 'description' && item.field !== 'place_type' && item.field !== 'parent' && item.field !== 'sibling'
  ))
  const factSections = new Map(
    view.fields.filter((field) => field.kinds.includes(article.entry.kind)).map((field) => [field.section || 'Overview', field.key]),
  )
  const related = new Map<string, WikiLinkedFact[]>()
  for (const item of article.incoming_links ?? []) {
    if (article.family && item.field === 'parent') continue
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
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'overview' })}>Edit overview</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'rename' })}>Rename</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'fact' })}>Record fact</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'event' })}>Record dated change</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'claim' })}>Record claim</button>
          </div>
        )}
      </header>
      {!view.viewpoint && <nav className="wiki-article-tabs" aria-label="Article views">
        <button className="button secondary" type="button" aria-pressed={!history} disabled={display.navigationLocked} onClick={onShowOverview}>Overview</button>
        <button className="button secondary" type="button" aria-pressed={history} disabled={display.navigationLocked} onClick={onShowHistory}>History</button>
      </nav>}
      {article.entry.classification_needs_review && <p className="notice wiki-message">
        Review this item's dated vehicle classifications in History.
      </p>}
      {!history && !view.viewpoint && (
        article.overview ? <p className="wiki-article-summary wiki-prose">{article.overview}</p>
          : <p className="muted wiki-article-summary">
            {article.assertions?.some((fact) => fact.field === 'description')
              ? 'The recorded descriptions are available in History.' : 'No overview written yet.'}
          </p>
      )}
      {(history || view.viewpoint) && historyControls}
      {!view.viewpoint && history && (
        <>
          {view.at !== null && <>
          {summary?.state === 'value' && <section className="wiki-block" aria-label="Description at the selected time">
            <h2>Description at time {view.at}</h2><p className="wiki-prose">{summary.value}</p>
          </section>}
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
          {article.family && <Family family={article.family} display={display} onEdit={edit} />}
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
          </>}
          {article.entry.kind === 'place' && view.at === null &&
            <p className="muted wiki-block">Choose a date above to view or edit the measured layout.</p>}
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
                      {fact.event_id && <button type="button" className="wiki-reference" disabled={display.navigationLocked}
                        onClick={() => { if (fact.event_id) onTimeline(fact.event_id) }}>View event</button>}
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
          <WikiTimeline key={article.entry.id} events={article.events ?? []} enclosing={article.event_ancestors ?? []}
            entries={view.entries} fields={view.fields} onFocus={onTimeline}
            onOpen={display.navigationLocked ? undefined : display.openEntry}
            onCorrectDate={edit && ((event) => edit({ kind: 'correct-date', event }))} />
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
      {(history || view.viewpoint) && <>
        <Propositions article={article} display={display} edit={edit} />
        <Observations article={article} display={display} />
      </>}
    </>
  )
}

function timeOfChange(command: WikiCommand) {
  switch (command.op) {
    case 'record_fact':
    case 'record_proposition':
    case 'save_layout':
    case 'save_waypoint':
    case 'save_connection':
      return command.from_tick
    case 'record_claim':
    case 'record_event':
    case 'correct_event_date':
      return command.tick
    case 'record_observation':
    case 'record_learned_ability':
    case 'correct_learned_ability':
      return command.learned_at
    default:
      return null
  }
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
  const [buildMode, setBuildMode] = useState(true)
  const content = useRef<HTMLDivElement>(null)
  const focusContent = useRef(false)

  const { at, entryId, viewAs } = location
  const timeline = location.section === 'timeline'
  const key = JSON.stringify([at, viewAs, timeline, entryId, refresh])
  const view = result?.key === key ? result.view : undefined
  const failure = result?.key === key ? result.error : undefined
  const activeArticle = view?.article
  const requestedSection = location.section ?? (entryId ? 'all' : 'overview')
  const section = activeArticle && (requestedSection === 'library' || requestedSection === 'overview')
    ? sectionFor(activeArticle.entry) : requestedSection
  const directory = sections.find((item) => item.key === section)
  const showingHistory = Boolean(location.history || at !== null)
  const navigationLocked = Boolean(editing || attempt || saving)
  const canBuild = Boolean(view?.can_edit && buildMode)
  const clearAttempt = useCallback(() => {
    storeWikiAttempt(account.account_id, worldId, null)
    setAttempt(null)
  }, [account.account_id, worldId])

  useEffect(() => {
    const controller = new AbortController()
    void getWiki(worldId, { at, viewAs, entryId, section: timeline ? 'timeline' : undefined }, controller.signal).then((data) => {
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
  }, [worldId, at, viewAs, entryId, timeline, key, clearAttempt, onAuthError])

  useEffect(() => {
    const params = new URLSearchParams()
    if (at !== null) params.set('at', String(at))
    if (viewAs) params.set('view_as', viewAs)
    if (entryId) params.set('entry', entryId)
    if (section !== 'overview') params.set('section', section)
    if (timeline && location.eventId) params.set('event', location.eventId)
    if (entryId && location.history) params.set('tab', 'history')
    window.history.replaceState(null, '', window.location.pathname + (params.size ? '?' + params.toString() : '') + window.location.hash)
  }, [at, viewAs, entryId, section, timeline, location.eventId, location.history])

  useEffect(() => {
    if (view && focusContent.current) {
      focusContent.current = false
      content.current?.focus({ preventScroll: true })
    }
  }, [view, location, editing])

  function navigate(next: WikiLocation) {
    setNotice('')
    setSaveError('')
    focusContent.current = true
    if (next.entryId !== entryId || next.section !== location.section) {
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
      window.scrollTo(0, 0)
    }
    setLocation(next)
  }

  function selectSection(next: WikiSection) {
    if (navigationLocked || (section === next && !entryId && !location.eventId)) return
    navigate({ section: next, entryId: '', viewAs, at: viewAs ? at : null })
  }

  function openArticle(entry: WikiEntry, destination: WikiSection, time = at) {
    if (navigationLocked) return
    navigate({ at: time, viewAs, entryId: entry.id, section: destination })
  }

  function openEntry(id: string, time = at) {
    const selected = view?.entries.find((entry) => entry.id === id)
    if (selected) openArticle(selected, section === 'all' ? 'all' : sectionFor(selected), time)
  }

  function beginEdit(edit: WikiEdit) {
    setNotice('')
    setSaveError('')
    focusContent.current = true
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
      focusContent.current = true
      const command = pending.command
      if (command.op === 'create_entry') {
        const created: WikiEntry = {
          id: saved.record_id, name: command.name, kind: command.kind, catalog_type: command.catalog_type,
        }
        const from = pending.location.section
        const destination = !from || from === 'overview' || from === 'all' ? 'all'
          : from === 'items' && created.kind === 'item' ? 'items' : sectionFor(created)
        setLocation({
          ...pending.location, entryId: created.id, section: destination, eventId: '',
          at: command.initial_at ?? null, history: false,
        })
      } else {
        const savedTime = pending.location.at ?? timeOfChange(command)
        const focusEvent = pending.location.section === 'timeline' && (
          command.op === 'record_event' || command.op === 'record_event_group' || command.op === 'edit_event'
          || command.op === 'organize_event' || command.op === 'correct_event_date'
        )
        setLocation({ ...pending.location, at: savedTime, eventId: focusEvent ? saved.record_id : pending.location.eventId })
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
    if (!canBuild || view?.edit_counter === undefined || attempt || stale) return
    void send({ command, edit: view.edit_counter, key: crypto.randomUUID(), location: { ...location, section } })
  }

  function showOverview() {
    navigate({ ...location, at: null, viewAs: '', history: false })
  }

  const actions = {
    onSave: save,
    busy: Boolean(attempt || saving || stale),
    onCancel: () => { setEditing(null); setSaveError(''); setStale(false); focusContent.current = true },
  }

  return (
    <>
      <a className="back-link" href={'/worlds/' + worldId + '/'}>← Back to world</a>
      {!view && !failure && <p className="muted" role="status">Loading Wiki…</p>}
      {failure && (
        <section className="error-state">
          <h1>{failure === 'unavailable' ? 'Wiki unavailable' : 'Couldn’t load the Wiki'}</h1>
          <button className="button secondary" type="button" onClick={() => {
            if (failure === 'unavailable') navigate({ at: null, viewAs: '', entryId: '' })
            setRefresh((previous) => previous + 1)
          }}>{failure === 'unavailable' ? 'Open Wiki home' : 'Try again'}</button>
        </section>
      )}
      {view && (
        <div className="wiki-workspace">
          <header className="wiki-workspace-header">
            <div className="wiki-world-title">
              <p className="muted">World Wiki</p>
              <h1>{view.world_name}</h1>
            </div>
            {canBuild && <WikiSearch worldId={worldId} revision={refresh} disabled={navigationLocked} onAuthError={onAuthError}
              onOpen={(entry) => openArticle(entry, sectionFor(entry), null)} />}
            <div className="form-actions wiki-workspace-actions">
              {view.can_edit && <div className="wiki-mode" role="group" aria-label="Wiki mode">
                <button className="button secondary" type="button" aria-pressed={!buildMode} disabled={navigationLocked}
                  onClick={() => setBuildMode(false)}>Read</button>
                <button className="button secondary" type="button" aria-pressed={buildMode} disabled={navigationLocked}
                  onClick={() => setBuildMode(true)}>Build</button>
              </div>}
              {canBuild && <button className="button primary" type="button" disabled={navigationLocked}
                onClick={() => beginEdit({ kind: 'create' })}>New entry</button>}
              {view.viewpoint && <button className="button secondary" type="button" onClick={showOverview}>Exit character view</button>}
            </div>
          </header>
          {view.viewpoint && <p className="notice wiki-message">Viewing as {view.viewpoint.name} at time {view.at}.</p>}
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
          <div className="wiki-workspace-body">
            <WikiNavigation section={section} disabled={navigationLocked} onSelect={selectSection} />
            <div className="wiki-workspace-content" tabIndex={-1} ref={content} aria-label="Wiki content">
              {editing?.kind === 'create' ? (
                <div className="wiki-article">
                  <WikiEntryForm {...actions} fixedTemplate={editing.fixedTemplate} ownerId={editing.ownerId}
                    entries={view.entries} fields={view.fields} at={view.at} />
                </div>
              ) : section === 'overview' ? (
                <WikiHome entries={view.entries} onSelect={selectSection} />
              ) : timeline ? (
                <div className="wiki-article">
                  {!editing && canBuild && <div className="form-actions wiki-section-actions">
                    <button className="button primary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'new-event' })}>New event</button>
                    <button className="button secondary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'new-group' })}>New group</button>
                    <button className="button secondary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'calendar' })}>Calendar settings</button>
                  </div>}
                  {!editing && <details className="wiki-timeline-view" open={at !== null ? true : undefined}>
                    <summary>Historical view</summary>
                    <WikiHistoryControls location={location} entries={view.entries} viewpoint={view.viewpoint}
                      disabled={navigationLocked} onChange={(time, observer) => navigate({ ...location, at: time, viewAs: observer })} />
                  </details>}
                  {editing?.kind === 'calendar' && <WikiCalendarForm {...actions} daysPerYear={view.days_per_year ?? null} />}
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
                    currentEvent={location.eventId} onEdit={canBuild && !navigationLocked ? beginEdit : undefined}
                    onFocus={(eventId) => navigate({ ...location, eventId })}
                    onOpen={navigationLocked ? undefined : openEntry} />}
                </div>
              ) : (
                <>
                  {canBuild && directory?.create && <div className="form-actions wiki-section-actions">
                    <button className="button primary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'create', fixedTemplate: directory.create })}>{directory.action}</button>
                  </div>}
                  <div className="wiki-layout">
                    <WikiDirectory key={section} section={section} entries={view.entries} currentId={entryId} disabled={navigationLocked}
                      onOpen={(entry) => openArticle(entry, section)} onPlaces={() => selectSection('places')} />
                    <div className="wiki-article">
                      {editing && isLayoutEdit(editing) && activeArticle?.layout && <WikiLayoutForm {...actions} edit={editing}
                        entry={activeArticle.entry} layout={activeArticle.layout} entries={view.entries} at={view.at} />}
                      {editing && !isLayoutEdit(editing) && editing.kind !== 'new-event' && editing.kind !== 'new-group'
                        && editing.kind !== 'organize' && editing.kind !== 'calendar' && activeArticle && (
                        <WikiEditForm edit={editing} {...actions} worldId={worldId} entry={activeArticle.entry} fields={view.fields}
                          entries={view.entries} at={view.at} overview={activeArticle.overview} observations={activeArticle.observations} />
                      )}
                      {!editing && activeArticle && (
                        <Article article={activeArticle} onEdit={canBuild ? beginEdit : undefined}
                          history={showingHistory}
                          historyControls={<WikiHistoryControls location={location} entries={view.entries} viewpoint={view.viewpoint}
                            disabled={navigationLocked} onChange={(time, observer) => navigate({
                              ...location, section, at: time, viewAs: observer, history: true,
                              entryId: observer && activeArticle.entry.author_only ? '' : entryId,
                            })} />}
                          onShowHistory={() => navigate({ ...location, section, history: true })}
                          onShowOverview={showOverview}
                          display={{ view, navigationLocked, openEntry }}
                          onTimeline={(eventId) => navigate({ ...location, section: 'timeline', entryId: '', eventId })}
                          onGoal={(ownerId) => beginEdit({ kind: 'create', fixedTemplate: 'goal', ownerId })}
                          onLayoutEdit={canBuild ? beginEdit : undefined}
                        />
                      )}
                      {!editing && !activeArticle && <p className="muted">
                        {directory?.action && canBuild ? 'Open an article or use ' + directory.action + ' to add one.'
                          : 'Choose an article to open it.'}
                      </p>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
