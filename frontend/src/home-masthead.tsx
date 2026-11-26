import { type AnchorHTMLAttributes, type ReactNode, useState } from 'react'

export function HomeMasthead({ title, introduction, cover, children }: {
  title: string; introduction?: string; cover?: string; children?: ReactNode
}) {
  return <header className="home-masthead">
    {cover && <Cover key={cover} src={cover} />}
    <div className="home-masthead-content">
      <h1>{title}</h1>
      {introduction && <p className="home-introduction">{introduction}</p>}
      {children && <div className="home-masthead-actions">{children}</div>}
    </div>
  </header>
}

function Cover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? null : <img className="home-cover" src={src} alt="" onError={() => setFailed(true)} />
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string; disabled?: boolean; onFollow?: () => void
}

export function WorkspaceLink({ href, onFollow, disabled, ...attributes }: LinkProps) {
  return <a {...attributes} href={href} aria-disabled={disabled || undefined}
    onClick={(event) => {
      if (disabled) {
        event.preventDefault()
        return
      }
      if (!onFollow || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      onFollow()
    }} />
}
