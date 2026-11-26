import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  createWorld,
  getWorld,
  listWorlds,
  readPendingCreation,
  savePendingCreation,
  type PendingCreation,
  type SignedInSession,
  type World,
} from './api'
import { HomeMasthead } from './home-masthead'
import { getWikiHome, wikiHref, type WikiWorldHome } from './wiki-api'
import { WikiHome } from './wiki-workspace'

type AuthErrorHandler = (error: unknown) => boolean

const roleLabel: Record<World['role'], string> = {
  owner: 'Owner',
  editor: 'Editor',
  reader: 'Reader',
  player: 'Player',
}

function recentWorld(accountId: string, worldId?: string) {
  try {
    const key = 'cgs.recent-world.' + accountId
    if (worldId) localStorage.setItem(key, worldId)
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function WorldLibrary({
  account,
  onAuthError,
}: {
  account: SignedInSession
  onAuthError: AuthErrorHandler
}) {
  const [worlds, setWorlds] = useState<World[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listFailed, setListFailed] = useState(false)
  const listRequest = useRef<AbortController | null>(null)
  const [attempt, setAttempt] = useState(() => readPendingCreation(account.account_id))
  const [formOpen, setFormOpen] = useState(Boolean(attempt))
  const [name, setName] = useState(attempt?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [createdName, setCreatedName] = useState('')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [resume, setResume] = useState<World>()
  const nameInput = useRef<HTMLInputElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)

  const loadPage = useCallback(async (cursor?: string) => {
    listRequest.current?.abort()
    const request = new AbortController()
    listRequest.current = request
    setListLoading(true)
    setListFailed(false)
    try {
      const page = await listWorlds(cursor, request.signal, query)
      if (request.signal.aborted) return
      setWorlds((previous) => cursor
        ? [...new Map([...previous, ...page.items].map((world) => [world.id, world])).values()]
        : page.items)
      setNextCursor(page.next_cursor)
    } catch (error) {
      if (!request.signal.aborted && !onAuthError(error)) setListFailed(true)
    } finally {
      if (!request.signal.aborted) setListLoading(false)
    }
  }, [onAuthError, query])

  useEffect(() => {
    void loadPage()
    return () => listRequest.current?.abort()
  }, [loadPage])

  useEffect(() => {
    const id = recentWorld(account.account_id)
    if (!id) return
    const controller = new AbortController()
    void getWorld(id, controller.signal).then((world) => {
      if (!controller.signal.aborted) setResume(world)
    }, () => undefined)
    return () => controller.abort()
  }, [account.account_id])

  useEffect(() => {
    if (formOpen && !attempt) nameInput.current?.focus()
  }, [formOpen, attempt])

  function rememberCreation(value: PendingCreation | null) {
    setAttempt(value)
    savePendingCreation(account.account_id, value)
  }

  function closeForm() {
    setFormOpen(false)
    setName('')
    setSaveError('')
    createButton.current?.focus()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const title = name.trim().normalize('NFC')
    if (!attempt && (!title || Array.from(title).length > 100)) {
      setSaveError('Enter a world name between 1 and 100 characters.')
      return
    }
    const request = attempt ?? { name: title, key: crypto.randomUUID() }
    rememberCreation(request)
    setName(request.name)
    setSaving(true)
    setSaveError('')
    setCreatedName('')
    try {
      const { world } = await createWorld(request.name, request.key, account.csrf_token)
      rememberCreation(null)
      setWorlds((previous) => !query || world.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ? [world, ...previous.filter((item) => item.id !== world.id)] : previous)
      setCreatedName(world.name)
      closeForm()
    } catch (error) {
      if (onAuthError(error)) return
      if (error instanceof ApiError && [400, 404, 409, 422].includes(error.status)) {
        rememberCreation(null)
        setSaveError(
          error.code === 'KEY_REUSED'
            ? 'This save could not be retried. Check your world list before creating it again.'
            : 'CGS couldn’t save this world. Check the name and try again.',
        )
      } else {
        setSaveError('CGS couldn’t confirm the save. Retry to recover the result without creating a second world.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="world-library">
      <HomeMasthead title="Worlds">
        <button
          className="button primary"
          type="button"
          ref={createButton}
          aria-expanded={formOpen}
          onClick={() => {
            setCreatedName('')
            setFormOpen(true)
            nameInput.current?.focus()
          }}
        >
          Create world
        </button>
        {resume && <a className="button secondary" href={'/worlds/' + resume.id + '/'} aria-label={'Continue ' + resume.name}>
          Continue working <span aria-hidden="true">↗</span>
        </a>}
      </HomeMasthead>

      {formOpen && (
        <section className="creation-panel" aria-labelledby="creation-title">
          <h2 id="creation-title">New world</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="world-name">World name</label>
              <input
                id="world-name"
                name="world-name"
                ref={nameInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                readOnly={Boolean(attempt)}
                required
              />
            </div>
            {saveError && <p className="error-message" role="alert">{saveError}</p>}
            {!saveError && attempt && !saving && (
              <p className="notice" role="status">A previous save is unconfirmed. Retry to recover it.</p>
            )}
            <div className="form-actions">
              <button className="button primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : attempt ? 'Retry save' : 'Save world'}
              </button>
              {!attempt && <button className="button secondary" type="button" onClick={closeForm}>Cancel</button>}
            </div>
          </form>
        </section>
      )}
      {createdName && <p className="notice success" role="status">Created {createdName}.</p>}

      <section className="world-library-list" aria-labelledby="world-library-title">
      <div className="home-index-heading">
        <h2 id="world-library-title">Your worlds</h2>
        <form className="world-filter" role="search" onSubmit={(event) => {
          event.preventDefault()
          const value = search.trim().normalize('NFC')
          if (value === query) return
          setWorlds([])
          setNextCursor(null)
          setQuery(value)
        }}>
          <label className="field"><span className="visually-hidden">Find a world</span>
            <input type="search" value={search} maxLength={100} placeholder="Find a world"
              onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button className="button secondary" type="submit">Search</button>
        </form>
      </div>
      {listFailed && (
        <div className="list-error">
          <p className="error-message" role="alert">CGS couldn’t load your worlds.</p>
          <button className="button secondary" onClick={() => void loadPage(nextCursor ?? undefined)}>Try again</button>
        </div>
      )}
      {worlds.length > 0 && (
        <ul className="world-grid" aria-label="Your worlds">
          {worlds.map((world) => (
            <li key={world.id}>
              <a className="world-card" href={'/worlds/' + world.id + '/'} aria-labelledby={'world-' + world.id} aria-describedby={'role-' + world.id}>
                <span className="world-card-art" aria-hidden="true" />
                <span className="world-card-caption">
                  <span className="world-card-name" id={'world-' + world.id}>{world.name}</span>
                  <span className="world-card-role" id={'role-' + world.id}>{roleLabel[world.role]}</span>
                  <span className="world-card-arrow" aria-hidden="true">↗</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {listLoading && <p className="muted" role="status">Loading worlds…</p>}
      {!listLoading && !listFailed && worlds.length === 0 && (
        <p className="empty-state">{query ? 'No worlds match your search.' : 'No worlds yet. Create one to get started.'}</p>
      )}
      {!listLoading && !listFailed && nextCursor && (
        <button className="button secondary load-more" onClick={() => void loadPage(nextCursor)}>Load more</button>
      )}
      </section>
    </div>
  )
}

export function WorldOverview({ accountId, worldId, onAuthError }: {
  accountId: string; worldId: string; onAuthError: AuthErrorHandler
}) {
  const [world, setWorld] = useState<World | null>(null)
  const [home, setHome] = useState<WikiWorldHome>()
  const [homeError, setHomeError] = useState(false)
  const [failure, setFailure] = useState<'unavailable' | 'connection' | null>(null)
  const [requestNumber, setRequestNumber] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    void getWorld(worldId, request.signal).then(
      async (result) => {
        if (request.signal.aborted) return
        setWorld(result)
        recentWorld(accountId, result.id)
        if (result.role !== 'owner' && result.role !== 'editor') return
        try {
          const presentation = await getWikiHome(result.id, request.signal)
          if (!request.signal.aborted) setHome(presentation)
        } catch (error) {
          if (!request.signal.aborted && !onAuthError(error)) setHomeError(true)
        }
      },
      (error: unknown) => {
        if (request.signal.aborted || onAuthError(error)) return
        setFailure(error instanceof ApiError && error.status === 404 ? 'unavailable' : 'connection')
      },
    )
    return () => request.abort()
  }, [accountId, worldId, requestNumber, onAuthError])

  const wikiAccess = world?.role === 'owner' || world?.role === 'editor'
  const canEdit = world?.role === 'owner' || world?.capabilities.includes('edit_world')

  return (
    <>
      <div className="world-home-context">
        <a className="back-link" href="/">← All worlds</a>
        {world && <span className="world-card-role">{roleLabel[world.role]}</span>}
      </div>
      {world && (
        <>
          {wikiAccess ? <WikiHome worldId={world.id} worldName={world.name} home={home} canCreate={canEdit} actions={<>
            <a className="button primary" href={wikiHref(world.id)}>Open Wiki</a>
            {canEdit && <a className="button secondary" href={wikiHref(world.id) + '?edit_home=1'}>Edit world home</a>}
            <a className="button secondary" href={'/worlds/' + world.id + '/draft/'}>{canEdit ? 'Edit draft' : 'View draft'}</a>
          </>} /> : <HomeMasthead title={world.name} />}
          {homeError && <p className="error-message" role="alert">The world introduction and featured articles couldn’t be loaded.</p>}
        </>
      )}
      {!world && !failure && <p className="muted" role="status">Loading world…</p>}
      {failure === 'unavailable' && (
        <section className="error-state">
          <h1>World unavailable</h1>
          <p className="muted">Choose a world from your list.</p>
        </section>
      )}
      {failure === 'connection' && (
        <section className="error-state">
          <h1>Couldn’t load this world</h1>
          <button className="button secondary" onClick={() => {
            setFailure(null)
            setRequestNumber((previous) => previous + 1)
          }}>Try again</button>
        </section>
      )}
    </>
  )
}
