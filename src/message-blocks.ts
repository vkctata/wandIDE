export type MessageBlock = { kind: 'text' | 'code'; content: string; language: string };

const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', py: 'python', rs: 'rust', sh: 'shell', bash: 'shell', yml: 'yaml', md: 'markdown', csharp: 'csharp' };

/** Parse fenced snippets only. Ordinary prose and HTML remain inert text. */
export function messageBlocks(source: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let lines: string[] = [];
  let fence = '';
  let language = '';
  const flush = () => {
    if (lines.length || fence) blocks.push({ kind: fence ? 'code' : 'text', content: lines.join('\n'), language });
    lines = [];
  };
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/);
      // Backtick info strings cannot contain backticks (including inline spans).
      if (opening && !(opening[1][0] === '`' && line.slice(line.indexOf(opening[1]) + opening[1].length).includes('`'))) {
        flush();
        fence = opening[1];
        const name = opening[2].toLowerCase();
        language = Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name || 'plaintext';
      } else lines.push(line);
    } else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
      flush(); fence = ''; language = '';
    } else lines.push(line);
  }
  flush();
  return blocks;
}

/** A timeline title is prose, not a flattened copy of an entire code block. */
export function messagePreview(source: string): string {
  const blocks = messageBlocks(source);
  const prose = blocks.filter(block => block.kind === 'text')
    .flatMap(block => block.content.split('\n')).find(line => line.trim());
  if (prose) {
    const title = prose.trim().replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ');
    return title.length > 160 ? `${title.slice(0, 159)}…` : title;
  }
  const code = blocks.find(block => block.kind === 'code');
  return code ? `${code.language === 'plaintext' ? 'Code' : code.language} snippet` : 'Empty post';
}
