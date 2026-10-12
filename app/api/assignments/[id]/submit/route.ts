import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { processSubmission } from "@/lib/grading";

/** POST /api/assignments/:id/submit —— 提交作答 → 批改 → 掌握度更新 → 错题归集 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireApiUser(["STUDENT"]);
    const body = await req.json();
    const answers = Array.isArray(body?.answers) ? body.answers : [];
    const result = await processSubmission({
      assignmentId: params.id,
      studentId: session.user.id,
      studentClassId: session.user.classId,
      answers: answers.map((a: { questionId?: string; response?: string; timeSpentMs?: number }) => ({
        questionId: String(a.questionId ?? ""),
        response: String(a.response ?? ""),
        timeSpentMs: a.timeSpentMs,
      })),
    });
    return ok(result, 201);
  } catch (e) {
    return fail(e);
  }
}
