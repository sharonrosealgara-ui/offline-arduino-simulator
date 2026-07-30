/**
 * Starter examples modal. One-click loads a bundled template (code + wiring) into the
 * workspace via loadProjectIntoStore — no filesystem round-trip, fully offline.
 *
 * This dialog previously carried Tailwind utility classes (`fixed inset-0 z-50 …`) while
 * the project has no Tailwind dependency, build step, or config — so every one of them was
 * inert and the modal rendered as unstyled HTML. It now uses the project's own design
 * system from styles/workbench.css.
 */
import { useEffect, useRef } from 'react';
import { X, BookOpen, Lightbulb, SlidersHorizontal, RotateCw, MonitorSmartphone, ToggleLeft } from 'lucide-react';
import { STARTER_TEMPLATES, templateToProjectFile, type StarterTemplate } from './examples-data';
import { loadProjectIntoStore } from '../project-bridge';

interface ExamplesModalProps {
  open: boolean;
  onClose(): void;
  /** Override load behavior (tests/storybook). Defaults to loading into the app store. */
  onLoad?(template: StarterTemplate): void;
}

/** Icons rather than emoji: emoji render differently per OS and read as unprofessional. */
const ICONS: Record<StarterTemplate['icon'], JSX.Element> = {
  blink: <Lightbulb size={18} aria-hidden />,
  analog: <SlidersHorizontal size={18} aria-hidden />,
  motion: <RotateCw size={18} aria-hidden />,
  display: <MonitorSmartphone size={18} aria-hidden />,
  input: <ToggleLeft size={18} aria-hidden />,
};

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
    <div className="modalScrim" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modalPanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="examples-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modalHeader">
          <div>
            <h2 className="modalHeader__title" id="examples-title">
              <BookOpen size={18} aria-hidden /> Starter Examples
            </h2>
            <p className="modalHeader__subtitle">
              Works completely offline — loads the sketch and its wiring in one click.
            </p>
          </div>
          <button type="button" className="modalHeader__close" onClick={onClose} aria-label="Close examples">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="modalBody">
          <ul className="exampleGrid">
            {STARTER_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button type="button" className="exampleCard" onClick={() => load(t)}>
                  <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ flexShrink: 0, marginTop: 2 }}>{ICONS[t.icon]}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="exampleCard__name" style={{ display: 'block' }}>
                        {t.title}
                      </span>
                      <span className="exampleCard__desc" style={{ display: 'block' }}>
                        {t.description}
                      </span>
                    </span>
                  </span>
                  <span className="exampleCard__tags">
                    {t.concepts.map((c) => (
                      <span key={c} className="tagChip">
                        {c}
                      </span>
                    ))}
                  </span>
                  <span className="exampleCard__cta">Load into workspace →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
