import { describe, expect, it } from 'vitest'
import { themeLabel } from './themes'

describe('puzzle theme labels', () => {
  it('names every theme the backend produces, and hides unknown codes', () => {
    const produced = [
      'drop', 'drop_check', 'drop_mate', 'queen_drop', 'interposition_drop', 'mate', 'check', 'discovered_check',
      'knight_fork', 'double_attack', 'escape_square_reduction', 'capture', 'promotion', 'discovered_attack',
      'blocks_line', 'opens_file', 'mate_threat', 'piece_en_prise', 'pocket_emptied', 'quiet_move', 'sacrifice',
      'tempting_alternative', 'battle',
    ]
    for (const theme of produced) expect(themeLabel(theme), theme).toBeTruthy()
    expect(themeLabel('mate_in_3')).toBe('3 步殺')
    expect(themeLabel('something_new')).toBeNull()
  })
})
