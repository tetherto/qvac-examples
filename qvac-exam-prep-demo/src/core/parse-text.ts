// ============================================================
// Markdown and plain text to Blocks. Pure, no I/O.
// ============================================================

import { slugify, type Block } from './chunk'

/** Inline Markdown to plain text: links keep their words, images vanish. */
function inline(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2')
    .trim()
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  let text = md.replace(/\r\n?/g, '\n')
  // Front matter and HTML comments carry no study material.
  text = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '')
  const lines = text.split('\n')

  let para: string[] = []
  let listMode = false
  const flush = (): void => {
    const joined = para.map(inline).filter(Boolean).join(listMode ? '\n' : ' ').trim()
    if (joined) blocks.push({ kind: 'text', text: joined })
    para = []
    listMode = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) body.push(lines[i])
      if (body.join('').trim()) blocks.push({ kind: 'text', text: body.join('\n'), code: true })
      continue
    }

    const atx = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (atx) {
      flush()
      const t = inline(atx[2])
      blocks.push({ kind: 'heading', level: atx[1].length, text: t, anchor: slugify(t) })
      continue
    }

    // Setext: a line underlined with === or ---.
    const next = lines[i + 1]
    if (line.trim() && next !== undefined && /^\s*(=+|-+)\s*$/.test(next) && para.length === 0) {
      const t = inline(line)
      blocks.push({ kind: 'heading', level: next.includes('=') ? 1 : 2, text: t, anchor: slugify(t) })
      i++
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }

    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      if (para.length && !listMode) flush()
      listMode = true
      para.push(`- ${item[2]}`)
      continue
    }

    // Table rows stay as lines so the junk filter can judge them.
    if (/^\s*\|/.test(line)) {
      if (para.length && !listMode) flush()
      listMode = true
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) para.push(line.trim())
      continue
    }

    if (listMode && /^\s{2,}\S/.test(line)) {
      para[para.length - 1] += ' ' + line.trim()
      continue
    }
    if (listMode) flush()
    para.push(line.replace(/^>\s?/, ''))
  }
  flush()
  return blocks
}

/**
 * Plain text has no markup, so the title becomes the root heading and a
 * short standalone line in capitals or Title Case is taken as a section
 * heading. Everything else is paragraphs split on blank lines.
 */
export function parsePlainText(text: string, title: string): Block[] {
  const blocks: Block[] = [{ kind: 'heading', level: 1, text: title }]
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  for (const raw of paras) {
    const p = raw.trim()
    if (!p) continue
    const oneLine = !p.includes('\n')
    const looksLikeHeading =
      oneLine &&
      p.length < 70 &&
      !/[.!?,;:]$/.test(p) &&
      (p === p.toUpperCase() || /^(\d+(\.\d+)*\.?\s+)?([A-Z][\w'’-]*\s*)+$/.test(p))
    if (looksLikeHeading) {
      const t = p.replace(/^\d+(\.\d+)*\.?\s+/, '')
      blocks.push({ kind: 'heading', level: 2, text: t })
    } else {
      blocks.push({ kind: 'text', text: p.replace(/\s*\n\s*/g, ' ') })
    }
  }
  return blocks
}
