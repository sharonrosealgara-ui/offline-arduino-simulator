/**
 * Starter examples modal. One-click loads a bundled template (code + wiring) into the
 * workspace via loadProjectIntoStore — no filesystem round-trip, fully offline.
 */
import { useEffect, useRef } from 'react';
import { X, BookOpen } from 'lucide-react';
import { STARTER_TEMPLATES, templateToProjectFile, type StarterTemplate } from './examples-data';
import { loadProjectIntoStore } from '../project-bridge';

interface ExamplesModalProps {
  open: boolean;
  onClose(): void;
  /** Override load behavior (tests/storybook). Defaults to loading into the app store. */
  onLoad?(template: StarterTemplate): void;
}

export function ExamplesModal({ open, onClose, onLoad }: ExamplesModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const load = (t: StarterTemplate): void => {
    if (onLoad) onLoad(t);
    else loadProjectIntoStore(templateToProjectFile(t));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Starter examples"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <BookOpen size={18} /> Starter Examples
            </h2>
            <p className="mt-0.5 text-xs text-emerald-400">Works completely offline — loads code + wiring in one click.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <X size={16} />
          </button>
        </header>

        <ul className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {STARTER_TEMPLATES.map((t) => (
            <li key={t.id} className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-800/40 p-4 transition-colors hover:border-zinc-600">
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none" aria-hidden>{t.glyph}</span>
                <div className="min-w-0">
                  <h3 className="font-medium">{t.title}</h3>
                  <p className="mt-1 text-sm text-zinc-400">{t.description}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {t.concepts.map((c) => (
                  <span key={c} className="rounded-full bg-zinc-700/60 px-2 py-0.5 text-[11px] text-zinc-300">{c}</span>
                ))}
              </div>
              <button
                onClick={() => load(t)}
                className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-sky-600 text-sm font-semibold text-white transition-colors hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                Load into workspace
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
