import { expect, test } from '@playwright/test';

test.describe('Browse smoke (Phase D)', () => {
  test('loads city table and waits for API', async ({ page }) => {
    const tableResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/table/city') &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
    );

    await page.goto('/browse/city');
    await tableResponse;

    await expect(page.getByTestId('browse-data-table')).toBeVisible();
    await expect(page.getByTestId('browse-city-tab')).toHaveClass(/bg-accent/);
  });

  test('applies ISO country filter from header input', async ({ page }) => {
    await page.goto('/browse/city');
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/table/city') && resp.status() === 200,
    );

    const filterResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/table/city') &&
        resp.url().includes('country_iso_code') &&
        resp.status() === 200,
    );

    const isoInput = page.getByPlaceholder('ISO');
    await isoInput.fill('RU');
    await isoInput.press('Enter');

    await filterResponse;
    await expect(page).toHaveURL(/filters=.*RU/);
    await expect(page.getByText('ISO страны:')).toBeVisible();
  });

  test('toggles sort on Country column', async ({ page }) => {
    await page.goto('/browse/city');
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/table/city') && resp.status() === 200,
    );

    const sortResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/table/city') &&
        resp.url().includes('country_name') &&
        resp.status() === 200,
    );

    await page.getByRole('button', { name: /Сортировка Страна/ }).click();
    await sortResponse;

    await expect(page).toHaveURL(/sort=.*country_name/);
  });

  test('switches to country tab with fresh default state', async ({ page }) => {
    await page.goto('/browse/city');
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/table/city') && resp.status() === 200,
    );

    const isoInput = page.getByPlaceholder('ISO');
    await isoInput.fill('RU');
    const filteredCity = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/table/city') &&
        resp.url().includes('country_iso_code') &&
        resp.status() === 200,
    );
    await isoInput.press('Enter');
    await filteredCity;
    await expect(page.getByText('ISO страны:')).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/table/country') && resp.status() === 200,
      ),
      page.getByTestId('browse-country-tab').click(),
    ]);

    await expect(page).toHaveURL(/\/browse\/country/);
    await expect(page.getByTestId('browse-country-tab')).toHaveClass(/bg-accent/);
    await expect(page.getByText('ISO страны:')).not.toBeVisible();
    await expect(page.url()).not.toMatch(/RU/);
  });

  test('reset button clears filters sort and validation errors', async ({ page }) => {
    await page.goto('/browse/city');
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/table/city') && resp.status() === 200,
    );

    await page.getByPlaceholder('Prefix').fill('abc');
    await page.getByPlaceholder('Prefix').press('Enter');
    await expect(page.locator('[role="alert"]').filter({ hasText: 'целое число' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();

    await expect(page.getByText('Активные фильтры:')).not.toBeVisible();
    await expect(page.locator('[role="alert"]').filter({ hasText: 'целое число' })).toHaveCount(0);
  });

  test('preserves sort and filters in URL after reload', async ({ page }) => {
    await page.goto('/browse/city?sort=%5B%5D&filters=%5B%7B%22field%22%3A%22country_iso_code%22%2C%22op%22%3A%22eq%22%2C%22value%22%3A%22RU%22%7D%5D');
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/table/city') && resp.status() === 200,
    );
    await expect(page.getByText('ISO страны:')).toBeVisible();

    await page.reload();
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/table/city') && resp.status() === 200,
    );

    await expect(page).toHaveURL(/country_iso_code.*RU/);
    await expect(page.getByText('ISO страны:')).toBeVisible();
  });
});
