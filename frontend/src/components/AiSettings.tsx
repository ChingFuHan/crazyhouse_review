import { useState } from 'react'
import { type AiChoiceView, describeChoice, effortsFor } from '../aiChoice'
import type { LlmProviderId } from '../types'

/** Which AI answers: the server default, or one of the installed CLIs with its model and effort.
 * The lists are read from the CLIs every time the settings open. */
export function AiSettings({ ai }: { ai: AiChoiceView }) {
  const [open, setOpen] = useState(false)
  const { choice, catalog } = ai
  const provider = catalog?.providers.find((p) => p.id === choice?.provider) ?? null

  const toggle = () => {
    if (!open) ai.refresh()
    setOpen(!open)
  }

  return (
    <div className="ai-settings" data-testid="ai-settings">
      <div className="ai-settings-summary">
        <span>
          AI：<strong data-testid="ai-choice">{describeChoice(choice, catalog)}</strong>
        </span>
        <button className="engine-action" aria-label="AI 設定" aria-expanded={open} title="選擇 AI 來源、model 與 effort" onClick={toggle}>
          ⚙
        </button>
      </div>
      {ai.dropped && (
        <div className="notice" role="status">
          {ai.dropped}，已改回預設。
        </div>
      )}
      {open && (
        <div className="ai-settings-form">
          {ai.loading && <div className="engine-note">正在向 CLI 查詢可用的 model 與 effort…</div>}
          {ai.error && <div className="engine-error">無法取得 AI 清單：{ai.error}</div>}
          {catalog && (
            <>
              <label className="setting">
                <span>AI 來源</span>
                <select
                  aria-label="AI 來源"
                  value={choice?.provider ?? ''}
                  onChange={(e) =>
                    ai.setChoice(e.target.value ? { provider: e.target.value as LlmProviderId, model: null, effort: null } : null)
                  }
                >
                  <option value="">伺服器預設{catalog.default ? `（${catalog.default}）` : '（未設定）'}</option>
                  {catalog.providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.label}
                      {p.available ? '' : `（${p.reason ?? '無法使用'}）`}
                    </option>
                  ))}
                </select>
              </label>
              {choice && provider && (
                <>
                  <label className="setting">
                    <span>Model</span>
                    <select
                      aria-label="Model"
                      value={choice.model ?? ''}
                      onChange={(e) => ai.setChoice({ ...choice, model: e.target.value || null, effort: null })}
                    >
                      <option value="">CLI 預設</option>
                      {provider.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label === m.id ? m.id : `${m.label}（${m.id}）`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="setting">
                    <span>Effort</span>
                    <select
                      aria-label="Effort"
                      value={choice.effort ?? ''}
                      onChange={(e) => ai.setChoice({ ...choice, effort: e.target.value || null })}
                    >
                      <option value="">CLI 預設</option>
                      {effortsFor(provider, choice.model).map((effort) => (
                        <option key={effort} value={effort}>
                          {effort}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <p className="engine-settings-note">
                清單每次開啟都會向本機 CLI 重新查詢；使用的是該 CLI 登入帳號的訂閱額度。較高的 effort 回答較慢、較耗額度。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
