/**
 * In-app Documentation panel. Renders the bundled universal user guide
 * (resources/docs/USER_GUIDE.md) fetched over the typed IPC bridge.
 *
 * Security: markdown is rendered through a tiny trusted parser into React
 * elements — never innerHTML — so the strict CSP and no-arbitrary-HTML rule
 * from the setup spec are preserved. Fully offline; zero network requests.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { X, BookOpen } from 'lucide-react';

interface Props {
  onClose(): void;
}

export function DocumentationDialog({ onClose }: Props): JSX.Element {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getUserGuide()
      .then((text) => {
        if (!cancelled) setMarkdown(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Documentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(860px, 92vw)',
          height: 'min(680px, 88vh)',
          background: 'var(--bg-primary, #1e2227)',
          color: 'var(--text-primary, #e6e6e6)',
          borderRadius: 10,
          border: '1px solid var(--border, #33373d)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border, #33373d)',
          }}
        >
          <BookOpen size={16} />
          <strong style={{ fontSize: 14 }}>Documentation</strong>
          <button className="btn" onClick={onClose} aria-label="Close documentation" style={{ marginLeft: 'auto' }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 24px', fontSize: 14, lineHeight: 1.65 }}>
          {error && <p style={{ color: '#f87171' }}>Failed to load documentation: {error}</p>}
          {!error && markdown === null && <p>Loading…</p>}
          {!error && markdown !== null && renderMarkdown(markdown)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Minimal trusted markdown renderer (headings, paragraphs, lists, tables, bold/code).
// Deliberately conservative: unknown syntax degrades to plain text. No raw HTML support.
// ---------------------------------------------------------------------------------------

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code key={key} style={{ background: '#2c313a', padding: '1px 5px', borderRadius: 4, fontSize: 13 }}>
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part.length > 0) {
      nodes.push(part);
    }
  });
  return nodes;
}

function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      const style = { marginTop: level === 1 ? 4 : 22, marginBottom: 8 };
      out.push(
        level === 1 ? (
          <h1 key={key++} style={{ ...style, fontSize: 22 }}>
            {content}
          </h1>
        ) : level === 2 ? (
          <h2 key={key++} style={{ ...style, fontSize: 18 }}>
            {content}
          </h2>
        ) : (
          <h3 key={key++} style={{ ...style, fontSize: 15 }}>
            {content}
          </h3>
        ),
      );
      i += 1;
      continue;
    }

    // Table block
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const rows = tableLines
        .filter((l) => !/^[\s|:-]+$/.test(l))
        .map((l) =>
          l
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim()),
        );
      if (rows.length > 0) {
        out.push(
          <table key={key++} style={{ borderCollapse: 'collapse', margin: '10px 0', width: '100%' }}>
            <thead>
              <tr>
                {rows[0].map((cell, c) => (
                  <th
                    key={c}
                    style={{
                      border: '1px solid #3a3f46',
                      padding: '6px 10px',
                      textAlign: 'left',
                      background: '#262b31',
                    }}
                  >
                    {renderInline(cell, `th${key}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ border: '1px solid #3a3f46', padding: '6px 10px', verticalAlign: 'top' }}>
                      {renderInline(cell, `td${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>,
        );
      }
      continue;
    }

    // Unordered list block
    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, ''));
        i += 1;
      }
      out.push(
        <ul key={key++} style={{ margin: '8px 0 8px 22px' }}>
          {items.map((item, n) => (
            <li key={n} style={{ marginBottom: 4 }}>
              {renderInline(item, `li${key}-${n}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph: merge consecutive plain lines.
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('|') &&
      !/^\s*-\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(
      <p key={key++} style={{ margin: '8px 0' }}>
        {renderInline(para.join(' '), `p${key}`)}
      </p>,
    );
  }

  return out;
}
