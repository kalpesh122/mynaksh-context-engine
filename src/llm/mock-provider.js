/**
 * Deterministic mock provider.
 *
 * It is NOT a stub returning a fixed string. It composes an answer out of the
 * context it was actually given, which means a reviewer running with zero
 * credentials can still see that context selection worked — a career question
 * visibly produces a career answer, and an excluded source visibly never
 * appears. That makes the mock useful as a demo and as a test oracle.
 *
 * It deliberately does not paraphrase or add astrological judgement; inventing
 * predictions in a mock would make the output look better than the system is.
 */

export class MockProvider {
  name = 'mock';

  async generate({ system, user, maxWords }) {
    const contextLines = (user.match(/^- .+$/gm) ?? []).map((l) => l.replace(/^- /, ''));
    const question = (user.match(/^QUESTION: (.+)$/m) ?? [])[1] ?? '';
    const language = (user.match(/reply entirely in (\w+)/) ?? [])[1] ?? 'English';
    const tone = (user.match(/^Tone: (.+)\.$/m) ?? [])[1] ?? 'Neutral';

    const body = contextLines.length && !contextLines[0].startsWith('(no astrological')
      ? contextLines.map((l) => `• ${l}`).join('\n')
      : '• No astrological context was available for this question.';

    const text = [
      `[mock:${language.toLowerCase()}:${tone.toLowerCase()}] Regarding "${question}" —`,
      '',
      'Based strictly on the context selected for you:',
      body,
      '',
      `(Mock provider. ${contextLines.length} context item(s); budget ${maxWords} words. `
        + 'Set LLM_PROVIDER=openai or anthropic with an API key for a real completion.)',
    ].join('\n');

    return {
      text,
      model: 'mock-1',
      usage: { promptChars: system.length + user.length, completionChars: text.length },
    };
  }
}
