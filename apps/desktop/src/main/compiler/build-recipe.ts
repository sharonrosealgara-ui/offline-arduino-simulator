/**
 * Argument-array builders for every AVR toolchain stage. Derived from the pinned
 * ArduinoCore-avr platform.txt. Source: OFFLINE_ARDUINO_SIMULATOR_SETUP_SPEC.md §5.3.
 *
 * These are the ONLY place compiler flags are assembled. Renderer input never reaches
 * argv directly — it only supplies source text, which is written to a fixed filename
 * inside an isolated temp workspace before these functions run.
 */
import type { BoardProfile } from '@offline-arduino/contracts/board-profiles';
import type { ToolchainLayout } from './toolchain-paths';

function commonDefines(profile: BoardProfile): string[] {
  return [
    `-mmcu=${profile.mcu}`,
    `-DF_CPU=${profile.fCpu}`,
    '-DARDUINO=10819',
    `-D${profile.boardMacro}`,
    `-D${profile.architectureMacro}`,
  ];
}

function commonIncludes(coreDir: string, variantDir: string): string[] {
  return ['-I', coreDir, '-I', variantDir];
}

export function makeCppCompileArgs(
  profile: BoardProfile,
  layout: ToolchainLayout,
  coreDir: string,
  variantDir: string,
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-c',
    '-g',
    '-Os',
    '-std=gnu++11',
    '-fpermissive',
    '-fno-exceptions',
    '-ffunction-sections',
    '-fdata-sections',
    '-fno-threadsafe-statics',
    '-flto',
    '-MMD',
    ...commonDefines(profile),
    ...commonIncludes(coreDir, variantDir),
    inputPath,
    '-o',
    outputPath,
  ];
}

export function makeCCompileArgs(
  profile: BoardProfile,
  layout: ToolchainLayout,
  coreDir: string,
  variantDir: string,
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-c',
    '-g',
    '-Os',
    '-std=gnu11',
    '-ffunction-sections',
    '-fdata-sections',
    '-flto',
    '-MMD',
    ...commonDefines(profile),
    ...commonIncludes(coreDir, variantDir),
    inputPath,
    '-o',
    outputPath,
  ];
}

export function makeAsmCompileArgs(
  profile: BoardProfile,
  layout: ToolchainLayout,
  coreDir: string,
  variantDir: string,
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-c',
    '-g',
    '-x',
    'assembler-with-cpp',
    ...commonDefines(profile),
    ...commonIncludes(coreDir, variantDir),
    inputPath,
    '-o',
    outputPath,
  ];
}

export function makeArchiveArgs(archivePath: string, objectPath: string): string[] {
  return ['rcs', archivePath, objectPath];
}

export function makeLinkArgs(
  profile: BoardProfile,
  workspace: string,
  objectPaths: string[],
  coreArchivePath: string,
  outputElfPath: string,
): string[] {
  return [
    '-Os',
    '-g',
    '-flto',
    '-fuse-linker-plugin',
    '-Wl,--gc-sections',
    `-mmcu=${profile.mcu}`,
    '-o',
    outputElfPath,
    ...objectPaths,
    coreArchivePath,
    '-L',
    workspace,
    '-lm',
  ];
}

export function makeObjcopyArgs(elfPath: string, hexPath: string): string[] {
  return ['-O', 'ihex', '-R', '.eeprom', elfPath, hexPath];
}

export function makeSizeArgs(elfPath: string): string[] {
  return ['-A', elfPath];
}
