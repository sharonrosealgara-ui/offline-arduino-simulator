/**
 * Parses raw avr-gcc/avr-g++ stdout+stderr into sanitized, student-facing
 * CompilerDiagnostic records. Source: UI_CANVAS_AND_PACKAGING_SPEC.md §14-17.
 *
 * Runs entirely in Electron main. Absolute temp/workspace/executable paths, usernames,
 * and raw child-process objects never cross IPC — only the translated records below do.
 */
import type { CompilerDiagnostic, DiagnosticPhase, DiagnosticSeverity } from '@offline-arduino/contracts/compiler';
import { scrubPaths } from '../security/path-policy';

export interface RawDiagnosticRecord {
  tool: 'avr-gcc' | 'avr-g++' | 'avr-ar' | 'avr-objcopy' | 'avr-size' | 'linker' | 'system';
  phase: DiagnosticPhase;
  severity: DiagnosticSeverity;
  compilerCode?: string;
  rawFile?: string;
  rawLine?: number;
  rawColumn?: number;
  message: string;
  notes: string[];
}

interface DiagnosticRule {
  id: string;
  pattern: RegExp;
  translate(record: RawDiagnosticRecord, match: RegExpMatchArray): Pick<CompilerDiagnostic, 'code' | 'title' | 'explanation' | 'suggestedActions'>;
}

const MAX_DIAGNOSTICS = 200;
const MAX_NOTES_PER_DIAGNOSTIC = 5;
const MAX_FIELD_LENGTH = 2000;

/** GCC-style: `path:line:col: severity: message`. Handles both / and \ path separators. */
const GCC_LINE_PATTERN = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.+)$/;
/** Linker/system messages without file:line:col, e.g. "undefined reference to `foo'". */
const LINKER_LINE_PATTERN = /^(.+?):\s*(undefined reference to.*|multiple definition of.*)$/;

function severityFromGcc(raw: string): DiagnosticSeverity {
  if (raw === 'fatal error') return 'fatal';
  if (raw === 'error') return 'error';
  if (raw === 'note') return 'info';
  return 'warning';
}

/**
 * The minimum translation catalog (spec §16), ordered most-specific to least-specific.
 * Each rule owns exactly one plain-language explanation; it must not promise a fix will
 * work, since GCC often reports a cascade location rather than the true source line.
 */
const CATALOG: DiagnosticRule[] = [
  {
    id: 'expected-semicolon',
    pattern: /expected ';' before/,
    translate: () => ({
      code: 'EXPECTED_SEMICOLON',
      title: 'A semicolon may be missing',
      explanation: 'The compiler reached this point before the previous statement was complete.',
      suggestedActions: ['Check this line.', 'Check the statement immediately above it.', 'Add a semicolon only if that statement requires one.'],
    }),
  },
  {
    id: 'not-declared',
    pattern: /was not declared in this scope/,
    translate: () => ({
      code: 'NOT_DECLARED',
      title: 'This name has not been defined here',
      explanation: 'The compiler does not recognize this name at this point in the sketch.',
      suggestedActions: ['Check spelling and capitalization.', 'Make sure it is declared before it is used.'],
    }),
  },
  {
    id: 'missing-header',
    pattern: /No such file or directory/,
    translate: () => ({
      code: 'UNSUPPORTED_LIBRARY',
      title: 'This header or library is unavailable',
      explanation: 'The sketch includes a header this offline classroom build does not have.',
      suggestedActions: ['Check the spelling of the #include name.', 'Use a supported bundled library instead.'],
    }),
  },
  {
    id: 'redefinition-setup-loop',
    pattern: /redefinition of ['"`]?void (setup|loop)/,
    translate: (_r, m) => ({
      code: 'DUPLICATE_ENTRY_FUNCTION',
      title: `This sketch defines ${m[1] ?? 'a function'}() twice`,
      explanation: 'Every Arduino sketch needs exactly one setup() and one loop().',
      suggestedActions: ['Remove the extra definition.', 'Keep exactly one setup() and one loop().'],
    }),
  },
  {
    id: 'expected-brace',
    pattern: /expected '\}' at end of input/,
    translate: () => ({
      code: 'MISSING_CLOSING_BRACE',
      title: 'A closing brace is missing',
      explanation: 'The compiler reached the end of the file while still inside a block.',
      suggestedActions: ['Match every opening { with a closing }.'],
    }),
  },
  {
    id: 'expected-paren',
    pattern: /expected '\)'/,
    translate: () => ({
      code: 'MISSING_CLOSING_PAREN',
      title: 'A closing parenthesis may be missing',
      explanation: 'The compiler expected a closing parenthesis near this point.',
      suggestedActions: ['Check this call or condition.', 'Check the line above it.'],
    }),
  },
  {
    id: 'invalid-conversion',
    pattern: /invalid conversion from/,
    translate: () => ({
      code: 'INVALID_CONVERSION',
      title: 'This value has the wrong type',
      explanation: 'The value provided does not match the type this function or variable expects.',
      suggestedActions: ['Compare the value with the expected parameter or variable type.'],
    }),
  },
  {
    id: 'too-few-arguments',
    pattern: /too few arguments to function/,
    translate: () => ({
      code: 'TOO_FEW_ARGUMENTS',
      title: 'This function needs more information',
      explanation: 'This call is missing one or more required arguments.',
      suggestedActions: ['Review the function signature and add the required argument.'],
    }),
  },
  {
    id: 'too-many-arguments',
    pattern: /too many arguments to function/,
    translate: () => ({
      code: 'TOO_MANY_ARGUMENTS',
      title: 'This function received too many values',
      explanation: 'This call passes more arguments than the function accepts.',
      suggestedActions: ['Review the function signature and remove the extra argument.'],
    }),
  },
  {
    id: 'undefined-reference',
    pattern: /undefined reference to/,
    translate: () => ({
      code: 'UNDEFINED_REFERENCE',
      title: 'Code was declared but could not be linked',
      explanation: 'Something was declared but no matching implementation was found.',
      suggestedActions: ['Check spelling.', 'Make sure the function has an implementation.'],
    }),
  },
  {
    id: 'flash-overflow',
    pattern: /region `?text`? overflowed by|Program(?: too big)?.*flash/i,
    translate: () => ({
      code: 'FLASH_OVERFLOW',
      title: 'The sketch is too large for Uno program memory',
      explanation: 'The compiled program does not fit in the Arduino Uno flash memory.',
      suggestedActions: ['Remove unused code or data.', 'Reduce how many bundled libraries are used.'],
    }),
  },
  {
    id: 'sram-overflow',
    pattern: /region `?\.?data`? overflowed|data does not fit/i,
    translate: () => ({
      code: 'SRAM_OVERFLOW',
      title: 'Global data is too large for Uno memory',
      explanation: 'The sketch’s global variables do not fit in the Arduino Uno’s SRAM.',
      suggestedActions: ['Reduce the size of global arrays or strings.'],
    }),
  },
];

const FALLBACK_TRANSLATION: Pick<CompilerDiagnostic, 'code' | 'title' | 'explanation' | 'suggestedActions'> = {
  code: 'UNRECOGNIZED_COMPILER_MESSAGE',
  title: 'The compiler reported a problem here',
  explanation: 'This message did not match a known pattern. See Technical details for the exact compiler text.',
  suggestedActions: ['Review the highlighted line and the technical detail below.'],
};

function detectPhase(tool: RawDiagnosticRecord['tool']): DiagnosticPhase {
  switch (tool) {
    case 'avr-gcc':
    case 'avr-g++':
      return 'compile';
    case 'avr-ar':
      return 'archive';
    case 'linker':
      return 'link';
    case 'avr-objcopy':
      return 'objcopy';
    case 'avr-size':
      return 'size';
    default:
      return 'system';
  }
}

/**
 * Splits raw combined stdout+stderr from one tool invocation into individual raw
 * records, attaching trailing `note:` lines to the preceding diagnostic.
 */
export function splitIntoRecords(output: string, tool: RawDiagnosticRecord['tool']): RawDiagnosticRecord[] {
  const lines = output.replace(/\r\n?/g, '\n').split('\n');
  const records: RawDiagnosticRecord[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const gccMatch = line.match(GCC_LINE_PATTERN);
    if (gccMatch) {
      const [, file, lineStr, colStr, severityRaw, message] = gccMatch;
      const severity = severityFromGcc(severityRaw);
      if (severity === 'info' && records.length > 0) {
        const previous = records[records.length - 1];
        if (previous.notes.length < MAX_NOTES_PER_DIAGNOSTIC) previous.notes.push(message.slice(0, MAX_FIELD_LENGTH));
        continue;
      }
      records.push({
        tool,
        phase: detectPhase(tool),
        severity,
        rawFile: file,
        rawLine: Number(lineStr),
        rawColumn: Number(colStr),
        message: message.slice(0, MAX_FIELD_LENGTH),
        notes: [],
      });
      continue;
    }

    const linkerMatch = line.match(LINKER_LINE_PATTERN);
    if (linkerMatch) {
      records.push({
        tool: 'linker',
        phase: 'link',
        severity: 'error',
        rawFile: linkerMatch[1],
        message: linkerMatch[2].slice(0, MAX_FIELD_LENGTH),
        notes: [],
      });
      continue;
    }

    // A continuation line (e.g. the caret/underline GCC prints under the message, or a
    // plain informational line) attaches as a note to the previous record if one exists.
    if (records.length > 0) {
      const previous = records[records.length - 1];
      if (previous.notes.length < MAX_NOTES_PER_DIAGNOSTIC) previous.notes.push(line.slice(0, MAX_FIELD_LENGTH));
    }

    if (records.length >= MAX_DIAGNOSTICS) break;
  }

  return records.slice(0, MAX_DIAGNOSTICS);
}

/** Remaps a generated Sketch.cpp line number back to the original Sketch.ino line. */
export function remapLine(rawLine: number | undefined, lineOffset: number): number | undefined {
  if (rawLine === undefined) return undefined;
  const mapped = rawLine - lineOffset;
  return mapped > 0 ? mapped : rawLine;
}

function isSketchFile(rawFile: string | undefined): boolean {
  if (!rawFile) return false;
  const normalized = rawFile.replace(/\\/g, '/');
  return normalized.endsWith('/Sketch.cpp') || normalized.endsWith('/Sketch.ino') || normalized === 'Sketch.cpp';
}

export interface TranslateOptions {
  lineOffset: number;
  sourceRevision: number;
  sensitiveRoots: string[];
}

export function translateRecord(record: RawDiagnosticRecord, options: TranslateOptions, index: number): CompilerDiagnostic {
  const rule = CATALOG.find((r) => r.pattern.test(record.message));
  const translated = rule ? rule.translate(record, record.message.match(rule.pattern)!) : FALLBACK_TRANSLATION;

  const fileUri = isSketchFile(record.rawFile) ? 'offline-arduino://project/current/Sketch.ino' : undefined;
  const line = isSketchFile(record.rawFile) ? remapLine(record.rawLine, options.lineOffset) : undefined;

  const technicalLines = [record.message, ...record.notes];
  const technicalDetail = scrubPaths(technicalLines.join('\n'), options.sensitiveRoots).slice(0, MAX_FIELD_LENGTH);

  return {
    id: `${record.phase}:${record.severity}:${index}:${translated.code}`,
    phase: record.phase,
    severity: record.severity,
    code: translated.code,
    fileUri,
    line,
    column: fileUri ? record.rawColumn : undefined,
    endColumn: fileUri && record.rawColumn ? record.rawColumn + 1 : undefined,
    title: translated.title,
    explanation: translated.explanation,
    suggestedActions: translated.suggestedActions,
    technicalDetail,
    sourceRevision: options.sourceRevision,
  };
}

/** Parses one tool invocation's combined output into sanitized student-facing diagnostics. */
export function parseCompilerOutput(
  combinedOutput: string,
  tool: RawDiagnosticRecord['tool'],
  options: TranslateOptions,
): CompilerDiagnostic[] {
  const records = splitIntoRecords(combinedOutput, tool);
  return records.map((record, index) => translateRecord(record, options, index));
}
