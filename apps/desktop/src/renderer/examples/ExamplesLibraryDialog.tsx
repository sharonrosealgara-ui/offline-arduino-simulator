/**
 * Offline starter library. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §11.
 *
 * "Open a Copy" always creates an editable copy via the main process; the packaged
 * original is never modified. Everything here works completely offline.
 */
import { useEffect, useState } from 'react';
import { X, BookOpen } from 'lucide-react';
import type { ExampleIndexEntryDTO } from '../../preload/electron-api-types';
import { useActions } from '../state/store';
import { loadProjectIntoStore } from '../app/project-bridge';

interface Props {
  onClose(): void;
}

export function ExamplesLibraryDialog({ onClose }: Props): JSX.Element {
  const [examples, setExamples] = useState<ExampleIndexEntryDTO[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useActions();

  useEffect(() => {
    window.electronAPI
      .listExamples()
      .then(setExamples)
      .catch(() => setError('Could not load the offline examples.'));
  }, []);

  const openCopy = async (id: string): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      const project = await window.electronAPI.openExampleCopy(id);
      loadProjectIntoStore(project);
      onClose();
    } catch {
      setError('Could not open this example.');
    } finally {
      setBusyId(null);
    }
    void actions;
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Offline example library" style={overlay}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
            <BookOpen size={20} /> Offline Starter Library
          </h2>
          <button className="btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p style={{ marginTop: 0, color: 'var(--success)', fontWeight: 600 }}>Works completely offline.</p>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

        {examples.length === 0 && !error && <p style={{ color: 'var(--text-secondary)' }}>Loading examples…</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {examples.map((example) => (
            <div key={example.id} style={card}>
              <h3 style={{ margin: '0 0 4px' }}>{example.title}</h3>
              <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: 13 }}>{example.summary}</p>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {example.difficulty} · ~{example.estimatedMinutes} min · {example.concepts.join(', ')}
              </div>
              <button className="btn btn--primary" disabled={busyId === example.id} onClick={() => openCopy(example.id)}>
                {busyId === example.id ? 'Opening…' : 'Open a Copy'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 24,
};
const panel: React.CSSProperties = {
  background: 'var(--bg-panel)',
  borderRadius: 10,
  padding: 20,
  width: 'min(920px, 100%)',
  maxHeight: '85vh',
  overflow: 'auto',
  border: '1px solid var(--border)',
};
const card: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 12,
  background: 'var(--bg-panel-alt)',
};
