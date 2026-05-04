import { getModel } from '../../lib/gemini.js';
import { CONSULTATION_PROMPT } from './prompts.js';
import { formatHistory, formatRagContext } from './utils.js';
import type { ChatTurn, SearchResult } from '../../types/chatbot.js';

export async function* generateConsultationResponse(
  query: string,
  history: ChatTurn[],
  ragContext: SearchResult[],
): AsyncGenerator<string, void, unknown> {
  const model = getModel({ temperature: 0.4, maxOutputTokens: 3072 });
  const prompt = CONSULTATION_PROMPT
    .replace('{context}', formatRagContext(ragContext))
    .replace('{history}', formatHistory(history, 4))
    .replace('{query}', query);

  const result = await model.generateContentStream(prompt);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
