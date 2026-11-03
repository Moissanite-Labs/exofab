// Text for a terminal. Record fields, hub messages and Synbios exports are
// untrusted, so they cannot be allowed to drive the terminal: C0 and C1
// control characters (except tab and line feed), bidirectional controls, and
// line and paragraph separators are written as \uXXXX escapes. The pattern
// below uses escape sequences, never the characters themselves.
export const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\u061c]/g;

export const safe = (text) => String(text).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
