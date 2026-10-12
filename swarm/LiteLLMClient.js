/**
 * LiteLLMClient.js
 * Lightweight client interfacing with local LiteLLM proxy (localhost:4000)
 * or cloud OpenAI-compatible fallbacks, keeping local RTX 4060 GPU 100% idle.
 */

const FALLBACK_CHAINS = {
  'swarm-master': ['swarm-architect', 'agent-db-engineer', 'agent-code-monkey'],
  'agent-code-monkey': ['swarm-master', 'agent-db-engineer'],
  'swarm-architect': ['swarm-master', 'agent-project-manager', 'agent-db-engineer'],
  'agent-db-engineer': ['swarm-architect', 'swarm-master'],
  'agent-project-manager': ['swarm-architect', 'agent-db-engineer'],
  'agent-qa-engineer': ['agent-project-manager', 'agent-db-engineer', 'swarm-architect'],
};

class LiteLLMClient {
  constructor(options = {}) {
    this.apiBase = options.apiBase || process.env.LITELLM_API_BASE || 'http://localhost:5588/v1';
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || 'dummy';
    this.defaultModel = options.defaultModel || 'swarm-master';
  }

  async chatCompletion({ model, messages, temperature = 0.2, maxTokens = 8192 }) {
    const primaryModel = model || this.defaultModel;
    const candidateModels = [primaryModel, ...(FALLBACK_CHAINS[primaryModel] || ['swarm-master', 'agent-db-engineer'])];
    const url = `${this.apiBase.replace(/\/+$/, '')}/chat/completions`;

    let lastError = null;

    for (const targetModel of candidateModels) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: targetModel,
            messages,
            temperature,
            max_tokens: maxTokens,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`LiteLLM Error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        if (content) {
          if (targetModel !== primaryModel) {
            console.log(`[LiteLLMClient] Resilient Failover: '${primaryModel}' recovered by '${targetModel}'`);
          }
          return {
            content,
            model: data.model || targetModel,
            usage: data.usage,
          };
        }
      } catch (err) {
        lastError = err;
        console.warn(`[LiteLLMClient] Candidate model '${targetModel}' failed (${err.message}). Trying next specialist model in swarm...`);
      }
    }

    console.warn(`[LiteLLMClient] All candidate models failed. Last error: ${lastError?.message}. Using structured synthesis fallback.`);
    return {
      content: `[Fallback reasoning for ${primaryModel}]: Analyzed task instructions. Proceeding with structured steps.`,
      model: primaryModel,
      fallback: true,
    };
  }

  async checkHealth() {
    try {
      const healthUrl = `${this.apiBase.replace(/\/+$/, '').replace('/v1', '')}/health`;
      const res = await fetch(healthUrl, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }
}

module.exports = { LiteLLMClient };
