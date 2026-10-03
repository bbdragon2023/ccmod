/* @jsx h */
import type { ElementConstructor } from 'claude-code'
import type { Chat } from '../../types'
import type { Theme } from '../theme/tokens'
import { friendColor, stateLabel } from './state'

type Elements = {
  Box: ElementConstructor<any>
  Text: ElementConstructor<any>
  Input: ElementConstructor<any>
}

const NOTE_INK = '#1d1b2e'

function banner(chat: Chat): string | null {
  switch (chat.status) {
    case 'off':
      return '還沒加入聊天室：/chatchat invite 開房，或 /chatchat join <邀請碼>'
    case 'unconfigured':
      return '還沒有聊天伺服器：/chatchat host 自己開一個，或 /chatchat server ws://…'
    case 'starting':
      return '連線中…'
    case 'reconnecting':
      return `聊天斷線了 · 第 ${chat.attempt} 次重新連線中…（/chatchat join 立即重試）`
    case 'missing':
    case 'error':
      return chat.note ?? '聊天出了問題：/chatchat join 重試'
    default:
      return chat.note
  }
}

export function chatView(el: Elements, chat: Chat, theme: Theme, rows: number, onSend: (text: string) => void) {
  const { Box, Text, Input } = el
  const notice = banner(chat)
  const others = chat.members.filter(member => member.id !== chat.myId)
  const room = chat.room ? `${chat.room.name} · ${chat.room.code}` : '聊天'
  const visible = chat.messages.slice(-Math.max(3, rows - 8))
  const isSticky = theme.name === 'studio'

  return (
    <Box flexDirection="column" gap={0}>
      <Text color={theme.muted} backgroundColor={theme.surface}>
        {room} · 訊息只給人看，不會傳給 Claude
      </Text>
      {others.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {others.map(member => {
            const color = friendColor(member.id, theme.friends)
            return (
              <Text color={color} backgroundColor={theme.surface}>
                ▲ {member.nick} · {stateLabel(member.state)}
              </Text>
            )
          })}
        </Box>
      )}
      {notice && (
        <Text color={chat.status === 'reconnecting' || chat.status === 'missing' || chat.status === 'error' ? theme.attention : theme.muted} backgroundColor={theme.surface}>
          {notice}
        </Text>
      )}
      {visible.length === 0 && chat.status === 'online' && (
        <Text color={theme.muted} backgroundColor={theme.surface}>
          {others.length === 0 ? '只有你在這裡，把邀請碼傳給朋友吧。' : '還沒有訊息。'}
        </Text>
      )}
      {visible.map(msg => {
        const color = msg.isMine ? theme.friends[2] ?? theme.accent : friendColor(msg.fromId, theme.friends)
        const name = msg.isMine ? '你' : msg.from
        return isSticky ? (
          <Box flexDirection="column" backgroundColor={color} paddingX={1} alignSelf={msg.isMine ? 'flex-end' : 'flex-start'} marginTop={0}>
            <Text color={NOTE_INK} backgroundColor={color} bold>
              {name}
            </Text>
            <Text color={NOTE_INK} backgroundColor={color}>
              {msg.text}
            </Text>
          </Box>
        ) : (
          <Text backgroundColor={theme.surface}>
            <Text color={color} bold>
              {name}：
            </Text>
            <Text color={theme.ink}>{msg.text}</Text>
          </Text>
        )
      })}
      {chat.status === 'online' && (
        <Input key="say" placeholder="說點什麼…" submitLabel="送出" value="" autoFocus onSubmit={(value: string) => onSend(value)} />
      )}
    </Box>
  )
}

export function unreadRow(el: Omit<Elements, 'Input'> & { Button: ElementConstructor<any> }, chat: Chat, theme: Theme, onOpen: () => void) {
  const { Box, Text, Button } = el
  const last = [...chat.messages].reverse().find(msg => !msg.isMine)
  return (
    <Box borderStyle="round" borderColor={theme.edge} paddingX={1} gap={2}>
      <Text color={theme.accent}>● {chat.unread} 則未讀</Text>
      {last && (
        <Text color={theme.ink} wrap="truncate-end">
          {last.from}：{last.text}
        </Text>
      )}
      <Button key="open-chat" label="打開聊天" onPress={onOpen} />
    </Box>
  )
}
