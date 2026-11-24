import { request } from './api'

export const entryKinds = ['place', 'actor', 'item', 'role'] as const
export const linkKinds = ['affiliation', 'located_in', 'owns', 'carries', 'requires'] as const

export type EntryKind = typeof entryKinds[number]
export type LinkKind = typeof linkKinds[number]
export type Visibility = 'public' | 'observed' | 'author'
export const actionKinds = ['move', 'cast', 'search', 'report', 'allocate', 'wait'] as const
export type ActionKind = typeof actionKinds[number]
export type Audience = 'party' | `actor:${string}`

export type Point = { x_cm: number; y_cm: number }
export type Bounds = { x_min_cm: number; y_min_cm: number; x_max_cm: number; y_max_cm: number }
export type LayoutPoint = { id: string; label: string; place_id: string; at: Point; visibility: Visibility }
export type LayoutEdge = { id: string; from_point_id: string; to_point_id: string; traversable: boolean; required_fact_id: string | null }
export type Layout = {
  frame_id: string
  unit: 'cm'
  origin: Point
  grid_cm: number
  points: Record<string, LayoutPoint>
  edges: Record<string, LayoutEdge>
}

export type ActorPolicy = { mode: 'hold' } | {
  mode: 'alarm_move'
  stimulus_fact_id: string
  destination_point_id: string
  move_rule_id: string
}

export type FactValue =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'integer'; value: number }
  | { kind: 'text' | 'reference'; value: string }
  | { kind: 'references'; value: string[] }

export type Fact = {
  id: string
  subject_id: string
  predicate: string
  value: FactValue
  effective_from_tick: number
  effective_until_tick: number | null
  visibility: Visibility
  source_ref_ids: string[]
} & ({ kind: 'truth' } | { kind: 'claim'; claimant_id: string })

type RuleParameters = {
  search: { site_id: string; discovery_fact_ids: string[] }
  report: { audiences: Audience[] }
  move: { maximum_cm: number; focus_cost: number }
  cast: { range_cm: number; focus_cost: number; hit_min_d20: number; damage: number; target_role_id: string; on_attempt_fact_id: string | null }
  progress: { xp_award: number; unlock_at_xp: number; points: number; unlock_level: number; class_key: string; unlock_rule_id: string }
  allocate: Record<string, never>
  wait: Record<string, never>
}

export type RuleTemplate = keyof RuleParameters
export type Rule = {
  [T in RuleTemplate]: { id: string; name?: string; template: T; rule_version: 1; parameters?: RuleParameters[T] }
}[RuleTemplate]

export const ranks = ['F', 'E', 'D', 'C', 'B', 'A', 'S'] as const
export type ActorStart = {
  point_id: string
  hp: number
  hp_max: number
  focus: number
  focus_max: number
  xp: number
  level: number
  rank: typeof ranks[number]
  class_key: string
  unspent_points: number
  attributes: { strength: number; agility: number; perception: number }
  extra_rule_ids: string[]
  occupies: boolean
  statuses: 'defeated'[]
}
export type InitialObservation = { audience: Audience; fact_id: string }
export type StartState = {
  tick: number
  controlled_player_id: string
  scout_ids: string[]
  encounter_id: string
  sentry_id: string
  progress_rule_id: string
  actors: Record<string, ActorStart>
  item_positions: Record<string, string>
  initial_observations: InitialObservation[]
}

export type Entry = {
  id: string
  kind: EntryKind
  name?: string
  visibility?: Visibility
  description?: string
  archetype?: string
  parent_place_id?: string | null
  role_id?: string
  authority?: string[]
  action_rule_ids?: string[]
  policy?: ActorPolicy
  bounds?: Bounds
}

export type Link = {
  id: string
  kind: LinkKind
  from_id: string
  to_id: string
  visibility: Visibility
}

export type Issue = { code: string; message: string; pointer?: string }

export type DraftSource = {
  schema_version: 1
  entities: Record<string, Entry>
  links: Record<string, Link>
  facts: Record<string, Fact>
  layout: Layout | null
  rules: Record<string, Rule>
  start: StartState | null
}

export type Draft = {
  draft_id: string
  revision: number
  guardrail_version: number
  source: DraftSource
  problems: Issue[]
}

export type EditValue = Entry | Link | Layout | Fact | Rule | StartState | Bounds | null
export type Edit =
  | { op: 'add' | 'set'; pointer: string; value: EditValue }
  | { op: 'remove'; pointer: string }

export type ScenarioSection = 'layout' | 'rules' | 'start'
export type PendingEdit = { revision: number; key: string; edits: Edit[]; selectedId?: string; section?: ScenarioSection }
export type WorkspaceRecovery = { section: ScenarioSection; base: DraftSource; source: DraftSource; edits: Edit[] }

export function restoreWorkspace(attempt: PendingEdit, base: DraftSource): WorkspaceRecovery | null {
  if (!attempt.section) return null
  const source = structuredClone(base)
  for (const edit of attempt.edits) {
    const fields = edit.pointer.slice(1).split('/')
    const field = fields.pop()!
    let owner: unknown = source
    for (const part of fields) {
      if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, part)) return null
      owner = (owner as Record<string, unknown>)[part]
    }
    if (!owner || typeof owner !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(field)) return null
    if (edit.op === 'remove') delete (owner as Record<string, unknown>)[field]
    else (owner as Record<string, unknown>)[field] = edit.value
  }
  return { section: attempt.section, base, source, edits: attempt.edits }
}

const draftPath = (worldId: string) => '/worlds/' + encodeURIComponent(worldId) + '/draft'

export function getDraft(worldId: string, revision?: number, signal?: AbortSignal) {
  return request<Draft>(draftPath(worldId) + (revision === undefined ? '' : '?revision=' + revision), { signal })
}

export function getEntryProblems(worldId: string, entryId: string, revision: number, signal: AbortSignal) {
  return request<{ problems: Issue[] }>(
    draftPath(worldId) + '/entries/' + encodeURIComponent(entryId) + '?revision=' + revision,
    { signal },
  )
}

export function saveDraft(worldId: string, attempt: PendingEdit, token: string) {
  return request<{ revision: number }>(draftPath(worldId) + '/edits', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': token,
      'Idempotency-Key': attempt.key,
    },
    body: JSON.stringify({ mode: 'manual', expected_revision: attempt.revision, edits: attempt.edits }),
  })
}

const pendingPrefix = (accountId: string) => 'cgs.draft-edit.' + accountId + '.'

export function readPendingEdit(accountId: string, worldId: string): PendingEdit | null {
  try {
    const attempt: unknown = JSON.parse(sessionStorage.getItem(pendingPrefix(accountId) + worldId) ?? 'null')
    if (
      attempt && typeof attempt === 'object' && 'revision' in attempt && typeof attempt.revision === 'number' &&
      'key' in attempt && typeof attempt.key === 'string' && 'edits' in attempt && Array.isArray(attempt.edits)
    ) return attempt as PendingEdit
  } catch {
    // In-page retry is available when browser storage is disabled.
  }
  return null
}

export function savePendingEdit(accountId: string, worldId: string, attempt: PendingEdit | null) {
  try {
    const key = pendingPrefix(accountId) + worldId
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt))
    else sessionStorage.removeItem(key)
  } catch {
    // In-page retry is available when browser storage is disabled.
  }
}

export function clearPendingEdits(accountId: string) {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(pendingPrefix(accountId))) sessionStorage.removeItem(key)
    }
  } catch {
    // Storage can be disabled.
  }
}
