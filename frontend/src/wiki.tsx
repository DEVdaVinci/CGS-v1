import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, type SignedInSession } from './api'
import { WorkspaceLink } from './home-masthead'
import {
  getWiki, isWikiActor, readWikiAttempt, saveWikiChange, storeWikiAttempt, wikiHref,
  type WikiArticle, type WikiAttempt, type WikiCommand, type WikiEntry, type WikiEntryTemplate, type WikiKind,
  type WikiLinkedFact, type WikiLocation, type WikiSection, type WikiValue, type WikiView,
} from './wiki-api'
import { kindLabel, type ArticleEdit, WikiCalendarForm, WikiEditForm, WikiEntryForm, WikiEventForm, WikiEvidenceForm } from './wiki-forms'
import { formatDistribution } from './wiki-distribution'
import { WikiGroupForm, WikiOrganizeForm } from './wiki-event-outline'
import { isLayoutEdit, WikiLayoutForm, WikiLayoutPanel, type LayoutEdit } from './wiki-layout'
import { type MapView, WikiMapImageForm, WikiMapPanel } from './wiki-map'
import { WikiTimeline, type TimelineEdit } from './wiki-timeline'
import {
  entryLabel, sectionFor, sections, WikiDirectory, WikiHistoryControls, WikiHome, WikiIntroductionForm, WikiNavigation, WikiSearch,
} from './wiki-workspace'

const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
type WikiEdit = ArticleEdit | TimelineEdit | LayoutEdit
  | { kind: 'create'; fixedTemplate?: WikiEntryTemplate; ownerId?: string; chooser?: { label: string; types: WikiEntryTemplate[] } }
  | { kind: 'calendar' } | { kind: 'world-introduction' }
  | { kind: 'map-image'; map?: WikiEntry }

function initialLocation(): WikiLocation {
  const params = new URLSearchParams(window.location.search)
  const rawAt = params.get('at')
  const at = rawAt && /^\d+$/.test(rawAt) && Number.isSafeInteger(Number(rawAt)) ? Number(rawAt) : null
  const entry = params.get('entry') ?? ''
  const viewpoint = params.get('view_as') ?? ''
  const eventId = params.get('event') ?? ''
  const entryId = validId.test(entry) ? entry : ''
  const viewAs = validId.test(viewpoint) ? viewpoint : ''
  const requested = params.get('section')
  const section = requested === 'library' ? 'library'
    : sections.find((item) => item.key === requested)?.key ?? (entryId ? 'all' : 'overview')
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

function wikiMode(key: string, build?: boolean) {
  try {
    if (build !== undefined) sessionStorage.setItem(key, build ? 'build' : 'read')
    return sessionStorage.getItem(key) !== 'read'
  } catch {
    return build ?? true
  }
}

type Display = {
  view: WikiView
  openEntry: (id: string, at?: number | null) => void
  entryHref: (id: string, at?: number | null) => string
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

function EntryReference({ id, at, view, openEntry, entryHref, navigationLocked }: Display & { id: string; at?: number | null }) {
  const name = entryName(view, id)
  return name ? (
    <WorkspaceLink className="wiki-reference" href={entryHref(id, at)} disabled={navigationLocked}
      onFollow={() => openEntry(id, at)}>{name}</WorkspaceLink>
  ) : <span>Unavailable entry</span>
}

function ValueText({ field, value, unit, ...display }: Display & { field: string; value: WikiValue; unit?: string | null }) {
  const definition = display.view.fields.find((item) => item.key === field)
  if (definition?.target_kinds.length && typeof value === 'string') return <EntryReference {...display} id={value} />
  return <><span>{definition?.value_kind === 'distribution' ? formatDistribution(value) : value}</span>
    {unit ? ' ' + unit : definition?.uses_unit && <small className="muted"> · Unit unspecified</small>}
  </>
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
                <div><ValueText {...display} field={item.field} value={item.value} unit={item.unit} /></div>
                <p className="muted">
                  {viewpoint ? 'Learned' : (entryName(display.view, item.observer_id) ?? 'Character') + ' learned'} at time {item.learned_at}
                  {item.about_tick === null ? ' · About time unspecified' : ' · About time ' + item.about_tick}
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
  const goal = article.entry.kind === 'goal' || article.entry.kind === 'milestone'
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
              {' · '}<ValueText {...display} field={record.field} value={record.value} unit={record.unit} /></p>
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

function ArticleOverview({ article, display }: { article: WikiArticle; display: Display }) {
  const { view } = display
  const sections = article.sections ?? []
  const identityFields = ['birth_tick', 'death_tick', 'birthplace', 'origin', 'creation_tick', 'destruction_tick']
  const identity = identityFields.flatMap((key) => {
    const records = article.assertions?.filter((fact) => fact.field === key) ?? []
    return records.length === 1 && records[0].until_tick === null ? records : []
  })
  const isMap = article.entry.kind === 'map'
  return (
    <div className={isMap ? 'wiki-article-overview wiki-article-overview--map' : 'wiki-article-overview'}>
      {!isMap && <aside className="wiki-infobox" aria-label="Article facts">
        <h3>At a glance</h3>
        <dl>
          <div><dt>Type</dt><dd>{entryLabel(article.entry)}</dd></div>
          {identity.map((fact) => <div key={fact.id}>
            <dt>{fieldLabel(view, fact.field, article.entry.kind)}</dt>
            <dd><ValueText {...display} field={fact.field} value={fact.value} unit={fact.unit} />
              <small>Recorded from time {fact.from_tick}</small>
            </dd>
          </div>)}
        </dl>
      </aside>}
      <div className="wiki-article-prose">
        {article.overview ? <p className="wiki-prose wiki-lead">{article.overview}</p>
          : !isMap && <p className="muted">
            {article.assertions?.some((fact) => fact.field === 'description')
              ? 'The recorded descriptions are available in History.' : 'No overview written yet.'}
          </p>}
        {sections.length > 0 && <nav className="wiki-toc" aria-label="Article contents">
          <h3>Contents</h3>
          <ol>{sections.map((item) => <li key={item.id}><a href={'#section-' + item.id}>{item.heading}</a></li>)}</ol>
        </nav>}
        {sections.map((item) => <section className="wiki-prose-section" id={'section-' + item.id} key={item.id}>
          <h3>{item.heading}</h3>
          {item.body && <p className="wiki-prose">{item.body}</p>}
        </section>)}
      </div>
    </div>
  )
}

function Article({ article, display, breadcrumbs, history, historyControls, onShowHistory, onShowOverview, onEdit, onTimeline, onGoal, onLayoutEdit, mapPanel }: {
  article: WikiArticle; display: Display; onEdit?: (edit: ArticleEdit) => void
  breadcrumbs: ReactNode
  history: boolean; historyControls: ReactNode; onShowHistory: () => void; onShowOverview: () => void
  onTimeline: (eventId: string) => void
  onGoal: (ownerId: string) => void
  onLayoutEdit?: (edit: LayoutEdit) => void
  mapPanel?: ReactNode
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
      {breadcrumbs}
      <header className="wiki-article-title">
        <div>
          <p className="muted">{articleKind}{article.entry.author_only ? ' · Author only' : ''}</p>
          <h1>{article.entry.name}</h1>
        </div>
        {edit && (
          <div className="form-actions wiki-article-tools">
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'overview' })}>Edit overview</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'sections' })}>Edit sections</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'rename' })}>Rename</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'fact' })}>Record fact</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'event' })}>Record dated change</button>
            <button className="button secondary" type="button" onClick={() => edit({ kind: 'claim' })}>Record claim</button>
            {!article.entry.author_only && view.entries.some((entry) => isWikiActor(entry) && entry.id !== article.entry.id) &&
              <button className="button secondary" type="button" onClick={() => edit({ kind: 'discovery' })}>Record discovery</button>}
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
      {!history && !view.viewpoint && <ArticleOverview article={article} display={display} />}
      {!view.viewpoint && (!history || !article.image_map) && mapPanel}
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
                      <dd>{item.state === 'value' ? <ValueText {...display} field={item.field} value={item.value} unit={item.unit} />
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
                    <p className="muted">
                      {link.order_conflict ? 'Conflicting order · ' : link.order === null ? 'Order unspecified · '
                        : link.order !== undefined ? 'Position ' + link.order + ' · ' : ''}
                      {times(link.from_tick, link.until_tick)}{link.source ? ' · ' + link.source : ''}
                    </p>
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
                      <div><ValueText {...display} field={fact.field} value={fact.value} unit={fact.unit} /></div>
                      <p className="muted">{times(fact.from_tick, fact.until_tick)}{fact.author_only ? ' · Author only' : ''}</p>
                      {fact.citation_id && <p>Source article <EntryReference {...display} id={fact.citation_id} at={null} /></p>}
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
            entryHref={display.entryHref}
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
                      <div><ValueText {...display} field={claim.field} value={claim.value} unit={claim.unit} /></div>
                      <p className="muted">{claim.speaker_id ? entryName(view, claim.speaker_id) : 'Unknown speaker'}
                        {claim.tick !== null ? ' at time ' + claim.tick : claim.start_tick !== null
                          ? ' · Possible time ' + claim.start_tick + ' to ' + claim.end_tick : ' · Statement date unknown'}
                        {claim.author_only ? ' · Author only' : ''}
                      </p>
                      {claim.citation_id && <p>Source article <EntryReference {...display} id={claim.citation_id} at={null} /></p>}
                      {claim.source && <p className="muted">Source: {claim.source}</p>}
                    </div>
                    {edit && <div className="form-actions">
                      <button className="button secondary" type="button" onClick={() => edit({ kind: 'correct-claim', claim })}>Correct claim</button>
                      {!claim.author_only && !article.entry.author_only && <button className="button secondary" type="button"
                        onClick={() => edit({ kind: 'observe', source: claim, sourceKind: 'claim' })}>Record observation</button>}
                    </div>}
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
      {!view.viewpoint && history && Boolean(article.discoveries?.length) && (
        <section className="wiki-block" aria-label="Recorded discoveries">
          <h2>Recorded discoveries</h2>
          <ul className="wiki-records">{article.discoveries?.map((discovery) => <li key={discovery.observer_id} className="wiki-record">
            <div><EntryReference {...display} id={discovery.observer_id} />
              <p className="muted">Learned at time {discovery.learned_at}{discovery.source && ' · ' + discovery.source}</p>
            </div>
            {edit && <button className="button secondary" type="button"
              onClick={() => edit({ kind: 'discovery', discovery })}>Edit discovery</button>}
          </li>)}</ul>
        </section>
      )}
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
    case 'set_discovery':
      return command.learned_at
    default:
      return null
  }
}

export function Wiki({ account, worldId, onAuthError }: {
  account: SignedInSession; worldId: string; onAuthError: (error: unknown) => boolean
}) {
  const modeKey = 'cgs.wiki-mode.' + account.account_id + '.' + worldId
  const [attempt, setAttempt] = useState(() => readWikiAttempt(account.account_id, worldId))
  const [location, setLocation] = useState(() => attempt?.location ?? initialLocation())
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; view?: WikiView; error?: 'unavailable' | 'connection' } | null>(null)
  const [editing, setEditing] = useState<WikiEdit | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [stale, setStale] = useState(false)
  const [notice, setNotice] = useState('')
  const [buildMode, setBuildMode] = useState(() => wikiMode(modeKey))
  const [pinEditing, setPinEditing] = useState(false)
  const [eventTime, setEventTime] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const focusContent = useRef(false)
  const mapViews = useRef(new Map<string, MapView>())
  const pinGuard = useRef(false)
  const homeRequested = useRef(new URLSearchParams(window.location.search).get('edit_home') === '1')

  const { at, entryId, viewAs } = location
  const timeline = location.section === 'timeline'
  const key = JSON.stringify([at, viewAs, timeline, entryId, refresh])
  const view = result?.key === key ? result.view : undefined
  const failure = result?.key === key ? result.error : undefined
  const activeArticle = view?.article
  const requestedSection = location.section ?? (entryId ? 'all' : 'overview')
  const section = requestedSection === 'library' ? (activeArticle ? sectionFor(activeArticle.entry) : 'library')
    : activeArticle && requestedSection === 'overview' ? sectionFor(activeArticle.entry) : requestedSection
  const directory = sections.find((item) => item.key === section)
  const showingHistory = Boolean(location.history || at !== null)
  const navigationLocked = Boolean(editing || pinEditing || attempt || saving)
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
      if (unavailable && viewAs && entryId) {
        setNotice('That article is unavailable in this character’s viewpoint.')
        setLocation((previous) => ({ ...previous, entryId: '', history: false }))
        return
      }
      setResult({ key, error: unavailable ? 'unavailable' : 'connection' })
    })
    return () => controller.abort()
  }, [worldId, at, viewAs, entryId, timeline, key, clearAttempt, onAuthError])

  useEffect(() => {
    // An older Library link needs its loaded entry to select the new directory.
    const normalizedSection = requestedSection === 'library' && !view ? 'library' : section
    const state = pinGuard.current ? window.history.state : null
    window.history.replaceState(state, '', wikiHref(worldId, { ...location, section: normalizedSection }, window.location.hash))
  }, [worldId, location, requestedSection, section, view])

  useEffect(() => {
    function restoreLocation() {
      const next = initialLocation()
      const current = { ...location, section }
      if (pinGuard.current) {
        if (!window.history.state?.cgsPinEdit) {
          window.history.pushState({ cgsPinEdit: true }, '', wikiHref(worldId, current))
          if (!attempt && !saving) setSaveError('Save or cancel the pin before leaving this map.')
        }
        return
      }
      if (wikiHref(worldId, next) === wikiHref(worldId, current)) return
      if (navigationLocked) {
        window.history.pushState(null, '', wikiHref(worldId, current))
        if (!attempt && !saving) setSaveError('Save or cancel the current edit before leaving this page.')
        return
      }
      setSaveError('')
      setNotice('')
      setEventTime('')
      focusContent.current = true
      setLocation(next)
    }
    window.addEventListener('popstate', restoreLocation)
    return () => window.removeEventListener('popstate', restoreLocation)
  }, [worldId, attempt, location, navigationLocked, saving, section])

  useEffect(() => {
    if (!pinEditing) return
    const protectPin = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectPin)
    return () => window.removeEventListener('beforeunload', protectPin)
  }, [pinEditing])

  useEffect(() => {
    if (!view || !homeRequested.current) return
    homeRequested.current = false
    if (section === 'overview' && view.can_edit && !navigationLocked) {
      setBuildMode(wikiMode(modeKey, true))
      setEditing({ kind: 'world-introduction' })
      focusContent.current = true
    }
  }, [modeKey, navigationLocked, section, view])

  useEffect(() => {
    if (view && focusContent.current) {
      focusContent.current = false
      content.current?.focus({ preventScroll: true })
    }
  }, [view, location, editing])

  useEffect(() => {
    if (view && window.location.hash.startsWith('#section-')) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
    }
  }, [view])

  function navigate(next: WikiLocation) {
    setNotice('')
    setSaveError('')
    focusContent.current = true
    const url = wikiHref(worldId, next)
    if (url !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', url)
      window.scrollTo(0, 0)
    }
    setLocation(next)
  }

  const sectionLocation = (next: WikiSection) => ({ section: next, entryId: '', viewAs, at: viewAs ? at : null })
  const sectionHref = (next: WikiSection) => wikiHref(worldId, sectionLocation(next))
  const articleLocation = (entry: WikiEntry, destination: WikiSection, time: number | null = null) =>
    ({ at: viewAs ? at : time, viewAs, entryId: entry.id, section: destination })
  const articleHref = (entry: WikiEntry, destination: WikiSection, time: number | null = null) =>
    wikiHref(worldId, articleLocation(entry, destination, time))

  function selectSection(next: WikiSection) {
    if (navigationLocked || (section === next && !entryId && !location.eventId)) return
    if (next === 'timeline') setEventTime('')
    navigate(sectionLocation(next))
  }

  function openArticle(entry: WikiEntry, destination: WikiSection, time: number | null = null) {
    if (navigationLocked) return
    navigate(articleLocation(entry, destination, time))
  }

  function entryHref(id: string, time: number | null = at) {
    const selected = view?.entries.find((entry) => entry.id === id)
    return selected ? articleHref(selected, section === 'all' ? 'all' : sectionFor(selected), time) : sectionHref('all')
  }

  function openEntry(id: string, time: number | null = at) {
    const selected = view?.entries.find((entry) => entry.id === id)
    if (selected) openArticle(selected, section === 'all' ? 'all' : sectionFor(selected), time)
  }

  function beginEdit(edit: WikiEdit) {
    setNotice('')
    setSaveError('')
    focusContent.current = true
    setEditing(edit)
  }

  function changePinEditing(active: boolean) {
    if (pinGuard.current === active) return
    pinGuard.current = active
    setPinEditing(active)
    if (active) {
      // Keep a Back press in the current document even when the map was opened by a full page load.
      window.history.pushState({ cgsPinEdit: true }, '', window.location.href)
    } else {
      setSaveError('')
      if (window.history.state?.cgsPinEdit) window.history.back()
    }
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
      changePinEditing(false)
      focusContent.current = true
      const command = pending.command
      if (command.op === 'create_image_map' || command.op === 'attach_map_image') {
        navigate({ at: null, entryId: saved.record_id, section: 'maps', viewAs: '' })
      } else if (command.op === 'create_entry') {
        const created: WikiEntry = {
          id: saved.record_id, name: command.name, kind: command.kind, catalog_type: command.catalog_type,
        }
        const from = pending.location.section
        const destination = !from || from === 'overview' || from === 'all' ? 'all'
          : from === 'items' && created.kind === 'item' ? 'items' : sectionFor(created)
        navigate({
          ...pending.location, entryId: created.id, section: destination, eventId: '',
          at: command.initial_at ?? null, history: false,
        })
      } else {
        const savedTime = pending.location.at ?? timeOfChange(command)
        const focusEvent = pending.location.section === 'timeline' && (
          command.op === 'record_event' || command.op === 'record_event_group' || command.op === 'edit_event'
          || command.op === 'organize_event' || command.op === 'correct_event_date'
        )
        const history = pending.location.history || command.op === 'record_claim' || command.op === 'correct_claim'
        navigate({ ...pending.location, at: savedTime, history, eventId: focusEvent ? saved.record_id : pending.location.eventId })
      }
      setNotice('Wiki change saved.')
      setRefresh((previous) => previous + 1)
    } catch (error) {
      if (onAuthError(error)) return
      if (error instanceof ApiError && error.status < 500) {
        clearAttempt()
        if (error.status === 404 || error.status === 403) {
          setEditing(null)
          changePinEditing(false)
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
    onCancel: () => { setEditing(null); changePinEditing(false); setSaveError(''); setStale(false); focusContent.current = true },
  }
  const catalogActions = canBuild && <div className="form-actions wiki-catalog-actions">
    {section === 'maps' && <button className="button primary" type="button" disabled={navigationLocked}
      onClick={() => beginEdit({ kind: 'map-image' })}>New map</button>}
    {directory?.create?.map(({ type, label }, index) => <button key={type}
      className={index === 0 && section !== 'maps' ? 'button primary' : 'button secondary'} type="button" disabled={navigationLocked}
      onClick={() => beginEdit({ kind: 'create', fixedTemplate: type })}>{label}</button>)}
    {directory?.chooser && <button className="button primary" type="button" disabled={navigationLocked}
      onClick={() => beginEdit({ kind: 'create', chooser: directory.chooser })}>{directory.chooser.label}</button>}
    {section === 'all' && <button className="button secondary" type="button" disabled={navigationLocked}
      onClick={() => beginEdit({ kind: 'create' })}>Create article</button>}
  </div>

  return (
    <>
      {!view && <a className="back-link" href={'/worlds/' + worldId + '/'}>← Back to world</a>}
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
              <WorkspaceLink href={'/worlds/' + worldId + '/'} disabled={navigationLocked}>← Back to world</WorkspaceLink>
              <p>{view.world_name}</p>
            </div>
            {view.can_edit && !view.viewpoint && <WikiSearch worldId={worldId} revision={refresh} disabled={navigationLocked} onAuthError={onAuthError}
              hrefFor={(entry) => articleHref(entry, sectionFor(entry))} onOpen={(entry) => openArticle(entry, sectionFor(entry))} />}
            <div className="form-actions wiki-workspace-actions">
              {view.can_edit && <div className="wiki-mode" role="group" aria-label="Wiki mode">
                <button className="button secondary" type="button" aria-pressed={!buildMode} disabled={navigationLocked}
                  onClick={() => setBuildMode(wikiMode(modeKey, false))}>Read</button>
                <button className="button secondary" type="button" aria-pressed={buildMode} disabled={navigationLocked}
                  onClick={() => setBuildMode(wikiMode(modeKey, true))}>Build</button>
              </div>}
              {canBuild && <button className="button primary" type="button" disabled={navigationLocked}
                onClick={() => beginEdit({ kind: 'create' })}>New entry</button>}
              {view.viewpoint && <button className="button secondary" type="button" onClick={showOverview}>Exit character view</button>}
            </div>
          </header>
          {view.viewpoint && <p className="notice wiki-message">Viewing as {view.viewpoint.name} at time {view.at}.</p>}
          {pinEditing && <p className="notice wiki-message" role="status">Save or cancel the pin to leave this map.</p>}
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
            <WikiNavigation section={section} disabled={navigationLocked} hrefFor={sectionHref} onSelect={selectSection} />
            <div className="wiki-workspace-content" tabIndex={-1} ref={content} aria-label="Wiki content">
              {editing?.kind === 'map-image' ? (
                <div className="wiki-article">
                  <WikiMapImageForm {...actions} map={editing.map} worldId={worldId} token={account.csrf_token}
                    onAuthError={onAuthError} />
                </div>
              ) : editing?.kind === 'create' ? (
                <div className="wiki-article">
                  <WikiEntryForm {...actions} fixedTemplate={editing.fixedTemplate} chooser={editing.chooser} ownerId={editing.ownerId}
                    entries={view.entries} fields={view.fields} />
                </div>
              ) : editing?.kind === 'world-introduction' ? (
                <div className="wiki-article">
                  <WikiIntroductionForm {...actions} home={view.world_home} entries={view.entries} coverIds={view.home_cover_ids ?? []} />
                </div>
              ) : section === 'overview' ? (
                <WikiHome worldId={worldId} worldName={view.world_name} home={view.world_home} entries={view.entries} disabled={navigationLocked}
                  sectionHref={sectionHref} entryHref={(entry) => articleHref(entry, sectionFor(entry))} onSelect={selectSection}
                  onEntry={(entry) => openArticle(entry, sectionFor(entry))}
                  actions={canBuild && <button className="button secondary" type="button" disabled={navigationLocked}
                    onClick={() => beginEdit({ kind: 'world-introduction' })}>Edit world home</button>} />
              ) : timeline ? (
                <div className="wiki-article">
                  {!editing && <h1 className="wiki-page-title">Timeline</h1>}
                  {!editing && canBuild && <div className="form-actions wiki-section-actions">
                    <button className="button primary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'new-event' })}>New event</button>
                    <button className="button secondary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'new-group' })}>New group</button>
                    <button className="button secondary" type="button" disabled={navigationLocked}
                      onClick={() => beginEdit({ kind: 'calendar' })}>Calendar settings</button>
                  </div>}
                  {!editing && <details className="wiki-timeline-view" open={at !== null ? true : undefined}>
                    <summary>State and viewpoint</summary>
                    <WikiHistoryControls timeline location={location} entries={view.entries} viewpoint={view.viewpoint}
                      disabled={navigationLocked} onChange={(time, observer) => navigate({ ...location, at: time, viewAs: observer })} />
                  </details>}
                  {editing?.kind === 'calendar' && <WikiCalendarForm {...actions} daysPerYear={view.days_per_year ?? null} />}
                  {(editing?.kind === 'new-event' || (editing?.kind === 'edit-event' && editing.event.node_kind !== 'group')) && (
                    <WikiEventForm {...actions} worldId={worldId} fields={view.fields} entries={view.entries}
                      at={editing.kind === 'edit-event' ? view.at : null} events={view.timeline}
                      event={editing.kind === 'edit-event' ? editing.event : undefined}
                      parents={view.timeline?.filter((event) => event.node_kind === 'group')}
                      parentId={editing.kind === 'new-event' ? editing.parentId : undefined}
                      action={editing.kind === 'new-event' && editing.action} />
                  )}
                  {(editing?.kind === 'new-group' || (editing?.kind === 'edit-event' && editing.event.node_kind === 'group')) && (
                    <WikiGroupForm {...actions} worldId={worldId} fields={view.fields}
                      at={editing.kind === 'edit-event' ? view.at : null} entries={view.entries} events={view.timeline ?? []}
                      parentId={editing.kind === 'new-group' ? editing.parentId : undefined}
                      event={editing.kind === 'edit-event' ? editing.event : undefined} />
                  )}
                  {editing?.kind === 'organize' && <WikiOrganizeForm {...actions} event={editing.event} events={view.timeline ?? []} />}
                  {editing?.kind === 'correct-date' && <WikiEvidenceForm {...actions} edit={editing} entries={view.entries} at={view.at} />}
                  {!editing && <WikiTimeline events={view.timeline ?? []} entries={view.entries} fields={view.fields}
                    entryHref={entryHref}
                    eventTime={eventTime} onEventTimeChange={setEventTime}
                    currentEvent={location.eventId} onEdit={canBuild && !navigationLocked ? beginEdit : undefined}
                    onFocus={(eventId) => navigate({ ...location, eventId })}
                    onOpen={navigationLocked ? undefined : openEntry} />}
                </div>
              ) : (
                <>
                  {activeArticle && (
                    <div className="wiki-article">
                      {editing && isLayoutEdit(editing) && activeArticle?.layout && <WikiLayoutForm {...actions} edit={editing}
                        entry={activeArticle.entry} layout={activeArticle.layout} entries={view.entries} at={view.at} />}
                      {editing && !isLayoutEdit(editing) && editing.kind !== 'new-event' && editing.kind !== 'new-group'
                        && editing.kind !== 'organize' && editing.kind !== 'calendar' && activeArticle && (
                        <WikiEditForm edit={editing} {...actions} worldId={worldId} entry={activeArticle.entry} fields={view.fields}
                          entries={view.entries} at={view.at} overview={activeArticle.overview} sections={activeArticle.sections}
                          observations={activeArticle.observations} />
                      )}
                      {!editing && activeArticle && (
                        <Article article={activeArticle} onEdit={canBuild ? beginEdit : undefined}
                          breadcrumbs={<nav className="wiki-breadcrumbs" aria-label="Article location">
                            <WorkspaceLink className="wiki-reference" href={sectionHref('overview')} disabled={navigationLocked}
                              onFollow={() => selectSection('overview')}>World overview</WorkspaceLink>
                            <span aria-hidden="true">/</span>
                            <WorkspaceLink className="wiki-reference" href={sectionHref(section)} disabled={navigationLocked}
                              onFollow={() => selectSection(section)}>{directory?.label ?? 'Library'}</WorkspaceLink>
                          </nav>}
                          history={showingHistory}
                          historyControls={<WikiHistoryControls location={location} entries={view.entries} viewpoint={view.viewpoint}
                            disabled={navigationLocked} onChange={(time, observer) => navigate({
                              ...location, section, at: time, viewAs: observer, history: true,
                              entryId: observer && activeArticle.entry.author_only ? '' : entryId,
                            })} />}
                          onShowHistory={() => navigate({ ...location, section, history: true })}
                          onShowOverview={showOverview}
                          display={{ view, navigationLocked, openEntry, entryHref }}
                          onTimeline={(eventId) => {
                            setEventTime('')
                            navigate({ ...location, section: 'timeline', entryId: '', eventId })
                          }}
                          onGoal={(ownerId) => beginEdit({ kind: 'create', fixedTemplate: 'goal', ownerId })}
                          onLayoutEdit={canBuild ? beginEdit : undefined}
                          mapPanel={activeArticle.entry.kind === 'map' && <WikiMapPanel key={activeArticle.entry.id}
                            entry={activeArticle.entry} map={activeArticle.image_map} worldId={worldId} entries={view.entries}
                            busy={actions.busy} onSave={canBuild ? save : undefined}
                            onAttach={canBuild ? () => beginEdit({ kind: 'map-image', map: activeArticle.entry }) : undefined}
                            initialView={mapViews.current.get(activeArticle.entry.id)}
                            onViewChange={(mapView) => mapViews.current.set(activeArticle.entry.id, mapView)}
                            onEditing={changePinEditing} placeHref={(id) => entryHref(id, null)}
                            onOpenPlace={(id) => openEntry(id, null)} />}
                        />
                      )}
                    </div>
                  )}
                  {!editing && <WikiDirectory key={section} section={section} entries={view.entries} currentId={entryId}
                    disabled={navigationLocked} actions={catalogActions} hrefFor={(entry) => articleHref(entry, section)}
                    onOpen={(entry) => openArticle(entry, section)} onPlaces={() => selectSection('places')} />}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
