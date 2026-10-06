import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RichText } from './components/RichText'

describe('RichText', () => {
  it('renders inline code, bold (with code inside), rules and lists as elements, never raw HTML', () => {
    const html = renderToStaticMarkup(
      <RichText text={'最佳著 `4.d4`，**不是 `4.Qh5`**\n\n---\n- 一\n- 二\n<b>x</b>'} />,
    )
    expect(html).toContain('<code>4.d4</code>')
    expect(html).toContain('<strong>不是 <code>4.Qh5</code></strong>')
    expect(html).toContain('<hr/>')
    expect(html).toContain('<ul><li>一</li><li>二</li></ul>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('---')
  })
})
