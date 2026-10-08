import { rmSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { sideTab } from './helpers'
import { FAKE_CLI_ENV } from './fakeCli'

test.afterEach(() => rmSync(FAKE_CLI_ENV.FAKE_CLI_STATE, { force: true }))

test('the viewer picks the AI CLI, model and effort from live CLI lists', async ({ page }) => {
  rmSync(FAKE_CLI_ENV.FAKE_CLI_STATE, { force: true })
  await page.goto('/')
  await sideTab(page, '問 AI')
  const settings = page.getByTestId('ai-settings')
  await expect(settings.getByTestId('ai-choice')).toHaveText('伺服器預設（fake）')
  await settings.getByLabel('AI 設定').click()
  await settings.getByLabel('AI 來源').selectOption({ label: 'Codex CLI' })
  await settings.getByLabel('Model').selectOption('gpt-6-luna')
  await settings.getByLabel('Effort').selectOption('medium')
  await expect(settings.getByTestId('ai-choice')).toHaveText('Codex CLI · gpt-6-luna · effort medium')
  await expect(page.getByTestId('ai-explain')).toContainText('AI：Codex CLI · gpt-6-luna · effort medium')

  // The chosen CLI answers, with the chosen model and effort, about the board position.
  const chat = page.getByTestId('chat')
  await chat.getByLabel('提問').fill('這裡真正的威脅是什麼？')
  await chat.getByLabel('提問').press('Enter')
  const fen = (await page.locator('.board').getAttribute('data-fen'))!
  const answer = chat.locator('.chat-turn .answer').last()
  await expect(answer).toContainText(`[FAKE CODEX] model=gpt-6-luna effort=medium fen=${fen}`, { timeout: 20_000 })
  await expect(answer.locator('.answer-meta')).toContainText('codex:gpt-6-luna (medium)')

  // The choice is kept in this browser.
  await page.reload()
  await expect(page.getByTestId('ai-settings').getByTestId('ai-choice')).toHaveText('Codex CLI · gpt-6-luna · effort medium')
})

test('a model a CLI update removed falls back to the default instead of failing', async ({ page }) => {
  rmSync(FAKE_CLI_ENV.FAKE_CLI_STATE, { force: true })
  await page.goto('/')
  await sideTab(page, '問 AI')
  const settings = page.getByTestId('ai-settings')
  await settings.getByLabel('AI 設定').click()
  await settings.getByLabel('AI 來源').selectOption({ label: 'Codex CLI' })
  await settings.getByLabel('Model').selectOption('gpt-6-luna')
  await settings.getByLabel('AI 設定').click() // close

  // The CLI is updated: gpt-6-luna is gone, gpt-7 is new. Opening the settings asks the CLI again.
  writeFileSync(FAKE_CLI_ENV.FAKE_CLI_STATE, JSON.stringify({ codex_models: ['gpt-6.1-sol', 'gpt-7'] }))
  await settings.getByLabel('AI 設定').click()
  await expect(settings.getByRole('status')).toContainText('model「gpt-6-luna」已不提供，已改回預設')
  await expect(settings.getByTestId('ai-choice')).toHaveText('Codex CLI · CLI 預設 model')
  await expect(settings.getByLabel('Model').locator('option')).toHaveText(['CLI 預設', 'GPT-6.1-SOL（gpt-6.1-sol）', 'GPT-7（gpt-7）'])
})

test('a slow answer can be cancelled, and asking again works', async ({ page }) => {
  writeFileSync(FAKE_CLI_ENV.FAKE_CLI_STATE, JSON.stringify({ slow_seconds: 60 }))
  await page.goto('/')
  await sideTab(page, '問 AI')
  const settings = page.getByTestId('ai-settings')
  await settings.getByLabel('AI 設定').click()
  await settings.getByLabel('AI 來源').selectOption({ label: 'Codex CLI' })
  await settings.getByLabel('Model').selectOption('gpt-6-luna')

  const chat = page.getByTestId('chat')
  await chat.getByLabel('提問').fill('這裡真正的威脅是什麼？')
  await chat.getByLabel('提問').press('Enter')
  const waiting = chat.locator('.chat-turn').last().getByTestId('ai-waiting')
  await expect(waiting).toContainText('Codex CLI · gpt-6-luna')
  await waiting.getByTestId('ai-cancel').click()
  await expect(chat.locator('.chat-turn').last()).toContainText('已取消')

  // The whole-game scan can be cancelled the same way.
  await page.getByTestId('game-scan').getByRole('button', { name: '全局掃描：白方 miss 的錯誤' }).click()
  const scan = page.getByTestId('scan-white')
  await scan.getByTestId('ai-cancel').click()
  await expect(scan).toContainText('已取消')

  rmSync(FAKE_CLI_ENV.FAKE_CLI_STATE, { force: true })
  await chat.getByLabel('提問').fill('這裡真正的威脅是什麼？')
  await chat.getByLabel('提問').press('Enter')
  await expect(chat.locator('.chat-turn .answer').last()).toContainText('[FAKE CODEX] model=gpt-6-luna', { timeout: 20_000 })
})
