/**
 * Top-level workbench shell: command bar, three-pane grid (editor | canvas over a
 * full-width bottom pane), and status bar. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §2, §3.
 */
import { useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { CommandBar } from './CommandBar';
import { MonacoSketchEditor } from '../editor/MonacoSketchEditor';
import { CircuitPane } from './components/CircuitPane';
import { VirtualSerialMonitor } from '../serial/VirtualSerialMonitor';
import { ProblemsView } from '../components/ProblemsView';
import { RuntimeDiagnostics } from '../components/RuntimeDiagnostics';
import { PaneSplitter } from '../components/PaneSplitter';
import { ExamplesModal } from './dialogs/ExamplesModal';
import { HelpDrawer } from './dialogs/HelpDrawer';
import { LogicAnalyzerCanvas } from './logic/LogicAnalyzerCanvas';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import { useLayout, useSimulation, useCompiler, useActions } from '../state/store';

export function AppShell(): JSX.Element {
  const layout = useLayout();
  const actions = useActions();
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewportMaximized, setViewportMaximized] = useState(false);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  // Ctrl/Cmd+S → Save, Ctrl/Cmd+Enter → Verify & Run.
  useAppShortcuts();

  const setEditorWidth = (percent: number): void => {
    actions.setLayout({ editorWidthPercent: percent });
    if (workbenchRef.current) workbenchRef.current.style.setProperty('--editor-width', `${percent}%`);
  };
  const setBottomHeight = (px: number): void => {
    actions.setLayout({ bottomHeightPx: px });
    if (workbenchRef.current) workbenchRef.current.style.setProperty('--bottom-height', `${px}px`);
  };

  return (
    <div className="appShell">
      <CommandBar onOpenExamples={() => setExamplesOpen(true)} onOpenDocumentation={() => setHelpOpen(true)} />

      <div
        className="workbench"
        ref={workbenchRef}
        // Maximize collapses the editor + vertical splitter tracks to 0 (keeping all 3
        // grid tracks so no grid-column placements break), giving the circuit full width.
        style={viewportMaximized ? { gridTemplateColumns: '0px 0px minmax(0, 1fr)' } : undefined}
      >
        <section
          className="editorPane"
          aria-label="Code editor"
          style={viewportMaximized ? { visibility: 'hidden' } : undefined}
        >
          <div className="paneHeader">Sketch.ino</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <MonacoSketchEditor />
          </div>
        </section>

        <PaneSplitter
          orientation="vertical"
          ariaLabel="Resize code editor and circuit canvas"
          min={30}
          max={70}
          value={layout.editorWidthPercent}
          onDragValue={setEditorWidth}
          onCommit={setEditorWidth}
          onRestoreDefault={() => setEditorWidth(46)}
          pxToValue={(px) => (px / (workbenchRef.current?.clientWidth ?? 1440)) * 100}
          style={viewportMaximized ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
        />

        <section className="canvasPane" aria-label="Circuit canvas">
          <div className="paneHeader" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Circuit</span>
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 'auto', minHeight: 0, minWidth: 0, padding: '2px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={() => setViewportMaximized((v) => !v)}
              aria-pressed={viewportMaximized}
              title={viewportMaximized ? 'Restore layout' : 'Maximize viewport'}
            >
              {viewportMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {viewportMaximized ? 'Restore' : 'Maximize'}
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CircuitPane />
          </div>
        </section>

        <PaneSplitter
          orientation="horizontal"
          ariaLabel="Resize workbench and bottom panel"
          min={160}
          max={Math.round((workbenchRef.current?.clientHeight ?? 800) * 0.4)}
          value={layout.bottomHeightPx}
          onDragValue={setBottomHeight}
          onCommit={setBottomHeight}
          onRestoreDefault={() => setBottomHeight(240)}
          pxToValue={(px) => -px}
        />

        <section className="bottomPane" aria-label="Serial monitor and diagnostics">
          <BottomTabs />
        </section>
      </div>

      <StatusBar />

      <ExamplesModal open={examplesOpen} onClose={() => setExamplesOpen(false)} />
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function BottomTabs(): JSX.Element {
  const layout = useLayout();
  const actions = useActions();
  const compiler = useCompiler();
  const simulation = useSimulation();

  const problemCount = compiler.diagnostics.length + simulation.circuitDiagnostics.length;

  const tabs: Array<{ id: typeof layout.selectedBottomTab; label: string }> = [
    { id: 'serial', label: 'Serial Monitor' },
    { id: 'problems', label: `Problems${problemCount ? ` (${problemCount})` : ''}` },
    { id: 'runtime', label: 'Circuit & Runtime' },
    { id: 'logic', label: 'Logic Analyzer' },
  ];

  return (
    <>
      <div className="tabBar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={layout.selectedBottomTab === tab.id}
            className="tabBar__tab"
            onClick={() => actions.setLayout({ selectedBottomTab: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {layout.selectedBottomTab === 'serial' && <VirtualSerialMonitor />}
        {layout.selectedBottomTab === 'problems' && <ProblemsView />}
        {layout.selectedBottomTab === 'runtime' && <RuntimeDiagnostics />}
        {layout.selectedBottomTab === 'logic' && <LogicAnalyzerCanvas />}
      </div>
    </>
  );
}

function StatusBar(): JSX.Element {
  const simulation = useSimulation();
  return (
    <div className="statusBar">
      <span className="statusBar__offlineReady">● OFFLINE READY</span>
      <span>Arduino Uno · ATmega328P · 16 MHz</span>
      <span style={{ marginLeft: 'auto' }}>Simulation: {simulation.phase}</span>
    </div>
  );
}
