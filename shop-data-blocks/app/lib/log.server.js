/**
 * Structured, greppable logging for the customer-questions flow.
 *
 * Every line is prefixed with the literal token `[questions]` followed by a
 * single-line JSON object, so logs can be searched two ways:
 *   - grep `[questions]`                  → every event in the flow
 *   - grep `question.submitted`           → just newly-received questions
 *   - pipe to `jq` / a log UI's JSON view → filter on shop, thread_id, etc.
 *
 * Use logQuestion for normal lifecycle steps and logQuestionError for failures.
 */
const TAG = "[questions]";

export function logQuestion(event, fields = {}) {
  console.log(`${TAG} ${serialize(event, fields)}`);
}

export function logQuestionError(event, error, fields = {}) {
  console.error(
    `${TAG} ${serialize(event, {
      ...fields,
      error: error?.message ?? String(error),
    })}`,
  );
}

function serialize(event, fields) {
  try {
    return JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  } catch {
    // Never let a logging failure break the request.
    return JSON.stringify({ ts: new Date().toISOString(), event });
  }
}
