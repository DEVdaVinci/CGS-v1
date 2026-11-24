import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page, username: string, password: string) {
  await expect(page.getByRole('heading', { name: 'Sign in to CGS' })).toBeVisible()
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

function testPassword() {
  const password = process.env.CGS_E2E_PASSWORD
  if (!password) throw new Error('Set CGS_E2E_PASSWORD for the two disposable browser test accounts.')
  return password
}

test('signs in, creates and reopens a world, and hides it from another account', async ({ page, browser }, info) => {
  const password = testPassword()
  const worldName = 'Northbridge Archive ' + crypto.randomUUID().slice(0, 6)
  await page.goto('/')
  if (process.env.CGS_E2E_CAPTURE === '1') {
    await expect(page.getByRole('heading', { name: 'Sign in to CGS' })).toBeVisible()
    await page.screenshot({ path: info.outputPath('sign-in.png') })
  }
  await signIn(page, 'e2e-owner', password + '-wrong')
  await expect(page.getByRole('alert')).toHaveText('The username or password is incorrect.')
  await signIn(page, 'e2e-owner', password)
  await expect(page.getByRole('heading', { name: 'Worlds', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Create world' }).press('Enter')
  await expect(page.getByLabel('World name')).toBeFocused()
  await page.getByLabel('World name').fill(worldName)
  await page.getByRole('button', { name: 'Save world' }).click()
  const worldLink = page.getByRole('link', { name: worldName, exact: true })
  await expect(worldLink).toHaveCount(1)
  if (process.env.CGS_E2E_CAPTURE === '1') {
    await page.screenshot({ path: info.outputPath('world-library.png') })
    await page.setViewportSize({ width: 390, height: 780 })
    await page.screenshot({ path: info.outputPath('world-library-mobile.png') })
  }

  await page.reload()
  await expect(worldLink).toHaveCount(1)
  await worldLink.click()
  await expect(page.getByRole('heading', { name: worldName })).toBeVisible()
  const worldUrl = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { name: worldName })).toBeVisible()
  await expect(page.getByText('Owner', { exact: true })).toBeVisible()

  const other = await browser.newPage()
  try {
    await other.goto(worldUrl)
    await signIn(other, 'e2e-other', password)
    await expect(other.getByRole('heading', { name: 'World unavailable' })).toBeVisible()
    await expect(other.getByText(worldName, { exact: true })).toHaveCount(0)
    await other.getByRole('link', { name: 'All worlds' }).click()
    await expect(other.getByText('No worlds yet.', { exact: false })).toBeVisible()
  } finally {
    await other.close()
  }

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to CGS' })).toBeVisible()
  await page.goto(worldUrl)
  await expect(page.getByRole('heading', { name: 'Sign in to CGS' })).toBeVisible()
  await expect(page.getByText(worldName, { exact: true })).toHaveCount(0)
})

test('reuses the creation key after a lost response and a refresh', async ({ page }) => {
  await page.goto('/')
  await signIn(page, 'e2e-owner', testPassword())
  const worldName = 'Recovered Observatory ' + crypto.randomUUID().slice(0, 6)
  const keys: string[] = []

  await page.route('**/api/v1/worlds', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      keys.push(request.headers()['idempotency-key'])
      if (keys.length === 1) {
        const accepted = await route.fetch()
        expect(accepted.status()).toBe(201)
        await route.abort('failed')
        return
      }
    }
    await route.continue()
  })

  await page.getByRole('button', { name: 'Create world' }).click()
  await page.getByLabel('World name').fill(worldName)
  await page.getByRole('button', { name: 'Save world' }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm the save')
  await page.reload()
  await expect(page.getByLabel('World name')).toHaveValue(worldName)
  await page.getByRole('button', { name: 'Retry save' }).click()
  await expect(page.getByRole('link', { name: worldName, exact: true })).toHaveCount(1)
  await expect(page.getByRole('status').filter({ hasText: 'Created ' + worldName })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  await page.reload()
  await expect(page.getByRole('link', { name: worldName, exact: true })).toHaveCount(1)
})

test('returns to sign-in when the session expires during use', async ({ page }) => {
  await page.goto('/')
  await signIn(page, 'e2e-owner', testPassword())
  await expect(page.getByRole('heading', { name: 'Worlds', exact: true })).toBeVisible()
  await page.context().clearCookies()
  await page.getByRole('button', { name: 'Create world' }).click()
  await page.getByLabel('World name').fill('Session recovery check')
  await page.getByRole('button', { name: 'Save world' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to CGS' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Your session expired. Sign in again.')
  await expect(page.getByRole('list', { name: 'Your worlds' })).toHaveCount(0)
})
