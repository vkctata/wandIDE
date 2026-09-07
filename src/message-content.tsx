import React, { useEffect, useMemo, useState } from 'react';
import { messageBlocks } from './message-blocks';

const SnippetEditor = React.lazy(() => import('./editor').then((module) => ({ default: module.CodeEditor })));

class SnippetBoundary extends React.Component<{ children: React.ReactNode; content: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <pre className="message-plain">{this.props.content}</pre> : this.props.children; }
}

export function MessageContent({ content }: { content: string }) {
  const [theme, setTheme] = useState(document.body.dataset.theme);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.body.dataset.theme));
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const blocks = useMemo(() => messageBlocks(content), [content]);
  return <section className="message-content" aria-label="Message content">
    {blocks.map((block, index) => block.kind === 'text'
      ? <div className="message-prose" key={index}>{block.content}</div>
      : <section className="message-snippet" aria-label={`${block.language} code snippet`} key={index}>
          <header>{block.language}<span>Read only</span></header>
          {(index > 5 || block.content.length > 20000) && !expanded.has(index) ? <>
            <pre className="message-plain">{block.content}</pre>
            <button className="outline" onClick={() => setExpanded((current) => new Set([...current, index]))}>Format code</button>
          </> : <SnippetBoundary content={block.content}>
            <React.Suspense fallback={<pre className="message-plain">{block.content}</pre>}>
              <SnippetEditor height={Math.min(320, Math.max(90, block.content.split('\n').length * 20 + 24))}
                language={block.language} value={block.content} theme={theme === 'daylight' ? 'vs' : 'vs-dark'}
                options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, automaticLayout: true,
                  fontSize: 13, lineHeight: 20, scrollBeyondLastLine: false, wordWrap: 'on', folding: false,
                  renderLineHighlight: 'none', overviewRulerLanes: 0, contextmenu: false,
                  ariaLabel: `${block.language} read-only code`, tabFocusMode: true }} />
            </React.Suspense>
          </SnippetBoundary>}
        </section>)}
  </section>;
}
