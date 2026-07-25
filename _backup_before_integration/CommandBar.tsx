/**
 * Command bar. Consistent classroom verbs (spec §8): Verify, Run, Pause, Step, Reset,
 * Stop. Lucide-React icons; every action is keyboard reachable.
 */
import { useState } from 'react';
import { CheckCircle2, Play, Pause, StepForward, RotateCcw, Square, FolderOpen, Save, BookOpen, Gauge } from 'lucide-react';
import { useCompiler, useProject, useSimulation, useLayout } from '../state/store';
import { simulationClient } from '../simulation/simulation-client';
import * as controller from './workbench-controller';

interface Props {
  onOpenExamples(): void;
}

export function CommandBar({ onOpenExamples }: Props): JSX.Element {
  const compiler = useCompiler();
  const project = useProject();
  const simulation = useSimulation();
  const [verifying, setVerifying] = useState(false);

  const running = simulation.phase === 'running';
  const paused = simulation.phase === 'paused';
  const hasProgram = simulation.phase !== 'empty' && simulation.phase !== 'ready';

  const doVerify = async (): Promise<void> => {
    setVerifying(true);
    try {
      await controller.verify();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="commandBar">
      <div className="commandBar__group">
        <button className="btn" onClick={() => void controller.openProject()} title="Open Project">
          <FolderOpen size={16} /> Open
        </button>
        <button className="btn" onClick={() => void controller.saveProject()} title="Save Project">
          <Save size={16} /> Save
        </button>
        <button className="btn" onClick={onOpenExamples} title="Offline Starter Library">
          <BookOpen size={16} /> Examples
        </button>
      </div>

      <div className="commandBar__group" style={{ marginLeft: 12 }}>
        <button className="btn" onClick={() => void doVerify()} disabled={verifying}>
          <CheckCircle2 size={16} /> {verifying ? 'Verifying…' : 'Verify'}
        </button>
        {!running ? (
          <button className="btn btn--primary" onClick={() => void controller.run()}>
            <Play size={16} /> Run
          </button>
        ) : (
          <button className="btn" onClick={() => controller.pause()}>
            <Pause size={16} /> Pause
          </button>
        )}
        <button className="btn" onClick={() => controller.step()} disabled={!paused}>
          <StepForward size={16} /> Step
        </button>
        <button className="btn" onClick={() => controller.reset()} disabled={!hasProgram}>
          <RotateCcw size={16} /> Reset
        </button>
        <button className="btn" onClick={() => controller.stop()} disabled={!hasProgram}>
          <Square size={16} /> Stop
        </button>
      </div>

      <div className="commandBar__spacer" />

      <div className="commandBar__group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Low-spec mode: 30 FPS, quarter real-time">
          <Gauge size={16} />
          <input
            type="checkbox"
            checked={useLowSpec()}
            onChange={(e) => simulationClient.setLowSpec(e.target.checked)}
          />
          Low-spec
        </label>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {compiler.flashBytes}/{compiler.flashMaxBytes} B flash · rev {project.sourceRevision}
        </span>
      </div>
    </div>
  );
}

function useLowSpec(): boolean {
  return useLayout().lowSpecMode;
}
