/**
 * Composes its reply from the context it was actually given, so a reviewer with
 * no credentials can still see selection working — a career question visibly
 * produces a career answer, and excluded sources visibly never appear.
 * It does not paraphrase: a mock that invents predictions flatters the system.
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
