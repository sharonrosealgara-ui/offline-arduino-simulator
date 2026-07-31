/**
 * The one thing a student is told when a save genuinely fails.
 *
 * It is deliberately short, blames nothing, and names the next action. It deliberately does
 * NOT carry the underlying Error: a stack, an errno, or an absolute path tells a student
 * nothing they can act on, and a path can expose more of the machine than the app should
 * put on screen. The real error goes to the console for whoever is debugging.
 *
 * Kept in its own module so the controller that raises it, the dialog that shows it, and the
 * tests that assert on it all read the same string — a copy that drifts would leave the
 * tests passing against a message no student ever sees.
 */
export const SAVE_FAILURE_MESSAGE = 'Your project could not be saved. Check the destination and try again.';
