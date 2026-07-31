/**
 * Top-level workbench shell.
 *
 * Layout: command bar across the top; a four-track body of
 *   [component library] [code editor] [3D circuit workspace] [inspector]
 * over a full-width bottom pane; status bar along the bottom.
 *
 * The two side panels collapse (store: `layout.trayVisible` / `layout.inspectorVisible`)
 * so the workbench still fits a 1366x768 classroom laptop. On narrow viewports the CSS
 * drops them automatically — see .workbench in global.css.
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
import { SaveErrorDialog } from './dialogs/SaveErrorDialog';
import { LogicAnalyzerCanvas } from './logic/LogicAnalyzerCanvas';
import { ComponentLibrary } from './panels/ComponentLibrary';
import { Inspector } from './panels/Inspector';
import { StatusBar } from './StatusBar';
import { useAppShortcuts } from './hooks/useAppShortcuts';
import {
  DEFAULT_EDITOR_PERCENT,
  MAX_EDITOR_PERCENT,
  MIN_EDITOR_PERCENT,
  measureWorkbench,
  pointerDeltaToEditorPercent,
} from './layout/workbench-region';
import { useLayout, useCompiler, useSimulation, useActions } from '../state/store';

export function AppShell(): JSX.Element {
  const layout = useLayout();
  const actions = useActions();
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewportMaximized, setViewportMaximized] = useState(false);
  const workbenchRef = useRef<HTMLDivElement | null>(null);

  useAppShortcuts();

  // The stored percentage is the editor's share of the flexible region (see
  // workbench-region.ts), so it reaches CSS as a unitless ratio the grid track multiplies
  // by whatever is left after the side panels.
  const setEditorWidth = (percent: number): void => {
    actions.setLayout({ editorWidthPercent: percent });
    if (workbenchRef.current) workbenchRef.current.style.setProperty('--editor-ratio', String(percent / 100));
  };
  const setBottomHeight = (px: number): void => {
    actions.setLayout({ bottomHeightPx: px });
    if (workbenchRef.current) workbenchRef.current.style.setProperty('--bottom-height', `${px}px`);
  };

  // Maximizing the viewport hides the editor, both side panels, and the splitter.
  const showLibrary = layout.trayVisible && !viewportMaximized;
  const showInspector = layout.inspectorVisible && !viewportMaximized;

  return (
    <div className="appShell">
      <CommandBar onOpenExamples={() => setExamplesOpen(true)} onOpenDocumentation={() => setHelpOpen(true)} />

      <div
        className="workbench"
        ref={workbenchRef}
        data-library={showLibrary ? 'on' : 'off'}
        data-inspector={showInspector ? 'on' : 'off'}
        style={viewportMaximized ? { gridTemplateColumns: '0 0 0 minmax(0, 1fr) 0' } : undefined}
      >
        {showLibrary && (
          <aside className="libraryPane" aria-label="Project explorer and component library">
            <ComponentLibrary />
          </aside>
        )}

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
          ariaLabel="Resize code editor and circuit workspace"
          min={MIN_EDITOR_PERCENT}
          max={MAX_EDITOR_PERCENT}
          value={layout.editorWidthPercent}
          onDragValue={setEditorWidth}
          onCommit={setEditorWidth}
          onRestoreDefault={() => setEditorWidth(DEFAULT_EDITOR_PERCENT)}
          pxToValue={(px) => pointerDeltaToEditorPercent(measureWorkbench(workbenchRef.current), px)}
          style={viewportMaximized ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
        />

        <section className="canvasPane" aria-label="3D circuit workspace">
          <div className="paneHeader paneHeader--row">
            <span>Circuit Workspace</span>
            <button
              type="button"
              className="btn btn--compact"
              onClick={() => setViewportMaximized((v) => !v)}
              aria-pressed={viewportMaximized}
              title={viewportMaximized ? 'Restore layout' : 'Maximize workspace'}
            >
              {viewportMaximized ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
              {viewportMaximized ? 'Restore' : 'Maximize'}
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CircuitPane />
          </div>
        </section>

        {showInspector && (
          <aside className="inspectorPane" aria-label="Properties and component inspector">
            <Inspector />
          </aside>
        )}

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
      {/* Driven by the store, not by local state: a save can fail from the toolbar button
          or from Ctrl+S, and neither path runs through this component. */}
      <SaveErrorDialog />
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
    { id: 'problems', label: `Problems${problemCount ? ` (${problemCount})` : ''}` },
    { id: 'serial', label: 'Serial Monitor' },
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
