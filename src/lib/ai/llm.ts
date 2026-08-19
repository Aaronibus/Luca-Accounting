// Optional LLM tier. Lúca's intelligence is deterministic-first: rules, memory,
// matching and heuristics produce every accounting proposal, and reports produce
// every figure. When ANTHROPIC_API_KEY is configured, the LLM is used ONLY to
//   (a) phrase explanations more naturally, and
//   (b) extract fields from messy document text,
// always constrained to data we hand it. It is never asked to invent figures,
// and its output never posts to the ledger without the same review workflow.

export interface LlmClient {
  complete(opts: { system: string; user: string; maxTokens?: number }): Promise<string | null>;
}

class AnthropicClient implements LlmClient {
  constructor(private apiKey: string) {}
  async complete(opts: { system: string; user: string; maxTokens?: number }): Promise<string | null> {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.LUCA_LLM_MODEL ?? "claude-sonnet-4-5",
          max_tokens: opts.maxTokens ?? 700,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return data.content?.find((c) => c.type === "text")?.text ?? null;
    } catch {
      return null;
    }
  }
}

const nullClient: LlmClient = { complete: async () => null };

export function getLlm(): LlmClient {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicClient(key) : nullClient;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
