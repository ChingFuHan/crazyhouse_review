import { DEFAULT_SETTINGS, OPTIONS, describe } from '../engineSettings'
import type { SearchSettings } from '../types'

interface FieldProps<K extends keyof SearchSettings> {
  name: K
  label: string
  format: (value: SearchSettings[K]) => string
  settings: SearchSettings
  onChange: (settings: SearchSettings) => void
}

function Field<K extends keyof SearchSettings>({ name, label, format, settings, onChange }: FieldProps<K>) {
  const options = OPTIONS[name] as SearchSettings[K][]
  return (
    <label className="setting">
      <span>{label}</span>
      <select
        aria-label={label}
        value={options.indexOf(settings[name])}
        onChange={(event) => onChange({ ...settings, [name]: options[Number(event.target.value)] })}
      >
        {options.map((value, index) => (
          <option key={index} value={index}>
            {format(value)}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface EngineSettingsProps {
  settings: SearchSettings
  onChange: (settings: SearchSettings) => void
}

export function EngineSettings({ settings, onChange }: EngineSettingsProps) {
  const shared = { settings, onChange }
  return (
    <div className="engine-settings" data-testid="engine-settings">
      <Field name="multipv" label="線數" format={String} {...shared} />
      <Field name="depth" label="深度上限" format={describe.depth} {...shared} />
      <Field name="movetime_ms" label="計算時間" format={describe.time} {...shared} />
      <Field name="threads" label="CPU 執行緒" format={String} {...shared} />
      <Field name="hash_mb" label="記憶體 (Hash)" format={describe.hash} {...shared} />
      <p className="engine-settings-note">
        深度上限或計算時間先到即停止；「無限」會一直算到按停止或換局面。Engine 由所有連線者共用，同時分析不同局面會互相取代。
      </p>
      <button className="engine-settings-reset" onClick={() => onChange(DEFAULT_SETTINGS)}>
        恢復預設
      </button>
    </div>
  )
}
