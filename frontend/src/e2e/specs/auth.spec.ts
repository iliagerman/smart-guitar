import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('shows login page by default', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId('login-form')).toBeVisible()
  })

  test('login form has all required elements', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('login-email')).toBeVisible()
    await expect(page.getByTestId('login-password')).toBeVisible()
    await expect(page.getByTestId('login-submit')).toBeVisible()
    await expect(page.getByTestId('google-signin')).toBeVisible()
    await expect(page.getByTestId('create-account-link')).toBeVisible()
  })

  test('navigate to register page', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('create-account-link').click()
    await expect(page).toHaveURL(/\/register/)
    await expect(page.getByTestId('register-form')).toBeVisible()
  })

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/search')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from library to login', async ({ page }) => {
    await page.goto('/library')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects unauthenticated users from favorites to login', async ({ page }) => {
    await page.goto('/favorites')
    await expect(page).toHaveURL(/\/login/)
  })
})
