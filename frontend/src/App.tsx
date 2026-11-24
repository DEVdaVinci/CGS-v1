import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, getSession, savePendingCreation, signIn, signOut, type Session } from './api'
import { WorldLibrary, WorldOverview } from './worlds'
import { DraftEditor } from './draft-editor'
import { clearPendingEdits } from './draft-api'
import { clearWikiAttempts } from './wiki-api'
import { Wiki } from './wiki'

type SessionState =
  | { phase: 'loading' | 'failed' }
  | { phase: 'ready'; session: Session }

function SignInForm({
  token,
  onSignedIn,
  onAuthError,
}: {
  token: string
  onSignedIn: (session: Session) => void
  onAuthError: (error: unknown) => boolean
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setErrorMessage('')
    try {
      onSignedIn(await signIn(username, password, token))
    } catch (error) {
      if (onAuthError(error)) return
      setErrorMessage(
        error instanceof ApiError && error.code === 'LOGIN_FAILED'
          ? 'The username or password is incorrect.'
          : 'CGS couldn’t sign you in. Try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="sign-in-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      {errorMessage && <p className="error-message" role="alert">{errorMessage}</p>}
      <button className="button primary" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export function App() {
  const [state, setState] = useState<SessionState>({ phase: 'loading' })
  const [sessionRequest, setSessionRequest] = useState(0)
  const [notice, setNotice] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const worldRoute = /^\/worlds\/([0-9a-f-]+)\/(?:(draft|wiki)\/)?$/.exec(window.location.pathname)
  const worldId = worldRoute?.[1]
  const account = state.phase === 'ready' && state.session.authenticated ? state.session : null

  const refreshSession = useCallback((message = '') => {
    setNotice(message)
    setSignOutError('')
    setState({ phase: 'loading' })
    setSessionRequest((previous) => previous + 1)
  }, [])

  useEffect(() => {
    const request = new AbortController()
    void getSession(request.signal).then(
      (session) => {
        if (!request.signal.aborted) setState({ phase: 'ready', session })
      },
      () => {
        if (!request.signal.aborted) setState({ phase: 'failed' })
      },
    )
    return () => request.abort()
  }, [sessionRequest])

  useEffect(() => {
    function restoreSession(event: PageTransitionEvent) {
      if (event.persisted) refreshSession()
    }
    window.addEventListener('pageshow', restoreSession)
    return () => window.removeEventListener('pageshow', restoreSession)
  }, [refreshSession])

  const onAuthError = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        refreshSession('Your session expired. Sign in again.')
        return true
      }
      if (error.code === 'CSRF_FAILED') {
        refreshSession('Your session changed. Please try again.')
        return true
      }
    }
    return false
  }, [refreshSession])

  async function leave() {
    if (!account || leaving) return
    setLeaving(true)
    setSignOutError('')
    try {
      await signOut(account.csrf_token)
      savePendingCreation(account.account_id, null)
      clearPendingEdits(account.account_id)
      clearWikiAttempts(account.account_id)
      window.history.replaceState(null, '', '/')
      refreshSession()
    } catch (error) {
      if (!onAuthError(error)) setSignOutError('CGS couldn’t sign you out. Try again.')
    } finally {
      setLeaving(false)
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" aria-label="CGS home">
            <span className="brand-mark" aria-hidden="true" />
            CGS
          </a>
          {account && (
            <div className="account-actions">
              <span className="account-name">{account.display_name}</span>
              <button className="button secondary" type="button" onClick={leave} disabled={leaving}>
                {leaving ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </header>
      {state.phase === 'loading' && (
        <main className="centered">
          <p className="muted" role="status">Checking your session…</p>
        </main>
      )}
      {state.phase === 'failed' && (
        <main className="centered">
          <section className="sign-in-card">
            <h1>Connection unavailable</h1>
            <p className="error-message" role="alert">CGS couldn’t load your session.</p>
            <button className="button primary" onClick={() => refreshSession(notice)}>Try again</button>
          </section>
        </main>
      )}
      {state.phase === 'ready' && !state.session.authenticated && (
        <main className="centered">
          <section className="sign-in-card" aria-labelledby="sign-in-title">
            <h1 id="sign-in-title">Sign in to CGS</h1>
            <p className="muted sign-in-intro">Use the account you created for this installation.</p>
            {notice && <p className="notice" role="status">{notice}</p>}
            <SignInForm
              token={state.session.csrf_token}
              onSignedIn={(session) => {
                setNotice('')
                setState({ phase: 'ready', session })
              }}
              onAuthError={onAuthError}
            />
          </section>
        </main>
      )}
      {account && (
        <main className="workspace">
          {notice && <p className="notice" role="status">{notice}</p>}
          {signOutError && <p className="error-message" role="alert">{signOutError}</p>}
          {worldId ? (
            worldRoute?.[2] === 'wiki'
              ? <Wiki key={account.account_id + worldId} account={account} worldId={worldId} onAuthError={onAuthError} />
              : worldRoute?.[2] === 'draft'
                ? <DraftEditor key={account.account_id + worldId} account={account} worldId={worldId} onAuthError={onAuthError} />
                : <WorldOverview key={account.account_id + worldId} worldId={worldId} onAuthError={onAuthError} />
          ) : (
            <WorldLibrary key={account.account_id} account={account} onAuthError={onAuthError} />
          )}
        </main>
      )}
    </>
  )
}
