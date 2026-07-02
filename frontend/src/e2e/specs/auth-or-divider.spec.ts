import { test, expect } from '@playwright/test'

test.describe('Login/Register "or" divider', () => {
  test('shows "or" text between the form and the Google button on login', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByTestId('login-form')).toBeVisible()
    await expect(page.getByTestId('auth-divider-or')).toHaveText(/or/i)
  })

  test('shows "or" text between the form and the Google button on register', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByTestId('register-form')).toBeVisible()
    await expect(page.getByTestId('auth-divider-or')).toHaveText(/or/i)
  })
})
