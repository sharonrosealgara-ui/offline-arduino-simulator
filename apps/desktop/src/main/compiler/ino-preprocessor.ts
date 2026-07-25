/**
 * Arduino-compatible .ino preprocessing, single-file MVP. Source: setup spec §5.1.
 *
 * MVP LIMITATION (stated explicitly per spec, not silently claimed as full
 * compatibility): full Arduino-style automatic function-prototype generation is
 * deferred. Functions must be declared/defined before first use, exactly like normal
 * C++. We still perform the three required transforms:
 *   1. Normalize line endings without altering content meaning.
 *   2. Add `#include <Arduino.h>` if absent.
 *   3. Insert `#line` directives so diagnostics map back to Sketch.ino.
 */

export interface PreprocessResult {
  cpp: string;
  /** Line in the ORIGINAL source that line 1 of the generated .cpp corresponds to. */
  lineOffset: number;
}

const ARDUINO_INCLUDE_PATTERN = /#include\s*[<"]Arduino\.h[>"]/;

export function preprocessIno(source: string, sketchDisplayName = 'Sketch.ino'): PreprocessResult {
  const normalized = source.replace(/\r\n?/g, '\n');

  const hasArduinoInclude = ARDUINO_INCLUDE_PATTERN.test(normalized);
  const header = hasArduinoInclude ? '' : '#include <Arduino.h>\n';

  // #line directives point subsequent compiler diagnostics back at Sketch.ino. The
  // header line (if injected) is not part of the original file, so the #line marker
  // must restart numbering at 1 for the first real source line.
  const cpp = `${header}#line 1 "${sketchDisplayName}"\n${normalized}`;

  return { cpp, lineOffset: header ? 1 : 0 };
}
