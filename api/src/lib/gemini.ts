import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { env } from '../config/env.js';

const ai = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// 의료 챗봇은 신체 부위·증상 등이 자연스럽게 언급되므로 차단 한도를 완화한다.
export const MEDICAL_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

export function getModel(opts?: { temperature?: number; maxOutputTokens?: number }) {
  return ai.getGenerativeModel({
    model: env.GEMINI_MODEL,
    safetySettings: MEDICAL_SAFETY_SETTINGS,
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxOutputTokens ?? 1024,
    },
  });
}
