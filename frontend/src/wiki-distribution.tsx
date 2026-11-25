import { useState } from 'react'
import type { WikiValue } from './wiki-api'

type Outcome = { value: string; weight: string }

function parseDistribution(value?: WikiValue): Outcome[] {
  if (typeof value !== 'string') return []
  try {
    const outcomes: unknown = JSON.parse(value)
    return Array.isArray(outcomes) ? outcomes : []
  } catch {
    return []
  }
}

export function formatDistribution(value: WikiValue) {
  return parseDistribution(value).map((row) => row.value + ' × ' + row.weight).join(', ')
}

export function DistributionInput({ name, label, initial, required }: {
  name: string; label: string; initial?: WikiValue; required: boolean
}) {
  const [rows, setRows] = useState(() => {
    const outcomes = parseDistribution(initial)
    return (outcomes.length ? outcomes : [{ value: '', weight: '' }]).map((row, id) => ({ ...row, id }))
  })
  const [nextId, setNextId] = useState(rows.length)
  const included = rows.filter((row) => row.value !== '' || row.weight !== '')
  function update(id: number, field: keyof Outcome, value: string) {
    setRows((previous) => previous.map((row) => row.id === id ? { ...row, [field]: value } : row))
  }
  return (
    <fieldset className="wiki-change-fields">
      <legend>{label === 'Value' ? 'Outcomes and weights' : label}</legend>
      <p className="muted">Weights are relative. A weight of 3 makes an outcome three times as common as a weight of 1.</p>
      <input type="hidden" name={name} value={included.length ? JSON.stringify(included.map(({ value, weight }) => ({ value, weight }))) : ''} />
      {rows.map((row, index) => (
        <div className="wiki-form-row" key={row.id}>
          <label className="field">Outcome {index + 1}<input value={row.value} inputMode="decimal"
            pattern={String.raw`-?\d{1,15}(\.\d{1,9})?`} required={required || row.weight !== ''}
            onChange={(event) => update(row.id, 'value', event.target.value)} /></label>
          <label className="field">Weight {index + 1}<input value={row.weight} inputMode="decimal"
            pattern={String.raw`\d{1,15}(\.\d{1,9})?`} required={required || row.value !== ''}
            onChange={(event) => update(row.id, 'weight', event.target.value)} /></label>
          {rows.length > 1 && <button className="button secondary" type="button" aria-label={'Remove outcome ' + (index + 1)}
            onClick={() => setRows((previous) => previous.filter((item) => item.id !== row.id))}>Remove</button>}
        </div>
      ))}
      {rows.length < 40 && <button className="button secondary" type="button" onClick={() => {
        setRows((previous) => [...previous, { id: nextId, value: '', weight: '' }])
        setNextId(nextId + 1)
      }}>Add outcome</button>}
    </fieldset>
  )
}
