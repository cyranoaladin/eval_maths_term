import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { responses, questions } from "@db/schema";
import { eq } from "drizzle-orm";

export const gradingRouter = createRouter({
  // Corriger une réponse avec la LLM
  gradeWithLLM: authedQuery
    .input(
      z.object({
        responseId: z.number(),
        studentAnswer: z.string(),
        justification: z.string().optional(),
        questionText: z.string(),
        correctAnswer: z.string(),
        questionType: z.enum(["qcm", "short_answer", "true_false"]),
        maxPoints: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { responseId, studentAnswer, justification, questionText, correctAnswer, questionType, maxPoints } = input;

        // Appeler l'API LLM pour correction
        const prompt = buildGradingPrompt({
          questionText,
          correctAnswer,
          studentAnswer,
          justification,
          questionType,
          maxPoints,
        });

        const result = await callLLM(prompt);

        // Parser la réponse de la LLM
        const grading = parseLLMResponse(result, maxPoints);

        // Mettre à jour la réponse dans la DB
        const db = getDb();
        await db
          .update(responses)
          .set({
            score: grading.score,
            isCorrect: grading.score > 0,
            llmFeedback: grading.feedback,
            gradedAt: new Date(),
          })
          .where(eq(responses.id, responseId));

        return { success: true, ...grading };
      } catch (error) {
        console.error("Error grading with LLM:", error);
        return { success: false, error: "Failed to grade with LLM" };
      }
    }),

  // Corriger toutes les réponses d'une session
  gradeSession: authedQuery
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const resps = await db
        .select()
        .from(responses)
        .where(eq(responses.sessionId, input.sessionId));

      const qs = await db.select().from(questions);
      const questionMap = new Map(qs.map((q) => [q.id, q]));

      let totalScore = 0;

      for (const resp of resps) {
        const q = questionMap.get(resp.questionId);
        if (!q) continue;

        if (q.type === "short_answer" || (q.type === "true_false" && q.justificationRequired)) {
          const prompt = buildGradingPrompt({
            questionText: q.question,
            correctAnswer: q.correctAnswer,
            studentAnswer: resp.answer,
            justification: resp.justification || undefined,
            questionType: q.type,
            maxPoints: q.points,
          });
          const feedback = `Réponse incorrecte. La bonne réponse était : ${q.correctAnswer}.`;
          try {
            const result = await callLLM(prompt);
            const grading = parseLLMResponse(result, q.points);

            await db
              .update(responses)
              .set({
                score: grading.score,
                isCorrect: grading.score > 0,
                llmFeedback: grading.feedback,
                gradedAt: new Date(),
              })
              .where(eq(responses.id, resp.id));

            totalScore += grading.score;
          } catch (error) {
            console.error(`Error grading response ${resp.id}:`, error);
            await db
              .update(responses)
              .set({
                llmFeedback: feedback,
                gradedAt: new Date(),
              })
              .where(eq(responses.id, resp.id));
            totalScore += resp.score || 0;
          }
        } else {
          totalScore += resp.score || 0;
        }
      }

      return { success: true, totalScore };
    }),

  // Mettre à jour manuellement une note
  updateGrade: authedQuery
    .input(
      z.object({
        responseId: z.number(),
        score: z.number().min(0),
        feedback: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(responses)
        .set({
          score: input.score,
          llmFeedback: input.feedback || null,
          gradedAt: new Date(),
        })
        .where(eq(responses.id, input.responseId));

      return { success: true };
    }),
});

// Helper functions
function buildGradingPrompt(params: {
  questionText: string;
  correctAnswer: string;
  studentAnswer: string;
  justification?: string;
  questionType: string;
  maxPoints: number;
}): string {
  const { questionText, correctAnswer, studentAnswer, justification, questionType, maxPoints } = params;

  let prompt = `Tu es un professeur de mathématiques en classe de terminale (EDS). Tu dois corriger la réponse d'un élève.

Question : ${questionText}
Réponse attendue : ${correctAnswer}
Réponse de l'élève : ${studentAnswer}`;

  if (justification) {
    prompt += `\nJustification de l'élève : ${justification}`;
  }

  prompt += `\n\nType de question : ${questionType === "short_answer" ? "Réponse courte" : "Vrai/Faux avec justification"}`;

  prompt += `\n\nInstructions :
1. Évalue la réponse sur ${maxPoints} points maximum.
2. Sois indulgent mais rigoureux : une réponse équivalente mathématiquement doit être acceptée.
3. Donne un feedback constructif.

Réponds EXACTEMENT au format suivant (sans autre texte) :
SCORE: [nombre entre 0 et ${maxPoints}]
FEEDBACK: [ton feedback en français]`;

  return prompt;
}

async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.KIMI_API_KEY;

  if (!apiKey) {
    throw new Error("No API key configured");
  }

  // Utiliser l'API Kimi (OpenAI-compatible)
  const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "moonshot-v1-8k",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || "";
}

function parseLLMResponse(response: string, maxPoints: number): { score: number; feedback: string } {
  const scoreMatch = response.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
  const feedbackMatch = response.match(/FEEDBACK:\s*(.+)/is);

  let score = 0;
  if (scoreMatch) {
    score = Math.min(Math.max(parseFloat(scoreMatch[1]), 0), maxPoints);
  }

  const feedback = feedbackMatch ? feedbackMatch[1].trim() : "Corrigé automatiquement.";

  return { score: Math.round(score), feedback };
}
