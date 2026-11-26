import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getWorld, type SignedInSession, type World } from './api'
import { getDraft, getEntryProblems, readPendingEdit, restoreWorkspace, saveDraft, savePendingEdit, type Draft, type DraftSource, type Edit, type Entry, type PendingEdit, type ScenarioSection, type WorkspaceRecovery } from './draft-api'
import { EntryForm, LinkForm, entryLabel, entryName, entryOption, linkLabel, visibilityLabel } from './draft-forms'
import { DraftLayout } from './draft-layout'
import { DraftRules } from './draft-rules'
import { DraftStart } from './draft-start'
import { draftValue, ruleChoices, sameValue } from './scenario-fields'

type Panel = { mode: 'new' } | { mode: 'edit' | 'link'; entry: Entry }
type Section = 'entries' | ScenarioSection
const sectionLabels: Record<Section, string> = {
  entries: 'Entries', layout: 'Layout & facts', rules: 'Rules', start: 'Starting state',
}

const fieldLabel: Record<string, string> = {
  name: 'Name', visibility: 'Visibility', role_id: 'Role', parent_place_id: 'Parent place',
  from_id: 'Link source', to_id: 'Link target', bounds: 'Room bounds', description: 'Description',
  archetype: 'Archetype', at: 'Point coordinates', point_id: 'Position', subject_id: 'Fact subject',
  effective_from_tick: 'Starting tick', effective_until_tick: 'Ending tick', progress_rule_id: 'Progression rule',
  required_fact_id: 'Required fact', destination_point_id: 'Alarm point', action_rule_ids: 'Granted rules',
}

function issueLabel(pointer?: string) {
  const field = pointer?.split('/').at(-1)
  return field ? fieldLabel[field] : undefined
}

function revisionLink(revision?: number) {
  const url = new URL(window.location.href)
  if (revision === undefined) url.searchParams.delete('revision')
  else url.searchParams.set('revision', String(revision))
  return url.pathname + url.search
}

export function DraftEditor({ worldId, account, onAuthError }: {
  worldId: string
  account: SignedInSession
  onAuthError: (error: unknown) => boolean
}) {
  const [revision] = useState(() => {
    const raw = new URLSearchParams(window.location.search).get('revision')
    return raw === null ? undefined : Number(raw)
  })
  const [section, setSection] = useState<Section>(() => {
    const value = new URLSearchParams(window.location.search).get('section')
    return value === 'layout' || value === 'rules' || value === 'start' ? value : 'entries'
  })
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('entry'))
  const [data, setData] = useState<{ world: World; draft: Draft } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadNumber, setLoadNumber] = useState(0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [pending, setPending] = useState(() => readPendingEdit(account.account_id, worldId))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [issues, setIssues] = useState<ApiError['fieldErrors']>([])
  const [conflict, setConflict] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const [entryProblems, setEntryProblems] = useState<{ key: string; problems: Draft['problems'] } | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceVersion, setWorkspaceVersion] = useState(0)
  const [recovery, setRecovery] = useState<WorkspaceRecovery | null>(null)
  const initialPending = useRef(pending)
  const initialSection = useRef(section)
  const resetAfterLoad = useRef(false)
  const draftRequest = useRef<AbortController | null>(null)
  const selectedRevision = data?.draft.problems.length === 100 && selectedId && data.draft.source.entities[selectedId]
    ? data.draft.revision
    : undefined
  const problemKey = selectedId + ':' + selectedRevision

  const clearDraft = useCallback(() => {
    draftRequest.current?.abort()
    initialPending.current = null
    resetAfterLoad.current = false
    savePendingEdit(account.account_id, worldId, null)
    setData(null)
    setPanel(null)
    setPending(null)
    setRecovery(null)
    setEntryProblems(null)
    setWorkspaceBusy(false)
    setStatus('')
    setSaveError('')
    setIssues([])
    setConflict(null)
    setLoading(false)
    setLoadError('Draft unavailable.')
  }, [account.account_id, worldId])

  useEffect(() => {
    if (!selectedId || selectedRevision === undefined) return
    const controller = new AbortController()
    void getEntryProblems(worldId, selectedId, selectedRevision, controller.signal).then(
      (reply) => {
        if (!controller.signal.aborted) setEntryProblems({ key: problemKey, problems: reply.problems })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) onAuthError(error)
      },
    )
    return () => controller.abort()
  }, [onAuthError, problemKey, selectedId, selectedRevision, worldId])

  useEffect(() => {
    const controller = new AbortController()
    draftRequest.current = controller
    void Promise.all([
      getWorld(worldId, controller.signal),
      getDraft(worldId, revision, controller.signal),
    ]).then(
      async ([world, draft]) => {
        if (controller.signal.aborted) return
        const attempt = initialPending.current
        if (revision === undefined && attempt?.section === initialSection.current) {
          try {
            const base = attempt.revision === draft.revision ? draft : await getDraft(worldId, attempt.revision, controller.signal)
            if (!controller.signal.aborted) setRecovery(restoreWorkspace(attempt, base.source))
          } catch (error: unknown) {
            if (controller.signal.aborted || onAuthError(error)) return
            if (error instanceof ApiError && error.code === 'RESOURCE_UNAVAILABLE') {
              clearDraft()
              return
            }
          }
        }
        if (controller.signal.aborted) return
        initialPending.current = null
        if (resetAfterLoad.current) {
          resetAfterLoad.current = false
          setRecovery(null)
          setWorkspaceBusy(false)
          setWorkspaceVersion((version) => version + 1)
        }
        setData({ world, draft })
        setLoading(false)
        setLoadError('')
        setConflict(null)
      },
      (error: unknown) => {
        if (controller.signal.aborted || onAuthError(error)) return
        if (error instanceof ApiError && error.code === 'RESOURCE_UNAVAILABLE') {
          clearDraft()
          return
        }
        setLoading(false)
        setLoadError(
          error instanceof ApiError && error.code === 'REVISION_UNAVAILABLE'
            ? 'Draft revision unavailable.'
            : error instanceof ApiError && error.status === 404
              ? 'Draft unavailable.'
              : 'CGS couldn’t load the draft. Try again.',
        )
      },
    )
    return () => controller.abort()
  }, [clearDraft, loadNumber, onAuthError, revision, worldId])

  function refreshDraft() {
    setLoading(true)
    setLoadNumber((previous) => previous + 1)
  }

  function chooseSection(next: Section) {
    if (next === section) return
    const url = new URL(window.location.href)
    if (next === 'entries') url.searchParams.delete('section')
    else url.searchParams.set('section', next)
    window.history.replaceState(null, '', url)
    setSection(next)
    setRecovery(null)
    setSaveError('')
    setIssues([])
  }

  function chooseEntry(id: string | null) {
    setSelectedId(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('entry', id)
    else url.searchParams.delete('entry')
    window.history.replaceState(null, '', url)
  }

  function keepAttempt(attempt: PendingEdit | null) {
    savePendingEdit(account.account_id, worldId, attempt)
    setPending(attempt)
  }

  async function submit(attempt: PendingEdit) {
    if (saving || loading) return
    keepAttempt(attempt)
    setSaving(true)
    setStatus('')
    setSaveError('')
    setIssues([])
    try {
      const receipt = await saveDraft(worldId, attempt, account.csrf_token)
      keepAttempt(null)
      setPanel(null)
      if (attempt.selectedId) chooseEntry(attempt.selectedId)
      setStatus('Saved revision ' + receipt.revision + '.')
      resetAfterLoad.current = true
      refreshDraft()
    } catch (error) {
      if (onAuthError(error)) return
      if (error instanceof ApiError && error.code === 'RESOURCE_UNAVAILABLE') {
        clearDraft()
        return
      }
      if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) {
        keepAttempt(null)
        if (error.code === 'STALE_DRAFT') {
          setConflict(error.conflictRevision ?? data?.draft.revision ?? 0)
          setSaveError('Another save changed this draft. Load the latest revision and review your changes before saving again.')
        } else {
          setSaveError(error.status === 422 ? 'Review the affected fields and references.' : 'CGS couldn’t save these changes.')
        }
        setIssues(error.fieldErrors)
        const edit = attempt.edits[0]
        if (error.code === 'ACTION_UNAVAILABLE') {
          setPanel(null)
          resetAfterLoad.current = true
          refreshDraft()
        } else if (!panel && edit && edit.op !== 'remove' && edit.value && 'kind' in edit.value && /^\/entities\/[^/]+$/.test(edit.pointer)) {
          setPanel({ mode: 'edit', entry: edit.value as Entry })
        }
      } else {
        setSaveError('CGS couldn’t confirm the save. Retry to recover the original result.')
      }
    } finally {
      setSaving(false)
    }
  }

  function commit(edits: Edit[], id?: string) {
    if (!data || pending || conflict !== null) return
    void submit({ revision: data.draft.revision, key: crypto.randomUUID(), edits, selectedId: id, section: section === 'entries' ? undefined : section })
  }

  function saveWorkspace(edits: Edit[], baseline: DraftSource) {
    if (!data) return
    const latest = data.draft.source
    if (edits.some(({ pointer }) => !sameValue(draftValue(latest, pointer), draftValue(baseline, pointer)))) {
      setIssues([])
      setSaveError('This part of the draft also changed. Review your staged values before discarding them and reopening the latest version.')
      return
    }
    commit(edits)
  }

  const worldPath = '/worlds/' + worldId + '/'
  if (!data) return (
    <>
      <a className="back-link" href={worldPath}>← World overview</a>
      {loading && <p className="muted" role="status">Loading draft…</p>}
      {loadError && (
        <section className="error-state">
          <h1>{loadError}</h1>
          <button className="button secondary" type="button" onClick={refreshDraft}>Try again</button>
        </section>
      )}
    </>
  )

  const { world, draft } = data
  const entries = Object.values(draft.source.entities)
    .sort((first, second) => entryName(first).localeCompare(entryName(second)) || first.id.localeCompare(second.id))
  const selected = selectedId ? draft.source.entities[selectedId] : undefined
  const links = selected
    ? Object.values(draft.source.links).filter((link) => link.from_id === selected.id || link.to_id === selected.id)
    : []
  const selectedIssues = entryProblems?.key === problemKey
    ? entryProblems.problems
    : selected ? draft.problems.filter((issue) => issue.pointer?.startsWith('/entities/' + selected.id + '/')) : []
  const current = revision === undefined
  const canEdit = current && (world.role === 'owner' || world.capabilities.includes('edit_world'))
  const blocked = loading || saving || Boolean(pending) || conflict !== null || Boolean(loadError)
  const draftIssues = draft.problems.filter((issue) => ['/layout', '/start'].includes(issue.pointer ?? ''))

  return (
    <>
      <a className="back-link" href={worldPath}>← World overview</a>
      <div className="workspace-heading">
        <div>
          <h1>{world.name}</h1>
          <p className="muted">{current ? 'Draft' : 'Historical draft'} · Revision {draft.revision}</p>
        </div>
        {canEdit && section === 'entries' && <button className="button primary" disabled={blocked || panel !== null} onClick={() => setPanel({ mode: 'new' })}>Add entry</button>}
      </div>
      <nav className="draft-history" aria-label="Draft history">
        {draft.revision > 0 && <a href={revisionLink(draft.revision - 1)}>Previous revision</a>}
        {!current && <a href={revisionLink()}>Latest draft</a>}
        {current && !canEdit && <span>Read only</span>}
      </nav>
      <nav className="draft-sections" aria-label="Draft authoring sections">
        {(Object.keys(sectionLabels) as Section[]).map((next) => (
          <button key={next} type="button" aria-current={next === section ? 'page' : undefined}
            disabled={next !== section && (Boolean(panel) || workspaceBusy || saving || Boolean(pending))}
            onClick={() => chooseSection(next)}>{sectionLabels[next]}</button>
        ))}
      </nav>
      {loading && <p className="muted" role="status">Loading draft…</p>}
      {loadError && <p className="error-message" role="alert">{loadError} <button className="button secondary" onClick={refreshDraft}>Try again</button></p>}
      {status && !loading && <p className="notice success" role="status">{status}</p>}
      {saveError && (
        <div className="error-message" role="alert">
          <p>{saveError}</p>
          {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={index} title={issue.pointer}>{issueLabel(issue.pointer) && <strong>{issueLabel(issue.pointer)}. </strong>}{issue.message}</li>)}</ul>}
        </div>
      )}
      {conflict !== null && <button className="button secondary" disabled={loading} onClick={refreshDraft}>Load revision {conflict}</button>}
      {current && pending && !saving && (
        <div className="draft-recovery">
          {!saveError && <p className="notice" role="status">A previous save is unconfirmed.</p>}
          {canEdit && <button className="button primary" disabled={loading} onClick={() => void submit(pending)}>Retry save</button>}
        </div>
      )}
      {section === 'layout' && <DraftLayout key={workspaceVersion} draft={draft} recovery={recovery?.section === 'layout' ? recovery : undefined}
        disabled={blocked} editable={canEdit} onBusy={setWorkspaceBusy} onSave={saveWorkspace} />}
      {section === 'rules' && <DraftRules key={workspaceVersion} draft={draft} recovery={recovery?.section === 'rules' ? recovery : undefined}
        disabled={blocked} editable={canEdit} onBusy={setWorkspaceBusy} onSave={saveWorkspace} />}
      {section === 'start' && <DraftStart key={workspaceVersion} draft={draft} recovery={recovery?.section === 'start' ? recovery : undefined}
        disabled={blocked} editable={canEdit} onBusy={setWorkspaceBusy} onSave={saveWorkspace} />}
      {section === 'entries' && <div className="draft-columns">
        <section className="draft-sheet" aria-labelledby="draft-entries">
          <h2 id="draft-entries">Entries</h2>
          {entries.length === 0 ? <p className="muted">No entries yet.</p> : (
            <ul className="draft-list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    className="draft-entry"
                    aria-current={entry.id === selectedId ? 'true' : undefined}
                    disabled={saving || panel !== null}
                    onClick={() => { setPanel(null); chooseEntry(entry.id) }}
                  >{entryOption(entry, entries)}</button>
                </li>
              ))}
            </ul>
          )}
          {draftIssues.length > 0 && (
            <details className="draft-checks">
              <summary>Scenario setup</summary>
              <ul>{draftIssues.map((issue) => <li key={issue.pointer}>{issue.message}</li>)}</ul>
            </details>
          )}
        </section>

        <section className="draft-sheet" aria-label="Entry details">
          {panel?.mode === 'new' || panel?.mode === 'edit' ? (
            <>
              <h2>{panel.mode === 'new' ? 'New entry' : 'Edit entry'}</h2>
              <EntryForm
                key={panel.mode === 'new' ? 'new' : panel.entry.id}
                record={panel.mode === 'edit' ? panel.entry : undefined}
                entries={entries}
                source={draft.source}
                disabled={blocked}
                onSave={(entry) => {
                  const latest = draft.source.entities[entry.id]
                  if (panel.mode === 'edit' && !sameValue(latest, panel.entry)) {
                    setSaveError('This entry also changed in the latest draft. Copy any of your changes you want to keep, then cancel and reopen the entry.')
                    return
                  }
                  commit([{
                    op: latest ? 'set' : 'add',
                    pointer: '/entities/' + entry.id,
                    value: entry,
                  }], entry.id)
                }}
                onClose={() => setPanel(null)}
              />
            </>
          ) : panel?.mode === 'link' ? (
            <>
              <h2>New link</h2>
              <LinkForm
                key={panel.entry.id}
                source={panel.entry}
                entries={entries}
                disabled={blocked}
                onSave={(link) => commit([{ op: 'add', pointer: '/links/' + link.id, value: link }], link.from_id)}
                onClose={() => setPanel(null)}
              />
            </>
          ) : selected ? (
            <>
              <div className="draft-entry-heading">
                <div>
                  <p className="muted">{entryLabel[selected.kind]}</p>
                  <h2>{entryName(selected)}</h2>
                </div>
                {canEdit && (
                  <button className="button secondary" disabled={blocked} onClick={() => setPanel({ mode: 'edit', entry: selected })}>Edit entry</button>
                )}
              </div>
              {selected.description && <p>{selected.description}</p>}
              <dl className="draft-meta">
                <dt>Visibility</dt>
                <dd>{selected.visibility ? visibilityLabel[selected.visibility] : 'Undecided'}</dd>
                {selected.archetype && <><dt>Archetype</dt><dd>{selected.archetype}</dd></>}
                {selected.policy && <><dt>Behavior</dt><dd>{selected.policy.mode === 'hold' ? 'Hold position' : 'Move to alarm on a stimulus'}</dd></>}
                {selected.action_rule_ids && <><dt>Granted rules</dt><dd>{ruleChoices(draft.source.rules)
                  .filter(({ value }) => selected.action_rule_ids?.includes(value)).map(({ label }) => label).join(', ') || 'None'}</dd></>}
              </dl>
              {selectedIssues.length > 0 && (
                <details className="draft-checks" open>
                  <summary>Before publication</summary>
                  <ul>{selectedIssues.map((issue) => <li key={issue.pointer}>{issue.message}</li>)}</ul>
                </details>
              )}
              <div className="draft-entry-heading">
                <h3>Links</h3>
                {canEdit && <button className="button secondary" disabled={blocked} onClick={() => setPanel({ mode: 'link', entry: selected })}>Add link</button>}
              </div>
              {links.length === 0 ? <p className="muted">No links yet.</p> : (
                <ul className="draft-list">
                  {links.map((link) => {
                    const outgoing = link.from_id === selected.id
                    const target = draft.source.entities[outgoing ? link.to_id : link.from_id]
                    if (!target) return null
                    return (
                      <li className="draft-link-row" key={link.id}>
                        <div>
                          <p className="muted">{linkLabel[link.kind]} · {outgoing ? 'To' : 'From'}</p>
                          <button className="text-button" onClick={() => chooseEntry(target.id)}>{entryOption(target, entries)}</button>
                        </div>
                        {canEdit && <button className="button secondary" disabled={blocked} onClick={() => {
                          if (window.confirm('Remove this link?')) commit([{ op: 'remove', pointer: '/links/' + link.id }])
                        }}>Remove link</button>}
                      </li>
                    )
                  })}
                </ul>
              )}
              {canEdit && <button className="button secondary draft-remove" disabled={blocked} onClick={() => {
                if (window.confirm('Remove this entry from the draft?')) commit([{ op: 'remove', pointer: '/entities/' + selected.id }])
              }}>Remove entry</button>}
            </>
          ) : (
            <p className="muted">{selectedId ? 'This entry is unavailable in this revision.' : 'Select an entry to see its details.'}</p>
          )}
        </section>
      </div>}
    </>
  )
}
