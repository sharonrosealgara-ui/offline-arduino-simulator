/**
 * Offline installation & security help content contract.
 * Source: UI_CANVAS_AND_PACKAGING_SPEC.md §31.
 *
 * Help content comes from a local release manifest generated during packaging. The
 * renderer must NOT accept arbitrary HTML — render structured JSON with trusted React
 * components, or sanitize a static standalone HTML copy at build time.
 */

export type HelpPlatform = 'windows' | 'macos' | 'linux';

export interface VerifiedArtifact {
  platform: HelpPlatform;
  fileName: string;
  sha256: string;
  signed: boolean;
}

export interface OfflineInstallGuide {
  version: string;
  artifacts: VerifiedArtifact[];
}
