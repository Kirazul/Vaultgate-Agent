// Model → provider-logo mapping for the composer/model-picker badges.
//
// The logos live in /public/provider-icons.svg (an SVG sprite of provider
// brand marks, keyed by provider id). <ProviderIcon> renders one via
// `<use href="/provider-icons.svg#<id>">`. Our models are bare id strings, so
// we infer the provider from the id with the patterns below — ordered most- to
// least-specific so e.g. "gpt-oss" still resolves before a generic match.

/** Provider ids that exist as symbols in /public/provider-icons.svg. */
export const PROVIDER_ICON_IDS = new Set([
  "302ai", "abacus", "aihubmix", "alibaba", "alibaba-cn", "amazon-bedrock", "anthropic", "azure",
  "azure-cognitive-services", "bailing", "baseten", "berget", "cerebras", "chutes", "cloudflare-ai-gateway",
  "cloudflare-workers-ai", "cohere", "cortecs", "deepinfra", "deepseek", "digitalocean", "fireworks-ai",
  "github-copilot", "github-models", "google", "google-vertex", "google-vertex-anthropic", "groq",
  "huggingface", "inception", "io-net", "llama", "lmstudio", "minimax", "mistral", "modelscope",
  "moonshotai", "morph", "nano-gpt", "nebius", "novita-ai", "nvidia", "ollama-cloud", "openai", "opencode",
  "openrouter", "ovhcloud", "perplexity", "poe", "requesty", "sap-ai-core", "scaleway", "siliconflow",
  "stepfun", "synthetic", "togetherai", "upstage", "v0", "venice", "vercel", "vultr", "wandb", "xai",
  "xiaomi", "zai", "zhipuai",
]);

const FALLBACK_ICON = "opencode";

// [substring (lowercased), provider-icon id]. First match wins.
const MODEL_PATTERNS: Array<[RegExp, string]> = [
  [/claude|opus|sonnet|haiku/, "anthropic"],
  [/gpt|chatgpt|o1|o3|o4|davinci|gpt-oss|codex/, "openai"],
  [/gemini|palm|bison|gemma/, "google"],
  [/grok/, "xai"],
  [/deepseek/, "deepseek"],
  [/mistral|mixtral|codestral|ministral|magistral|pixtral|devstral/, "mistral"],
  [/qwen|qwq|alibaba/, "alibaba"],
  [/kimi|moonshot/, "moonshotai"],
  [/glm|zhipu|chatglm/, "zhipuai"],
  [/command|cohere|aya/, "cohere"],
  [/llama|codellama/, "llama"],
  [/minimax|abab/, "minimax"],
  [/perplexity|sonar|pplx/, "perplexity"],
  [/nemotron|nvidia/, "nvidia"],
  [/phi-|phi3|phi4|wizardlm/, "azure"],
  [/yi-|stepfun|step-/, "stepfun"],
  [/groq/, "groq"],
  [/ollama/, "ollama-cloud"],
  [/lmstudio|lm-studio/, "lmstudio"],
];

/** Resolve a model id (or provider id) to a sprite symbol id. */
export function modelProviderIcon(modelOrProvider: string): string {
  const value = (modelOrProvider || "").toLowerCase().trim();
  if (!value) return FALLBACK_ICON;
  // Exact provider id (e.g. when callers pass a provider directly).
  if (PROVIDER_ICON_IDS.has(value)) return value;
  // A "provider/model" form — try the provider segment first.
  const head = value.split(/[/:]/)[0];
  if (head && PROVIDER_ICON_IDS.has(head)) return head;
  for (const [pattern, id] of MODEL_PATTERNS) {
    if (pattern.test(value)) return id;
  }
  return FALLBACK_ICON;
}
