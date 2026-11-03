// Exact texts a key signs to prove possession at registration (docs/prototype.md,
// "Identities and keys"). Pure, so Node tests import it: a test checks that
// these equal personProofText and agentProofText in src/hub/hub.mjs, which the
// browser cannot import because it reaches node:fs through the store.

export const personProofText = (nonce, key) => `exofab/0.1\nregister-person\n${nonce}\n${key}`;
export const agentProofText = (nonce, key, principal) => `exofab/0.1\nregister-agent\n${nonce}\n${key}\n${principal}`;
