import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { type Draft, type DraftSource, type EntryKind, type Fact } from '../src/draft-api'
import { ruleLabel } from '../src/scenario-fields'

function password() {
  const value = process.env.CGS_E2E_PASSWORD
  if (!value) throw new Error('Set CGS_E2E_PASSWORD for the disposable test accounts.')
  return value
}

async function signIn(page: Page, username = 'e2e-owner') {
  await expect(page.getByRole('heading', { name: 'Sign in to CGS' })).toBeVisible()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function newDraft(page: Page) {
  await page.goto('/')
  await signIn(page)
  const name = 'Draft workshop ' + crypto.randomUUID().slice(0, 6)
  await page.getByRole('button', { name: 'Create world' }).click()
  await page.getByLabel('World name').fill(name)
  await page.getByRole('button', { name: 'Save world' }).click()
  await page.getByRole('link', { name }).click()
  await page.getByRole('link', { name: 'Edit draft' }).click()
  await expect(page.getByText('Draft · Revision 0')).toBeVisible()
  return page.url()
}

async function addEntry(page: Page, name: string, type = 'place') {
  await page.getByRole('button', { name: 'Add entry' }).click()
  await page.getByLabel('Entry type').selectOption(type)
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return new URL(page.url()).searchParams.get('entry')!
}

test('authors linked records, reopens history and protects the draft', async ({ page, browser }, info) => {
  const url = await newDraft(page)
  const first = await addEntry(page, 'North Hall')
  await addEntry(page, 'North Hall')
  await addEntry(page, 'Lantern', 'item')
  await page.getByRole('button', { name: 'Add link' }).click()
  await page.getByLabel('Link to').selectOption(first)
  await page.getByRole('button', { name: 'Save link' }).click()
  const details = page.getByRole('region', { name: 'Entry details' })
  await details.getByRole('button', { name: 'North Hall · Place · ' + first.slice(0, 8) }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('entry')).toBe(first)
  await page.getByRole('button', { name: 'Edit entry' }).click()
  await page.getByLabel('Name', { exact: true }).fill('East Hall')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(details.getByRole('heading', { name: 'East Hall' })).toBeVisible()
  await page.reload()
  await expect(details.getByRole('heading', { name: 'East Hall' })).toBeVisible()
  if (process.env.CGS_E2E_CAPTURE === '1') {
    await page.screenshot({ path: info.outputPath('editor.png') })
    await page.setViewportSize({ width: 390, height: 800 })
    await page.screenshot({ path: info.outputPath('editor-mobile.png') })
  }
  await page.getByRole('link', { name: 'Previous revision' }).click()
  await expect(details.getByRole('heading', { name: 'North Hall' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit entry' })).toHaveCount(0)

  const other = await browser.newPage()
  try {
    await other.goto(url)
    await signIn(other, 'e2e-other')
    await expect(other.getByRole('heading', { name: 'Draft unavailable.' })).toBeVisible()
    await expect(other.getByText('East Hall')).toHaveCount(0)
  } finally {
    await other.close()
  }
})

test('preserves typed changes on a stale save and recovers a lost receipt', async ({ page }) => {
  const url = await newDraft(page)
  await page.getByRole('button', { name: 'Add entry' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Author’s saved input')
  const concurrent = await page.context().newPage()
  try {
    await concurrent.goto(url)
    await addEntry(concurrent, 'Competing tab')
    await expect(concurrent.getByText('Draft · Revision 1')).toBeVisible()
  } finally {
    await concurrent.close()
  }
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('alert')).toContainText('Another save changed this draft')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Author’s saved input')
  await page.getByRole('button', { name: 'Load revision 1' }).click()
  await expect(page.getByText('Draft · Revision 1')).toBeVisible()

  const seenKeys: string[] = []
  await page.route('**/draft/edits', async (route) => {
    seenKeys.push(route.request().headers()['idempotency-key'])
    if (seenKeys.length === 1) {
      const accepted = await route.fetch()
      expect(accepted.status()).toBe(200)
      await route.abort('failed')
    } else {
      await route.continue()
    }
  })
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
  await page.reload()
  await page.getByRole('button', { name: 'Retry save' }).click()
  await expect(page.getByRole('heading', { name: 'Author’s saved input' })).toBeVisible()
  await expect(page.getByText('Draft · Revision 2')).toBeVisible()
  expect(seenKeys).toHaveLength(2)
  expect(seenKeys[1]).toBe(seenKeys[0])
})

test('prevents a stale form from replacing a concurrently edited entry after reload', async ({ page }) => {
  await newDraft(page)
  await addEntry(page, 'Original hall')
  const selectedUrl = page.url()
  await page.getByRole('button', { name: 'Edit entry' }).click()
  await page.getByLabel('Name', { exact: true }).fill('My version')
  const otherTab = await page.context().newPage()
  try {
    await otherTab.goto(selectedUrl)
    await otherTab.getByRole('button', { name: 'Edit entry' }).click()
    await otherTab.getByLabel('Name', { exact: true }).fill('Other version')
    await otherTab.getByRole('button', { name: 'Save entry' }).click()
    await expect(otherTab.getByRole('heading', { name: 'Other version' })).toBeVisible()
  } finally {
    await otherTab.close()
  }
  await page.getByRole('button', { name: 'Save entry' }).click()
  await page.getByRole('button', { name: 'Load revision 2' }).click()
  await expect(page.getByText('Draft · Revision 2')).toBeVisible()
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('alert')).toContainText('This entry also changed')
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('My version')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Other version' })).toBeVisible()
})
test('clears the open draft and pending write when access is lost', async ({ page }) => {
  await newDraft(page)
  await addEntry(page, 'Private hall')
  await page.getByRole('button', { name: 'Edit entry' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Private unsaved title')
  await page.route('**/draft/edits', (route) => route.fulfill({
    status: 404,
    json: { code: 'RESOURCE_UNAVAILABLE', message: 'Resource unavailable.', field_errors: [] },
  }))
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('heading', { name: 'Draft unavailable.' })).toBeVisible()
  await expect(page.getByText('Private hall')).toHaveCount(0)
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('cgs.draft-edit.')))).toEqual([])
})

const fixture = JSON.parse(readFileSync(new URL('../../backend/cgs/worlds/testdata/reference_dungeon.json', import.meta.url), 'utf8')) as {
  aliases: Record<string, string>; source: DraftSource
}

const factLabel = (fact: Fact) => fact.predicate.replaceAll('_', ' ') + ' · ' + (fact.kind === 'truth' ? 'Truth' : 'Claim') + ' · tick ' + fact.effective_from_tick

async function checkChoices(form: Locator, legend: string, labels: string[]) {
  for (const name of labels) {
    await form.getByRole('group', { name: legend, exact: true }).getByRole('checkbox', { name, exact: true }).check()
  }
}

async function readDraft(page: Page) {
  const path = new URL(page.url()).pathname.replace(/\/$/, '')
  const response = await page.request.get('/api/v1' + path)
  expect(response.ok()).toBeTruthy()
  return await response.json() as Draft
}

function compareDraftValues(value: unknown, ids: Map<string, string>, field?: string): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('actor:')) return 'actor:' + (ids.get(value.slice(6)) ?? value.slice(6))
    return ids.get(value) ?? value
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => compareDraftValues(item, ids))
    return ['action_rule_ids', 'authority', 'source_ref_ids', 'value', 'discovery_fact_ids'].includes(field ?? '') ? items.sort() : items
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [ids.get(key) ?? key, compareDraftValues(item, ids, key)]))
  }
  return value
}

test('authors and reopens the reference dungeon using browser forms', async ({ page }, info) => {
  test.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  const { source, aliases } = fixture
  const layout = source.layout!, start = source.start!
  const idMap = new Map<string, string>()
  await newDraft(page)
  const section = (name: string) => page.getByRole('navigation', { name: 'Draft authoring sections' }).getByRole('button', { name, exact: true })
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const select = (name: string) => page.getByRole('combobox', { name, exact: true })
  const entryNames: Record<EntryKind, string> = { place: 'Place', actor: 'Character', role: 'Role', item: 'Item' }
  const entries = Object.values(source.entities)
  for (const kind of ['place', 'role', 'actor', 'item'] as const) {
    for (const entry of entries.filter((record) => record.kind === kind)) {
      await button('Add entry').click()
      const form = page.getByRole('form', { name: 'Add entry' })
      await form.getByLabel('Entry type').selectOption(kind)
      await form.getByLabel('Name', { exact: true }).fill(entry.name!)
      await form.getByLabel('Visibility').selectOption(entry.visibility!)
      if (kind === 'place') await form.getByLabel('Parent place').selectOption('none')
      if (entry.description) await form.getByLabel('Description').fill(entry.description)
      if (entry.authority) await checkChoices(form, 'Role authority', entry.authority.map((value) => ruleLabel[value as keyof typeof ruleLabel]))
      if (kind === 'actor') {
        await form.getByLabel('Archetype').fill(entry.archetype!)
        await form.getByLabel('Role', { exact: true }).selectOption(idMap.get(entry.role_id!)!)
        await form.getByLabel('Behavior').selectOption('hold')
      }
      await form.getByRole('button', { name: 'Save entry' }).click()
      await expect(page.getByRole('region', { name: 'Entry details' }).getByRole('heading', { name: entry.name, exact: true })).toBeVisible()
      idMap.set(entry.id, new URL(page.url()).searchParams.get('entry')!)
    }
  }
  await button('Add link').click()
  let form = page.getByRole('form', { name: 'Add link' })
  await form.getByLabel('Link to').selectOption(idMap.get(aliases.junction)!)
  await form.getByLabel('Visibility').selectOption('public')
  await form.getByRole('button', { name: 'Save link' }).click()
  await expect(form).toHaveCount(0)
  idMap.set(aliases.lantern_location, Object.keys((await readDraft(page)).source.links)[0])

  await section('Layout & facts').click()
  await button('Set up layout').click()
  for (const room of entries.filter((record) => record.bounds)) {
    await button('Edit ' + room.name).click()
    form = page.getByRole('form', { name: 'Room bounds' })
    await form.getByLabel('Minimum X (m)').fill(String(room.bounds!.x_min_cm / 100))
    await form.getByLabel('Minimum Y (m)').fill(String(room.bounds!.y_min_cm / 100))
    await form.getByLabel('Maximum X (m)').fill(String(room.bounds!.x_max_cm / 100))
    await form.getByLabel('Maximum Y (m)').fill(String(room.bounds!.y_max_cm / 100))
    await button('Stage bounds').click()
  }
  for (const point of Object.values(layout.points)) {
    await button('Add point').click()
    form = page.getByRole('form', { name: 'Map point' })
    await form.getByLabel('Point name').fill(point.label)
    await form.getByLabel('Room').selectOption(idMap.get(point.place_id)!)
    await form.getByLabel('X (m)', { exact: true }).fill(String(point.at.x_cm / 100))
    await form.getByLabel('Y (m)', { exact: true }).fill(String(point.at.y_cm / 100))
    await form.getByLabel('Visibility').selectOption(point.visibility)
    await button('Stage point').click()
  }
  const pathLabel = (id: string) => {
    const edge = layout.edges[id]
    return layout.points[edge.from_point_id].label + ' ↔ ' + layout.points[edge.to_point_id].label
  }
  for (const edge of Object.values(layout.edges)) {
    await button('Add path').click()
    form = page.getByRole('form', { name: 'Path' })
    await form.getByLabel('From point').selectOption({ label: layout.points[edge.from_point_id].label })
    await form.getByLabel('To point').selectOption({ label: layout.points[edge.to_point_id].label })
    idMap.set(edge.from_point_id, await form.getByLabel('From point').inputValue())
    idMap.set(edge.to_point_id, await form.getByLabel('To point').inputValue())
    await button('Stage path').click()
  }
  const refLabel = (id: string) => {
    if (layout.points[id]) return 'Point · ' + layout.points[id].label
    if (layout.edges[id]) return 'Path · ' + pathLabel(id)
    if (source.facts[id]) return factLabel(source.facts[id])
    return source.entities[id].name!
  }
  for (const fact of Object.values(source.facts)) {
    await button('Add fact or claim').click()
    form = page.getByRole('form', { name: 'Fact or claim' })
    await form.getByLabel('Fact type').selectOption(fact.kind)
    await form.getByLabel('Subject').selectOption(idMap.get(fact.subject_id)!)
    if (fact.kind === 'claim') await form.getByLabel('Claimant').selectOption(idMap.get(fact.claimant_id)!)
    await form.getByLabel('Predicate').fill(fact.predicate)
    await form.getByLabel('Value type').selectOption(fact.value.kind)
    if (fact.value.kind === 'references') await checkChoices(form, 'Value records', fact.value.value.map(refLabel))
    else await form.getByRole('combobox', { name: 'Value', exact: true }).selectOption(
      fact.value.kind === 'reference' ? idMap.get(String(fact.value.value))! : String(fact.value.value),
    )
    await form.getByLabel('Effective from tick').fill(String(fact.id === aliases.gate_open ? 2 : fact.effective_from_tick))
    if (fact.effective_until_tick !== null) await form.getByLabel('Effective until tick').fill(String(fact.effective_until_tick))
    await form.getByLabel('Visibility').selectOption(fact.visibility)
    await checkChoices(form, 'Source references', fact.source_ref_ids.map(refLabel))
    await button('Stage fact').click()
  }
  for (const edge of Object.values(layout.edges).filter((record) => record.required_fact_id)) {
    await button('Edit ' + pathLabel(edge.id)).click()
    await page.getByRole('form', { name: 'Path' }).getByLabel('Required fact').selectOption({ label: factLabel(source.facts[edge.required_fact_id!]) })
    await button('Stage path').click()
  }
  await button('Save layout and facts').click()
  await expect(page.getByRole('alert')).toContainText('cannot overlap')
  await button('Edit gate open · Truth · tick 2').click()
  await page.getByRole('form', { name: 'Fact or claim' }).getByLabel('Effective from tick').fill('3')
  await button('Stage fact').click()

  const droppedKeys: string[] = []
  const routePattern = '**/draft/edits'
  await page.route(routePattern, async (route) => {
    droppedKeys.push(route.request().headers()['idempotency-key'])
    if (droppedKeys.length === 1) {
      const accepted = await route.fetch()
      expect(accepted.status()).toBe(200)
      await route.abort('failed')
    } else await route.continue()
  })
  await button('Save layout and facts').click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
  await page.reload()
  await button('Retry save').click()
  await expect(section('Rules')).toBeEnabled()
  await page.unroute(routePattern)
  expect(droppedKeys).toHaveLength(2)
  expect(droppedKeys[1]).toBe(droppedKeys[0])
  const layoutDraft = (await readDraft(page)).source
  idMap.set(layout.frame_id, layoutDraft.layout!.frame_id)
  for (const edge of Object.values(layout.edges)) {
    const actual = Object.values(layoutDraft.layout!.edges).find((record) => record.from_point_id === idMap.get(edge.from_point_id) && record.to_point_id === idMap.get(edge.to_point_id))
    idMap.set(edge.id, actual!.id)
  }
  for (const fact of Object.values(source.facts)) {
    idMap.set(fact.id, Object.values(layoutDraft.facts).find((record) => factLabel(record) === factLabel(fact))!.id)
  }
  if (process.env.CGS_E2E_CAPTURE === '1') {
    await page.screenshot({ path: info.outputPath('layout.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 800 })
    await page.screenshot({ path: info.outputPath('layout-mobile.png') })
    await page.setViewportSize({ width: 1240, height: 840 })
  }

  await section('Rules').click()
  const ruleOrder = Object.values(source.rules).sort((a, b) => Number(a.template === 'progress') - Number(b.template === 'progress'))
  for (const rule of ruleOrder) {
    await button('Add rule').click()
    form = page.getByRole('form', { name: 'Rule setup' })
    await form.getByLabel('Rule template').selectOption(rule.template)
    await form.getByLabel('Rule name').fill(rule.name!)
    switch (rule.template) {
      case 'search':
        await form.getByLabel('Search site').selectOption(idMap.get(rule.parameters!.site_id)!)
        await checkChoices(form, 'Discoverable facts', rule.parameters!.discovery_fact_ids.map((id) => factLabel(source.facts[id])))
        break
      case 'report':
        await checkChoices(form, 'Report audiences', ['Party'])
        break
      case 'move':
        await form.getByLabel('Maximum distance (m)').fill(String(rule.parameters!.maximum_cm / 100))
        await form.getByLabel('Focus cost').fill(String(rule.parameters!.focus_cost))
        break
      case 'cast':
        await form.getByLabel('Target role').selectOption(idMap.get(rule.parameters!.target_role_id)!)
        await form.getByLabel('On-attempt fact').selectOption(idMap.get(rule.parameters!.on_attempt_fact_id!)!)
        break
      case 'progress':
        await form.getByLabel('Class key').fill(rule.parameters!.class_key)
        await form.getByLabel('Rule to unlock').selectOption({ label: source.rules[rule.parameters!.unlock_rule_id].name! })
        break
    }
    await form.getByRole('button', { name: 'Save rule' }).click()
    await expect(form).toHaveCount(0)
  }
  const savedRules = (await readDraft(page)).source.rules
  for (const rule of ruleOrder) idMap.set(rule.id, Object.values(savedRules).find((record) => record.name === rule.name)!.id)

  await section('Entries').click()
  for (const entry of entries.filter((record) => record.kind === 'actor')) {
    await page.getByRole('region', { name: 'Entries' }).getByRole('button', { name: new RegExp('^' + entry.name + ' · ' + entryNames[entry.kind]) }).click()
    await button('Edit entry').click()
    form = page.getByRole('form', { name: 'Edit entry' })
    await checkChoices(form, 'Granted action rules', entry.action_rule_ids!.map((id) => source.rules[id].name!))
    await form.getByRole('button', { name: 'Save entry' }).click()
    await expect(form).toHaveCount(0)
  }

  await section('Starting state').click()
  await button('Set up starting state').click()
  for (const [id, actor] of Object.entries(start.actors)) {
    await button('Add character setup').click()
    form = page.getByRole('form', { name: 'Character setup' })
    await form.getByRole('combobox', { name: 'Character', exact: true }).selectOption(idMap.get(id)!)
    await form.getByLabel('Starting point').selectOption(idMap.get(actor.point_id)!)
    for (const [label, value] of [['HP', actor.hp], ['Maximum HP', actor.hp_max], ['Focus', actor.focus], ['Maximum Focus', actor.focus_max],
      ['XP', actor.xp], ['Level', actor.level], ['Unspent points', actor.unspent_points]] as const) {
      await form.getByLabel(label, { exact: true }).fill(String(value))
    }
    await form.getByLabel('Rank').selectOption(actor.rank)
    await form.getByLabel('Class key').fill(actor.class_key)
    await button('Stage character').click()
  }
  await select('Player character').selectOption(idMap.get(start.controlled_player_id)!)
  await select('Encounter sentry').selectOption(idMap.get(start.sentry_id)!)
  await checkChoices(page.getByRole('region', { name: 'Encounter setup' }), 'Scouts', start.scout_ids.map((id) => source.entities[id].name!))
  await select('Progression rule').selectOption(idMap.get(start.progress_rule_id)!)
  await button('Place item').click()
  form = page.getByRole('form', { name: 'Item placement' })
  await form.getByRole('combobox', { name: 'Item', exact: true }).selectOption(idMap.get(aliases.lantern)!)
  await form.getByLabel('Starting point').selectOption(idMap.get(aliases.west_entry)!)
  await button('Stage item').click()
  for (const observation of start.initial_observations) {
    await button('Add observation').click()
    form = page.getByRole('form', { name: 'Initial observation' })
    await form.getByLabel('Audience').selectOption('actor:' + idMap.get(observation.audience.slice(6))!)
    await form.getByLabel('Known fact').selectOption(idMap.get(observation.fact_id)!)
    await button('Stage observation').click()
  }
  await button('Save starting state').click()
  await expect(button('Save starting state')).toBeDisabled()
  await expect(section('Entries')).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Character placements' })).toContainText('4/4 Focus')
  const fullDraft = await readDraft(page)
  expect(fullDraft.problems).toEqual([])
  idMap.set(start.encounter_id, fullDraft.source.start!.encounter_id)
  const actualToFixture = new Map(Array.from(idMap, ([fixtureId, actualId]) => [actualId, fixtureId]))
  expect(compareDraftValues(fullDraft.source, actualToFixture)).toEqual(compareDraftValues(source, new Map()))
  await page.getByRole('link', { name: 'Previous revision' }).click()
  await expect(page.getByText('Historical draft · Revision ' + (fullDraft.revision - 1))).toBeVisible()
  await expect(page.getByRole('region', { name: 'Character placements' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Latest draft' }).click()
  await expect(page.getByRole('region', { name: 'Character placements' })).toContainText('4/4 Focus')

  await section('Entries').click()
  await page.getByRole('region', { name: 'Entries' }).getByRole('button', { name: 'Vale · Character', exact: true }).click()
  await button('Edit entry').click()
  await select('Behavior').selectOption('alarm_move')
  await select('Stimulus fact').selectOption(idMap.get(aliases.heard_cast)!)
  await select('Alarm point').selectOption(idMap.get(aliases.alarm)!)
  await select('Movement rule').selectOption(idMap.get(aliases.move)!)
  await button('Save entry').click()
  await expect(page.getByRole('region', { name: 'Entry details' })).toContainText('Move to alarm on a stimulus')
  await page.reload()
  expect((await readDraft(page)).source.entities[idMap.get(aliases.sentry)!].policy).toEqual({
    mode: 'alarm_move', stimulus_fact_id: idMap.get(aliases.heard_cast), destination_point_id: idMap.get(aliases.alarm), move_rule_id: idMap.get(aliases.move),
  })
})
