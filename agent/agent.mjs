// Infra-only stub: echoes the message as a single token.
// Real Bedrock/Strands implementation will replace this in a later slice.

export async function* answerWith(message) {
  yield { type: "token", text: `Echo: ${message}` };
}
