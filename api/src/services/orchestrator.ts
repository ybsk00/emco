// 엠코소아과 챗봇 오케스트레이터
// 4 에이전트: greeting · general · consultation · medical
// 안전 가드 → Intent 라우팅 → 에이전트 디스패치 → __SOURCES__ 마커 출력

import { EmcoRetriever } from './retriever.js';
import { routeIntent } from './agents/intentRouter.js';
import { generateGreetingResponse } from './agents/greeting.js';
import { generateGeneralAgentResponse } from './agents/general.js';
import { generateConsultationResponse } from './agents/consultation.js';
import {
  classifyMedicalCategory,
  generateMedicalRagResponse,
  generateMedicalFallbackResponse,
} from './agents/medical.js';
import { isDiagnosisRequest, DIAGNOSIS_WARNING } from './agents/safety.js';
import { stripMarkdown, buildSourcesPayload } from './agents/utils.js';
import type { Category, ChatRequest, OrchestrateResult } from '../types/chatbot.js';

const SOURCE_MARKER = '__SOURCES__';

export class EmcoOrchestrator {
  private retriever = new EmcoRetriever();

  async orchestrate(req: ChatRequest, rawWriter: (chunk: string) => void): Promise<OrchestrateResult> {
    const { query, history, requestedCategory } = req;

    // 마크다운 제거 래퍼 — __SOURCES__ 마커는 그대로 통과
    const writer = (chunk: string) => {
      if (chunk.includes(SOURCE_MARKER)) {
        rawWriter(chunk);
      } else {
        rawWriter(stripMarkdown(chunk));
      }
    };

    // 1) 안전 가드 — 진단·처방 직접 요청 차단
    if (isDiagnosisRequest(query)) {
      writer(DIAGNOSIS_WARNING);
      return {
        intent: 'medical',
        category: 'general',
        fullResponse: DIAGNOSIS_WARNING,
        hadSources: false,
        isFallback: false,
        retrievedCount: 0,
      };
    }

    // 2) Intent 라우팅
    const intent = await routeIntent(query, history);
    console.log(`[orchestrator] intent=${intent}`);

    let fullResponse = '';
    let hadSources = false;
    let isFallback = false;
    let retrievedCount = 0;
    let category: Category | 'general' =
      requestedCategory === 'auto' ? 'general' : (requestedCategory as Category);

    switch (intent) {
      case 'greeting': {
        const reply = generateGreetingResponse(query);
        writer(reply);
        fullResponse = reply;
        break;
      }

      case 'general': {
        for await (const chunk of generateGeneralAgentResponse(query, history)) {
          writer(chunk);
          fullResponse += chunk;
        }
        break;
      }

      case 'consultation': {
        // 운영 정보 RAG — general 카테고리로 한정
        const rag = await this.retriever.retrieve(query, 8, 'general');
        retrievedCount = rag.length;
        for await (const chunk of generateConsultationResponse(query, history, rag)) {
          writer(chunk);
          fullResponse += chunk;
        }
        if (rag.length > 0) {
          hadSources = true;
          writer(`\n${SOURCE_MARKER}${JSON.stringify(buildSourcesPayload(rag))}`);
        }
        break;
      }

      case 'medical': {
        // 카테고리 분류 + RAG 병렬
        const categoryPromise: Promise<Category> =
          requestedCategory === 'auto'
            ? classifyMedicalCategory(query, history)
            : Promise.resolve(requestedCategory as Category);

        category = await categoryPromise;
        const rag = await this.retriever.retrieve(query, 10, category as Category);
        retrievedCount = rag.length;
        const relevant = EmcoRetriever.hasRelevantDocs(rag);

        if (relevant) {
          for await (const chunk of generateMedicalRagResponse(query, history, rag)) {
            writer(chunk);
            fullResponse += chunk;
          }
          hadSources = true;
          writer(`\n${SOURCE_MARKER}${JSON.stringify(buildSourcesPayload(rag))}`);
        } else {
          isFallback = true;
          for await (const chunk of generateMedicalFallbackResponse(query, history)) {
            writer(chunk);
            fullResponse += chunk;
          }
        }
        break;
      }
    }

    return {
      intent,
      category,
      fullResponse,
      hadSources,
      isFallback,
      retrievedCount,
    };
  }
}
