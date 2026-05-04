import { getModel } from '../../lib/gemini.js';
import { GENERAL_AGENT_PROMPT } from './prompts.js';
import { formatHistory } from './utils.js';
import type { ChatTurn } from '../../types/chatbot.js';

export async function* generateGeneralAgentResponse(
  query: string,
  history: ChatTurn[],
): AsyncGenerator<string, void, unknown> {
  const model = getModel({ temperature: 0.7, maxOutputTokens: 2048 });
  const prompt = GENERAL_AGENT_PROMPT
    .replace('{history}', formatHistory(history, 4))
    .replace('{query}', query);

  const result = await model.generateContentStream(prompt);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
