import { describe, expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'chatchat',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'chatchat',
  viewport: { columns: 140, rows: 40 },
  props: { title: 'chatchat', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

describe('arcade pane', () => {
  test('draws the menu and moves between games by key', async $ => {
    const ui = await $.ui.mount<'terminal', 'Pane'>(PANE as never)
    await ui.resize({ columns: 56, rows: 24, in: 'arcade' })
    expect(await ui.find({ text: /▸ 貪食蛇/, in: 'arcade' })).toBeDefined()

    await ui.key({ key: 'down', in: 'arcade' })
    expect(await ui.find({ text: /▸ 合併方塊/, in: 'arcade' })).toBeDefined()

    await ui.key({ key: 'return', in: 'arcade' })
    expect(await ui.find({ text: /按任一方向鍵開始/, in: 'arcade' })).toBeDefined()

    await ui.key({ key: 'left', in: 'arcade' })
    expect(await ui.find({ text: /分數 0/, in: 'arcade' })).toBeDefined()
    await ui.unmount()
  })

  test('a posted best score is kept and shown in the menu', async ($, on) => {
    mock.store(on)
    const ui = await $.ui.mount<'terminal', 'Pane'>(PANE as never)
    await ui.resize({ columns: 56, rows: 24, in: 'arcade' })
    await ui.post({ type: 'best', game: 'snake', score: 7, isLowerBetter: false }, { in: 'arcade' })
    expect(await ui.find({ text: /貪食蛇.*最高 7/, in: 'arcade' })).toBeDefined()
    // A lower score does not replace it.
    await ui.post({ type: 'best', game: 'snake', score: 3, isLowerBetter: false }, { in: 'arcade' })
    expect(await ui.find({ text: /最高 7/, in: 'arcade' })).toBeDefined()
    expect(await ui.find({ text: /最高 3/, in: 'arcade' })).toBeUndefined()
    await ui.unmount()
  })

  test('the pane falls back to a note off the terminal', async $ => {
    const ui = await $.ui.mount<'desktop', 'Pane'>({ ...PANE, surface: 'desktop' } as never)
    expect(await ui.find({ text: /只支援終端機/ })).toBeDefined()
    await ui.unmount()
  })
})
